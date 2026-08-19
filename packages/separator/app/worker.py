import os
import time
import uuid
import logging
import threading
from typing import Optional, Dict
from queue import Queue, Empty
from app.models import TaskStatus, TaskStatusResponse
from app.audio_utils import extract_audio, transcode_to_mp3, is_video_file, is_audio_file
from app.demucs_runner import (
    separate,
    set_device,
    get_device,
    TaskCancelledError,
    release_gpu_resources,
)

logger = logging.getLogger(__name__)

# 任务结束后模型保留时长（秒）；期间有新任务则直接复用模型，
# 持续空闲超过该时长才卸载模型并清空显存，兼顾批量任务性能与资源释放
IDLE_UNLOAD_SECONDS = 60

class SeparationTask:
    """分离任务"""
    def __init__(self, task_id: str, input_path: str, output_dir: str,
                 model: str = 'htdemucs', callback_url: Optional[str] = None):
        self.task_id = task_id
        self.input_path = input_path
        self.output_dir = output_dir
        self.model = model
        self.callback_url = callback_url
        self.status = TaskStatus.PENDING
        self.progress = 0.0
        self.stage = None
        self.vocals_path = None
        self.instrumental_path = None
        self.error = None
        self.created_at = time.time()
        self.started_at = None
        self.completed_at = None
        self.retry_count = 0
        self.max_retries = 3

class SeparateWorker:
    """分离任务执行器（支持多线程并发消费队列）"""
    
    def __init__(self, num_workers: Optional[int] = None):
        self._queue: Queue = Queue()
        self._tasks: Dict[str, SeparationTask] = {}
        self._worker_threads: list = []
        self._running = False
        self._lock = threading.Lock()
        self._current_task_ids: set = set()
        self._cancelled_tasks: set = set()
        self._idle_timer: Optional[threading.Timer] = None
        # None 表示启动时从环境变量 SEPARATION_CONCURRENCY 读取（本地 .env / Docker 均适用）
        self.num_workers = num_workers
    
    def _resolve_num_workers(self) -> int:
        if self.num_workers is not None:
            return self.num_workers
        try:
            return max(1, min(int(os.environ.get('SEPARATION_CONCURRENCY', '1')), 8))
        except ValueError:
            return 1
    
    def start(self):
        """启动工作线程（并发数由 SEPARATION_CONCURRENCY 决定）"""
        if self._running:
            return
        
        self._running = True
        worker_count = self._resolve_num_workers()
        for i in range(worker_count):
            thread = threading.Thread(
                target=self._run,
                daemon=True,
                name=f"separator-worker-{i}",
            )
            self._worker_threads.append(thread)
            thread.start()
        logger.info(f"Separation worker started with {worker_count} workers")
    
    def stop(self):
        """停止所有工作线程"""
        self._running = False
        for thread in self._worker_threads:
            thread.join(timeout=5)
        self._worker_threads.clear()
        logger.info("Separation worker stopped")
    
    def enqueue(self, input_path: str, output_dir: str,
                model: str = 'htdemucs', callback_url: Optional[str] = None) -> str:
        """添加任务到队列"""
        task_id = str(uuid.uuid4())
        task = SeparationTask(
            task_id=task_id,
            input_path=input_path,
            output_dir=output_dir,
            model=model,
            callback_url=callback_url
        )
        
        with self._lock:
            self._tasks[task_id] = task
            self._queue.put(task_id)
        
        logger.info(f"Task {task_id} enqueued: {input_path}")
        return task_id
    
    def get_task(self, task_id: str) -> Optional[TaskStatusResponse]:
        """获取任务状态"""
        with self._lock:
            task = self._tasks.get(task_id)
        
        if not task:
            return None
        
        return TaskStatusResponse(
            task_id=task.task_id,
            status=task.status,
            progress=task.progress,
            stage=task.stage,
            vocals_path=task.vocals_path,
            instrumental_path=task.instrumental_path,
            error=task.error,
            created_at=task.created_at,
            started_at=task.started_at,
            completed_at=task.completed_at
        )
    
    def get_queue_size(self) -> int:
        """获取队列大小"""
        return self._queue.qsize()

    def cancel_task(self, task_id: str) -> bool:
        with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return False
            if task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED):
                return False
            self._cancelled_tasks.add(task_id)
            task.status = TaskStatus.FAILED
            task.error = "Task cancelled by user"
            task.completed_at = time.time()
        logger.info(f"Task {task_id} cancelled by user")
        return True

    def _cancel_idle_timer(self):
        with self._lock:
            timer = self._idle_timer
            self._idle_timer = None
        if timer:
            timer.cancel()

    def _schedule_idle_release(self):
        """任务结束后启动空闲定时器：持续空闲超时才卸载模型并清空显存"""
        with self._lock:
            if self._idle_timer:
                self._idle_timer.cancel()
            timer = threading.Timer(IDLE_UNLOAD_SECONDS, self._release_gpu)
            timer.daemon = True
            self._idle_timer = timer
        timer.start()

    def _release_gpu(self):
        with self._lock:
            self._idle_timer = None
        release_gpu_resources()

    def _run(self):
        """工作线程主循环"""
        # 设置设备
        try:
            import torch
            if torch.cuda.is_available():
                set_device("cuda")
            else:
                set_device("cpu")
        except ImportError:
            set_device("cpu")
        
        while self._running:
            try:
                task_id = self._queue.get(timeout=1)

                with self._lock:
                    if task_id in self._cancelled_tasks:
                        self._cancelled_tasks.discard(task_id)
                        self._queue.task_done()
                        continue

                task = self._tasks.get(task_id)

                if task:
                    self._process_task(task)

                self._queue.task_done()
            except Empty:
                continue
            except Exception as e:
                logger.error(f"Worker error: {e}")
    
    def _process_task(self, task: SeparationTask):
        """处理单个分离任务"""
        logger.info(f"Processing task {task.task_id}")

        # 任务真正开始，模型即将被使用：取消空闲卸载定时器，复用缓存模型
        self._cancel_idle_timer()

        task.status = TaskStatus.PROCESSING
        task.started_at = time.time()

        with self._lock:
            self._current_task_ids.add(task.task_id)

        try:
            # 进度回调
            def progress_callback(progress: float, stage: str):
                with self._lock:
                    if task.task_id in self._cancelled_tasks:
                        raise TaskCancelledError("Task cancelled by user")
                task.progress = progress
                task.stage = stage
                self._send_callback(task)

            def is_cancelled() -> bool:
                with self._lock:
                    return task.task_id in self._cancelled_tasks

            input_path = task.input_path
            temp_audio_path = None

            # 如果是视频文件，先提取音频
            if is_video_file(input_path):
                progress_callback(5, "extracting_audio")
                temp_dir = os.path.join(task.output_dir, "temp")
                os.makedirs(temp_dir, exist_ok=True)
                base_name = os.path.splitext(os.path.basename(input_path))[0]
                temp_audio_path = os.path.join(temp_dir, f"{base_name}.wav")
                extract_audio(input_path, temp_audio_path)
                input_path = temp_audio_path
                progress_callback(15, "audio_extracted")

            # 执行分离
            result = separate(
                audio_path=input_path,
                output_dir=os.path.join(task.output_dir, "separated"),
                model_name=task.model,
                progress_callback=progress_callback,
                is_cancelled=is_cancelled,
            )

            with self._lock:
                if task.task_id in self._cancelled_tasks:
                    self._cancelled_tasks.discard(task.task_id)
                    logger.info(f"Task {task.task_id} was cancelled, discarding results")
                    if temp_audio_path and os.path.exists(temp_audio_path):
                        os.remove(temp_audio_path)
                    return

            # 转码为MP3
            progress_callback(85, "transcoding_vocals")
            base_name = os.path.splitext(os.path.basename(task.input_path))[0]

            vocals_mp3_path = os.path.join(task.output_dir, f"{base_name}_vocals.mp3")
            instrumental_mp3_path = os.path.join(task.output_dir, f"{base_name}_instrumental.mp3")

            transcode_to_mp3(result['vocals_path'], vocals_mp3_path)
            # 转码成功即删除 separated/ 中的 wav 中间产物，避免 wav+mp3 重复存放占用大量磁盘
            if os.path.exists(result['vocals_path']):
                os.remove(result['vocals_path'])

            progress_callback(90, "transcoding_instrumental")
            transcode_to_mp3(result['instrumental_path'], instrumental_mp3_path)
            if os.path.exists(result['instrumental_path']):
                os.remove(result['instrumental_path'])

            # separated/ 已无 wav，移除空目录（若存在）
            sep_dir = os.path.join(task.output_dir, "separated")
            try:
                if os.path.isdir(sep_dir) and not os.listdir(sep_dir):
                    os.rmdir(sep_dir)
            except OSError:
                pass

            # 清理临时文件
            if temp_audio_path and os.path.exists(temp_audio_path):
                os.remove(temp_audio_path)

            # 更新任务状态
            task.vocals_path = vocals_mp3_path
            task.instrumental_path = instrumental_mp3_path
            task.progress = 100
            task.stage = "completed"
            task.status = TaskStatus.COMPLETED
            task.completed_at = time.time()

            logger.info(f"Task {task.task_id} completed: vocals={vocals_mp3_path}, instrumental={instrumental_mp3_path}")
            self._send_callback(task)

        except TaskCancelledError as e:
            logger.info(f"Task {task.task_id} cancelled: {e}")
            if temp_audio_path and os.path.exists(temp_audio_path):
                os.remove(temp_audio_path)
            with self._lock:
                self._cancelled_tasks.discard(task.task_id)
        except Exception as e:
            logger.error(f"Task {task.task_id} failed: {e}")

            with self._lock:
                if task.task_id in self._cancelled_tasks:
                    self._cancelled_tasks.discard(task.task_id)
                    return

            task.retry_count += 1
            if task.retry_count < task.max_retries:
                logger.info(f"Retrying task {task.task_id} (attempt {task.retry_count + 1})")
                task.status = TaskStatus.PENDING
                task.error = str(e)
                self._queue.put(task.task_id)
            else:
                task.status = TaskStatus.FAILED
                task.error = str(e)
                task.completed_at = time.time()
                self._send_callback(task)
        finally:
            with self._lock:
                self._current_task_ids.discard(task.task_id)
            # 任务结束后启动空闲定时器：持续空闲超时才卸载模型并清空显存
            self._schedule_idle_release()
    
    def _send_callback(self, task: SeparationTask):
        """发送进度回调"""
        if not task.callback_url:
            return
        
        try:
            import requests
            payload = {
                'task_id': task.task_id,
                'status': task.status,
                'progress': task.progress,
                'stage': task.stage,
                'error': task.error,
                'vocals_path': task.vocals_path,
                'instrumental_path': task.instrumental_path
            }
            requests.post(task.callback_url, json=payload, timeout=5)
        except Exception as e:
            logger.warning(f"Callback failed: {e}")

# 全局worker实例
worker = SeparateWorker()

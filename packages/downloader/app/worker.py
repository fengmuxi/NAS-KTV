"""
后台下载队列：每个选中的歌曲生成一个任务，用线程池异步执行 musicdl 下载。
并发上限由 DOWNLOAD_CONCURRENCY 控制（默认 2，避免压垮分离队列）。
"""
import os
import threading
import time
import uuid
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Optional

from .downloader import get_client, prepare_song

logger = logging.getLogger(__name__)


class DownloadWorker:
    def __init__(self, max_workers: int = 2):
        self.max_workers = max_workers
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        self.tasks: Dict[str, dict] = {}
        self.lock = threading.Lock()

    def set_max_workers(self, n: int) -> None:
        """运行时调整下载并发上限。

        旧线程池 shutdown(wait=False)：在途与排队中的任务继续跑完、线程随后退出；
        新任务走新建的线程池，不丢在途任务也不泄漏线程。
        """
        n = max(1, int(n))
        if n == self.max_workers:
            return
        old = self.executor
        old.shutdown(wait=False)
        self.executor = ThreadPoolExecutor(max_workers=n)
        self.max_workers = n
        logger.info('[step=download/config] max_workers -> %d', n)

    def submit(self, song, source_key: str) -> str:
        task_id = uuid.uuid4().hex
        now = time.time()
        song_name = getattr(song, 'song_name', None)
        with self.lock:
            self.tasks[task_id] = {
                'task_id': task_id,
                'status': 'pending',
                'source': source_key,
                'song_name': song_name,
                'singers': getattr(song, 'singers', None),
                'save_path': None,
                'error': None,
                'created_at': now,
                'updated_at': now,
            }
        logger.info('[step=download/submit] task_id=%s source=%s song=%s', task_id, source_key, song_name)
        self.executor.submit(self._run, task_id, song, source_key)
        return task_id

    def _run(self, task_id, song, source_key):
        t0 = time.time()
        song_name = getattr(song, 'song_name', None)
        self._update(task_id, status='processing')
        logger.info('[step=download/start] task_id=%s source=%s song=%s', task_id, source_key, song_name)
        # 下载前：打印歌曲完整元数据
        singers = getattr(song, 'singers', None)
        album = getattr(song, 'album', None)
        duration = getattr(song, 'duration', None)
        ext = getattr(song, 'ext', None)
        size = getattr(song, 'file_size', None)
        lyric = bool(getattr(song, 'lyric', None))
        logger.info(
            '[step=download/precheck] task_id=%s name=%r singers=%r album=%r duration=%r ext=%r size=%r lyric=%s',
            task_id, song_name, singers, album, duration, ext, size, lyric,
        )
        try:
            prepare_song(song, source_key)
            client = get_client()
            logger.debug('[step=download/run] task_id=%s calling musicdl client.download([%s])', task_id, song_name)
            downloaded = client.download([song])
            elapsed = time.time() - t0
            logger.debug('[step=download/run] task_id=%s returned=%r', task_id, downloaded)
            if not downloaded:
                self._update(task_id, status='failed',
                             error='无可用下载链接或下载被跳过')
                logger.warning('[step=download/failed] task_id=%s no link/skipped elapsed=%.2fs', task_id, elapsed)
                return
            # 完成后：打印最终落盘路径 + 实际文件大小
            save_path = getattr(song, 'save_path', None)
            file_size = os.path.getsize(save_path) if save_path and os.path.exists(save_path) else None
            self._update(task_id, status='completed', save_path=save_path)
            logger.info(
                '[step=download/done] task_id=%s save_path=%s file_size=%s bytes elapsed=%.2fs',
                task_id, save_path, file_size, elapsed,
            )
        except Exception as exc:  # noqa: BLE001 - 任务级容错，错误信息回传前端
            elapsed = time.time() - t0
            self._update(task_id, status='failed', error=str(exc))
            logger.exception('[step=download/error] task_id=%s elapsed=%.2fs', task_id, elapsed)

    def _update(self, task_id, **kwargs):
        with self.lock:
            task = self.tasks.get(task_id)
            if task:
                task.update(kwargs)
                task['updated_at'] = time.time()

    def get_task(self, task_id):
        with self.lock:
            return self.tasks.get(task_id)

    def cancel(self, task_id) -> bool:
        with self.lock:
            task = self.tasks.get(task_id)
            if not task:
                logger.warning('[step=download/cancel] failed task_id=%s (not found)', task_id)
                return False
            if task['status'] in ('completed', 'failed', 'cancelled'):
                logger.warning('[step=download/cancel] failed task_id=%s (already %s)', task_id, task['status'])
                return False
            task['status'] = 'cancelled'
            task['updated_at'] = time.time()
            logger.info('[step=download/cancel] ok task_id=%s', task_id)
            return True


worker = DownloadWorker(max_workers=int(os.environ.get('DOWNLOAD_CONCURRENCY', '2')))

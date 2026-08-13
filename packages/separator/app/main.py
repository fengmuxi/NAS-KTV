import os
import re
import asyncio
import logging
from datetime import datetime
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from app.models import (
    HealthResponse, SeparateRequest, SeparateResponse, TaskStatusResponse,
    GpuInfoResponse, InstallResponse, InstallStatusResponse,
)
from app.worker import worker
from app.install_manager import install_manager

# 手动加载项目根目录 .env 文件（不依赖 python-dotenv）
# 从本文件逐级向上查找，兼容本地（仓库根）与 Docker（/app）不同层级
_project_root = Path(__file__).resolve().parent
while (_project_root / '.env').exists() is False and _project_root.parent != _project_root:
    _project_root = _project_root.parent
_env_file = _project_root / '.env'
if _env_file.exists():
    with open(_env_file, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            match = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)=(.*)$', line)
            if match:
                key, value = match.group(1), match.group(2).strip().strip('"').strip("'")
                os.environ.setdefault(key, value)

# HuggingFace 镜像源：未设置时自动使用国内镜像
if not os.environ.get('HF_ENDPOINT'):
    os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class MemoryLogHandler(logging.Handler):
    def __init__(self, max_size=500):
        super().__init__()
        self.max_size = max_size
        self.logs = []

    def emit(self, record):
        entry = {
            'timestamp': datetime.fromtimestamp(record.created).isoformat(),
            'level': record.levelname.lower(),
            'message': self.format(record),
            'logger': record.name,
        }
        self.logs.append(entry)
        if len(self.logs) > self.max_size:
            self.logs = self.logs[-self.max_size:]

memory_handler = MemoryLogHandler(max_size=2000)
memory_handler.setFormatter(logging.Formatter('%(message)s'))
logging.getLogger().addHandler(memory_handler)

# 全局状态
device = "cpu"
model_loaded = False

# 尝试导入可选模块（这些模块会在后续任务中创建）
try:
    from app.audio_utils import check_ffmpeg, get_ffmpeg_path, get_ffprobe_path
except ImportError:
    def check_ffmpeg() -> bool:
        return False
    def get_ffmpeg_path() -> str:
        return 'ffmpeg'
    def get_ffprobe_path() -> str:
        return 'ffprobe'

def detect_device():
    """检测GPU/CPU环境，兼容Docker

    优先级：
    1. 环境变量 SEPARATOR_DEVICE 强制指定（cpu / cuda / auto）
    2. 自动检测 CUDA 可用性
    Docker中若未挂载 GPU，CUDA不可用会自动降级到 CPU
    """
    global device
    forced = os.environ.get('SEPARATOR_DEVICE', 'auto').lower().strip()

    if forced == 'cpu':
        device = 'cpu'
        logger.info('SEPARATOR_DEVICE=cpu, using CPU')
        return

    if forced == 'cuda':
        try:
            import torch
            if torch.cuda.is_available():
                device = 'cuda'
                logger.info(f'SEPARATOR_DEVICE=cuda, GPU: {torch.cuda.get_device_name(0)}')
            else:
                device = 'cpu'
                logger.warning('SEPARATOR_DEVICE=cuda but CUDA unavailable, falling back to CPU')
        except ImportError:
            device = 'cpu'
            logger.warning('SEPARATOR_DEVICE=cuda but PyTorch not installed, using CPU')
        return

    # auto mode
    try:
        import torch
        if torch.cuda.is_available():
            device = 'cuda'
            logger.info(f'GPU detected: {torch.cuda.get_device_name(0)}')
        else:
            device = 'cpu'
            logger.info('No GPU detected, using CPU')
    except ImportError:
        device = 'cpu'
        logger.warning('PyTorch not installed, using CPU')

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期"""
    logger.info("Starting NASKTV Separator Service...")
    detect_device()
    ffmpeg_path = get_ffmpeg_path()
    ffprobe_path = get_ffprobe_path()
    ffmpeg_ok = check_ffmpeg()
    logger.info(f"FFmpeg path: {ffmpeg_path}")
    logger.info(f"FFprobe path: {ffprobe_path}")
    logger.info(f"FFmpeg available: {ffmpeg_ok}")
    logger.info(f"HF_ENDPOINT: {os.environ.get('HF_ENDPOINT', '(not set)')}")
    worker.start()
    # 后台检测 PyTorch/Demucs 运行时；缺失时自动转入后台安装。
    # 不 await：探测 torch 可能耗时 20-30s，避免阻塞服务启动
    asyncio.create_task(install_manager.start_auto_checkup())
    yield
    worker.stop()
    logger.info("Shutting down NASKTV Separator Service...")

app = FastAPI(
    title="NASKTV Separator",
    description="人声分离微服务 - 基于Demucs v4",
    version="0.1.0",
    lifespan=lifespan
)

# CORS配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health", response_model=HealthResponse)
async def health_check():
    """健康检查"""
    try:
        from app.worker import worker
        queue_size = worker.get_queue_size()
    except ImportError:
        queue_size = 0
    install_status = await install_manager.get_status()
    return HealthResponse(
        device=device,
        ffmpeg_available=check_ffmpeg(),
        model_loaded=model_loaded,
        queue_size=queue_size,
        torch_available=install_status['torch_available'],
        install_state=install_status['state'],
        install_stage=install_status['stage'],
        install_progress=install_status['progress'],
    )

@app.post("/api/separate", response_model=SeparateResponse)
async def create_separation_task(request: SeparateRequest):
    """创建分离任务"""
    # 兜底：PyTorch/Demucs 运行时未就绪时拒绝任务并返回明确信息
    install_status = await install_manager.get_status()
    if not install_status['torch_available'] or not install_status['demucs_available']:
        raise HTTPException(status_code=503, detail=install_status['reason'])

    if not os.path.exists(request.input_path):
        raise HTTPException(status_code=400, detail=f"Input file not found: {request.input_path}")

    task_id = worker.enqueue(
        input_path=request.input_path,
        output_dir=request.output_dir,
        model=request.model,
        callback_url=request.callback_url
    )

    return SeparateResponse(
        task_id=task_id,
        status="pending",
        message="Task created successfully"
    )

@app.get("/api/separate/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(task_id: str):
    """查询任务状态"""
    status = worker.get_task(task_id)

    if not status:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")

    return status

@app.delete("/api/separate/{task_id}")
async def cancel_separation(task_id: str):
    success = worker.cancel_task(task_id)
    if not success:
        raise HTTPException(status_code=404, detail="Task not found or already in terminal state")
    return {"task_id": task_id, "status": "cancelled", "message": "Task cancelled by user"}

@app.post("/api/callback")
async def callback(request: dict):
    """进度回调接口（内部使用）"""
    logger.info(f"Callback received: {request}")
    return {"status": "ok"}

@app.get("/api/gpu/info", response_model=GpuInfoResponse)
async def gpu_info():
    """GPU/引擎信息。torch 探测复用后台安装管理器的缓存，避免每次都触发慢速子进程导入。"""
    from app.gpu_manager import get_gpu_info
    install_status = await install_manager.get_status()
    info = get_gpu_info(torch_info={
        'version': install_status.get('torch_version'),
        'cuda_available': install_status.get('cuda_available', False),
        'cuda_version': install_status.get('torch_cuda_version'),
    })
    info.torch_available = install_status['torch_available']
    info.install_state = install_status['state']
    info.install_stage = install_status['stage']
    info.install_progress = install_status['progress']
    return info

async def sse_forward_install(proxy: str, target: str):
    """触发后台安装并转发其实时日志（SSE）。安装全程在后台进行，连接断开不影响安装。"""
    if not proxy:
        proxy = None
    accepted, msg = await install_manager.trigger_install(target=target, proxy=proxy)
    yield f"data: {msg}\n\n"
    async for line in install_manager.stream_install_logs(from_ts=install_manager.current_log_tail_ts()):
        yield f"data: {line}\n\n"
    yield "data: [DONE]\n\n"

@app.post("/api/gpu/install-gpu")
async def install_gpu(proxy: str = None):
    from fastapi.responses import StreamingResponse

    return StreamingResponse(
        sse_forward_install(proxy, 'cuda'),
        media_type="text/event-stream",
    )

@app.post("/api/gpu/install-cpu")
async def install_cpu(proxy: str = None):
    from fastapi.responses import StreamingResponse

    return StreamingResponse(
        sse_forward_install(proxy, 'cpu'),
        media_type="text/event-stream",
    )

@app.get("/api/install/status", response_model=InstallStatusResponse)
async def install_status():
    """查询 PyTorch/Demucs 后台安装状态（后台监控安装）"""
    return await install_manager.get_status()

@app.post("/api/install/trigger")
async def trigger_install(body: dict = None):
    """手动触发后台安装：{ target: auto|cpu|cuda, mode: pip|wheel, proxy: str }"""
    body = body or {}
    target = body.get('target') or 'auto'
    if target not in ('auto', 'cpu', 'cuda'):
        raise HTTPException(status_code=400, detail=f"target 仅支持 auto/cpu/cuda: {target}")
    mode = body.get('mode') or None
    if mode is not None and mode not in ('pip', 'wheel'):
        raise HTTPException(status_code=400, detail=f"mode 仅支持 pip/wheel: {mode}")
    ok, msg = await install_manager.trigger_install(target=target, mode=mode, proxy=body.get('proxy'))
    return {"accepted": ok, "message": msg}

@app.post("/api/install/upload")
async def upload_install_file(file: UploadFile = File(...)):
    """上传 PyTorch 离线安装包（.whl）到后台安装目录，引擎未就绪时自动转入后台离线安装。"""
    if not file.filename or not file.filename.lower().endswith('.whl'):
        raise HTTPException(status_code=400, detail="仅支持上传 .whl 离线安装包")
    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="上传文件为空")
    install_manager.save_wheel_file(file.filename, content)

    status = await install_manager.get_status()
    auto_started = False
    if status['state'] in ('not_installed', 'failed'):
        ok, msg = await install_manager.trigger_install(mode='wheel')
        auto_started = ok
        if ok:
            status = await install_manager.get_status()
    return {
        "uploaded": file.filename,
        "wheel_files": install_manager.get_wheel_files(),
        "install_state": status['state'],
        "auto_started": auto_started,
        "message": "已上传离线安装包，引擎将在后台自动安装" if auto_started else "已上传离线安装包",
    }

@app.get("/api/logs")
async def get_logs(level: str = None, limit: int = 100):
    logs = memory_handler.logs
    if level:
        level_order = {'debug': 10, 'info': 20, 'warning': 30, 'error': 40}
        min_level = level_order.get(level.lower(), 0)
        level_map = {'debug': 10, 'info': 20, 'warning': 30, 'error': 40, 'critical': 50}
        logs = [l for l in logs if level_map.get(l['level'], 0) >= min_level]
    return {"logs": logs[-limit:]}

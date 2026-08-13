from pydantic import BaseModel, Field
from typing import Optional, Literal, List
from enum import Enum

class TaskStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"

class SeparateRequest(BaseModel):
    input_path: str = Field(..., description="输入文件路径")
    output_dir: str = Field(..., description="输出目录")
    model: str = Field(default="htdemucs", description="Demucs模型名称")
    callback_url: Optional[str] = Field(default=None, description="进度回调URL")

class SeparateResponse(BaseModel):
    task_id: str
    status: TaskStatus
    message: str

class TaskStatusResponse(BaseModel):
    task_id: str
    status: TaskStatus
    progress: float = Field(default=0, description="进度0-100")
    stage: Optional[str] = Field(default=None, description="当前阶段")
    vocals_path: Optional[str] = None
    instrumental_path: Optional[str] = None
    error: Optional[str] = None
    created_at: float
    started_at: Optional[float] = None
    completed_at: Optional[float] = None

class HealthResponse(BaseModel):
    status: str = "ok"
    device: str = Field(..., description="cuda or cpu")
    ffmpeg_available: bool
    model_loaded: bool
    queue_size: int
    torch_available: bool = Field(default=False, description="PyTorch 运行时是否就绪")
    install_state: str = Field(default="unknown", description="installed/installing/failed/not_installed")
    install_stage: Optional[str] = Field(default=None, description="后台安装当前阶段")
    install_progress: float = Field(default=0, description="后台安装进度0-100")

class InstallStatusResponse(BaseModel):
    state: str = Field(description="installed/installing/failed/not_installed")
    mode: Optional[str] = Field(default=None, description="安装模式 pip/wheel")
    target: Optional[str] = Field(default=None, description="安装目标 cpu/cuda")
    stage: Optional[str] = Field(default=None, description="安装阶段 torch/demucs/verifying")
    progress: float = Field(default=0, description="安装进度0-100")
    error: Optional[str] = Field(default=None, description="安装失败原因")
    torch_available: bool = Field(default=False)
    torch_version: Optional[str] = Field(default=None)
    torch_cuda_version: Optional[str] = Field(default=None)
    demucs_available: bool = Field(default=False)
    demucs_version: Optional[str] = Field(default=None)
    install_dir: str = Field(description="离线安装包目录")
    wheel_files: List[str] = Field(default_factory=list, description="已上传的离线安装包")
    logs: List[str] = Field(default_factory=list, description="后台安装日志")
    started_at: Optional[float] = Field(default=None)
    finished_at: Optional[float] = Field(default=None)
    reason: Optional[str] = Field(default=None, description="运行时不可用时的兜底说明")

class CallbackPayload(BaseModel):
    task_id: str
    status: TaskStatus
    progress: float
    stage: Optional[str] = None
    error: Optional[str] = None

class GpuInfoResponse(BaseModel):
    available: bool = Field(description="是否检测到 NVIDIA GPU")
    name: Optional[str] = Field(default=None, description="GPU 名称")
    memory_mb: Optional[int] = Field(default=None, description="GPU 显存(MB)")
    driver_version: Optional[str] = Field(default=None, description="NVIDIA 驱动版本（nvidia-smi）")
    driver_cuda_version: Optional[str] = Field(default=None, description="驱动支持的最高 CUDA 版本（nvidia-smi）")
    cuda_available: bool = Field(default=False, description="PyTorch CUDA 是否可用")
    torch_version: Optional[str] = Field(default=None, description="PyTorch 版本")
    torch_cuda_version: Optional[str] = Field(default=None, description="PyTorch CUDA 版本")
    venv_exists: bool = Field(default=False, description="venv 是否存在")
    torch_available: bool = Field(default=False, description="PyTorch 运行时是否就绪")
    install_state: str = Field(default="unknown", description="后台安装状态")
    install_stage: Optional[str] = Field(default=None)
    install_progress: float = Field(default=0)

class InstallResponse(BaseModel):
    status: str
    message: str

import os
import re
import sys
import json
import shutil
import asyncio
import logging
import subprocess
import platform
from typing import Optional, AsyncGenerator
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)

IS_WINDOWS = platform.system() == 'Windows'
SEPARATOR_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENV_DIR = os.path.join(SEPARATOR_DIR, '.venv')

PYTORCH_INDEX_URL = os.environ.get('PYTORCH_INDEX_URL') or 'https://download.pytorch.org/whl/cu124'
PYTORCH_CPU_INDEX_URL = os.environ.get('PYTORCH_CPU_INDEX_URL') or 'https://download.pytorch.org/whl/cpu'


async def _stream_lines(process: asyncio.subprocess.Process) -> AsyncGenerator[str, None]:
    """按 \n 或 \r 切分流式输出，进度条（\r 刷新）可实时转发，不阻塞到命令结束。"""
    assert process.stdout is not None
    buffer = b''
    while True:
        chunk = await process.stdout.read(128)
        if not chunk:
            break
        buffer += chunk
        while True:
            idx = min(len(buffer), *[i for i in (buffer.find(b'\n'), buffer.find(b'\r')) if i != -1] or [len(buffer)])
            if idx == len(buffer) and idx > 0:
                line_bytes, buffer = buffer, b''
            elif idx < len(buffer):
                line_bytes, buffer = buffer[:idx], buffer[idx + 1:]
            else:
                break
            line = line_bytes.decode('utf-8', errors='replace').rstrip('\r')
            if line:
                yield line + '\n'

    if buffer:
        line = buffer.decode('utf-8', errors='replace').rstrip('\r')
        if line:
            yield line + '\n'

def _get_venv_python() -> str:
    if IS_WINDOWS:
        return os.path.join(VENV_DIR, 'Scripts', 'python.exe')
    return os.path.join(VENV_DIR, 'bin', 'python')


def _get_python() -> str:
    """优先 venv 解释器（本地开发），否则回退当前解释器（Docker 系统 Python）。"""
    venv_python = _get_venv_python()
    if os.path.exists(venv_python):
        return venv_python
    return sys.executable


def _ensure_pip() -> Optional[list[str]]:
    """确保目标解释器有 pip（uv venv 默认不带 pip），返回基础安装命令；失败返回 None。"""
    python = _get_python()

    def check() -> bool:
        try:
            r = subprocess.run([python, '-m', 'pip', '--version'], capture_output=True, timeout=10)
            return r.returncode == 0
        except Exception:
            return False

    if check():
        return [python, '-m', 'pip', 'install', '--progress-bar', 'on']

    uv = shutil.which('uv')
    if uv:
        try:
            subprocess.run(
                [uv, 'pip', 'install', '--python', python, 'pip'],
                capture_output=True, timeout=180, cwd=SEPARATOR_DIR,
            )
        except Exception:
            pass
        if check():
            return [python, '-m', 'pip', 'install', '--progress-bar', 'on']
    return None


def _find_installer() -> tuple[str, list[str]]:
    """返回 (工具名, 基础命令)。优先 pip（非 TTY 下也能输出实时进度条），无 pip 时用 uv 兜底。"""
    pip_cmd = _ensure_pip()
    if pip_cmd:
        return 'pip', pip_cmd
    uv = shutil.which('uv')
    if uv:
        return 'uv', [uv, 'pip', 'install', '--python', _get_python()]
    return 'pip', [_get_python(), '-m', 'pip', 'install']

@dataclass
class GpuInfo:
    available: bool
    name: Optional[str] = None
    memory_mb: Optional[int] = None
    driver_version: Optional[str] = None
    driver_cuda_version: Optional[str] = None
    cuda_available: bool = False
    torch_version: Optional[str] = None
    torch_cuda_version: Optional[str] = None
    venv_exists: bool = False

    def to_dict(self) -> dict:
        return asdict(self)

def detect_nvidia_gpu() -> list[dict]:
    """查询 nvidia-smi：GPU 名称、显存、驱动版本、驱动支持的最高 CUDA 版本。"""
    nvidia_smi = shutil.which('nvidia-smi')
    if not nvidia_smi:
        return []
    try:
        result = subprocess.run(
            [nvidia_smi, '--query-gpu=name,memory.total,driver_version',
             '--format=csv,noheader,nounits'],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            return []
        gpus = []
        for line in result.stdout.strip().split('\n'):
            if not line.strip():
                continue
            parts = [p.strip() for p in line.split(',')]
            if len(parts) >= 2:
                name = parts[0]
                mem = int(parts[1]) if parts[1].strip().isdigit() else 0
                gpu = {'name': name, 'memory_mb': mem}
                if len(parts) >= 3:
                    gpu['driver_version'] = parts[2] or None
                gpus.append(gpu)
        if not gpus:
            return []
        # cuda_version 不是合法的 query 字段，从默认输出的表头解析驱动支持的最高 CUDA 版本
        header = subprocess.run(
            [nvidia_smi], capture_output=True, text=True, timeout=10
        )
        if header.returncode == 0:
            m = re.search(r'CUDA Version:\s*([0-9.]+)', header.stdout[:2000])
            cuda_version = m.group(1) if m else None
            for gpu in gpus:
                gpu['driver_cuda_version'] = cuda_version
        return gpus
    except (FileNotFoundError, subprocess.TimeoutExpired, ValueError):
        return []

def get_torch_info() -> dict:
    python = _get_python()
    if not os.path.exists(python):
        return {}
    try:
        result = subprocess.run(
            [python, '-c',
             'import torch; import json; print(json.dumps({'
             '"version": torch.__version__,'
             '"cuda_available": torch.cuda.is_available(),'
             '"cuda_version": getattr(torch.version, "cuda", None)'
             '}))'],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            return json.loads(result.stdout.strip())
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
        pass
    return {}

def get_gpu_info(torch_info: Optional[dict] = None) -> GpuInfo:
    """GPU 硬件信息 + torch 信息。

    torch_info 可由调用方传入（复用后台安装管理器的探测缓存），
    避免每次请求都触发慢速的子进程 torch 导入。
    """
    gpus = detect_nvidia_gpu()
    if torch_info is None:
        torch_info = get_torch_info()
    return GpuInfo(
        available=len(gpus) > 0,
        name=gpus[0]['name'] if gpus else None,
        memory_mb=gpus[0]['memory_mb'] if gpus else None,
        driver_version=gpus[0].get('driver_version') if gpus else None,
        driver_cuda_version=gpus[0].get('driver_cuda_version') if gpus else None,
        cuda_available=torch_info.get('cuda_available', False),
        torch_version=torch_info.get('version'),
        torch_cuda_version=torch_info.get('cuda_version'),
        venv_exists=os.path.exists(_get_python()),
    )

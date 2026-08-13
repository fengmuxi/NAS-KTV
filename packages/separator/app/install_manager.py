import os
import glob
import time
import json
import asyncio
import logging
import subprocess
from pathlib import Path
from collections import deque
from typing import Optional, List, Tuple, AsyncGenerator

from app.gpu_manager import (
    _get_python,
    _find_installer,
    _stream_lines,
    detect_nvidia_gpu,
    PYTORCH_INDEX_URL,
    PYTORCH_CPU_INDEX_URL,
)

logger = logging.getLogger(__name__)

PYPI_INDEX_URL = os.environ.get('PIP_INDEX_URL') or 'https://pypi.tuna.tsinghua.edu.cn/simple'
PYPI_TRUSTED_HOST = 'pypi.tuna.tsinghua.edu.cn'

# 项目根：与 main.py 相同逻辑（本地=仓库根，Docker=/app）
def _find_project_root() -> Path:
    p = Path(__file__).resolve().parent
    while (p / '.env').exists() is False and p.parent != p:
        p = p.parent
    return p

PROJECT_ROOT = _find_project_root()
INSTALL_DIR = Path(
    os.environ.get('SEPARATOR_INSTALL_DIR') or os.path.join(PROJECT_ROOT, 'data', 'separator-install')
)

# 状态常量
STATE_NOT_INSTALLED = 'not_installed'
STATE_INSTALLING = 'installing'
STATE_INSTALLED = 'installed'
STATE_FAILED = 'failed'

MODES = ('pip', 'wheel')
TARGETS = ('auto', 'cpu', 'cuda')

# 驱动支持的最高 CUDA 版本 → 官方 wheel 渠道（选不高于驱动版本的渠道）
CUDA_WHEEL_INDEXES = [
    (12.4, 'https://download.pytorch.org/whl/cu124'),
    (12.1, 'https://download.pytorch.org/whl/cu121'),
    (11.8, 'https://download.pytorch.org/whl/cu118'),
]


def _resolve_cuda_index(driver_cuda_version: Optional[str]) -> Optional[str]:
    """按驱动支持的 CUDA 版本自动选择兼容的 wheel 渠道；无法判断时返回 None（用默认）。"""
    if driver_cuda_version:
        try:
            v = float(driver_cuda_version)
        except (TypeError, ValueError):
            v = 0.0
        for min_version, url in CUDA_WHEEL_INDEXES:
            if v >= min_version:
                return url
    return None

# 检测结果缓存时长（秒）：torch 首次 import 很慢（CUDA 版可达 20-30s），
# 安装完成后长时间缓存避免每次请求都触发子进程探测
PROBE_CACHE_SECONDS = 300


def _probe_runtime(python: str) -> dict:
    """用子进程探测 torch / demucs 可用性（避免污染当前进程导入状态）。"""
    result = {'torch_available': False, 'torch_version': None, 'torch_cuda': None,
              'cuda_available': False,
              'demucs_available': False, 'demucs_version': None}
    if not os.path.exists(python):
        return result

    def run(code: str):
        try:
            r = subprocess.run(
                [python, '-c', code],
                capture_output=True, text=True, timeout=60,
                encoding='utf-8', errors='replace',
            )
            return r.stdout.strip() if r.returncode == 0 else None
        except (subprocess.SubprocessError, FileNotFoundError):
            return None

    torch_out = run(
        'import torch, json; print(json.dumps({'
        '"version": torch.__version__,'
        '"cuda": getattr(torch.version, "cuda", None),'
        '"cuda_available": torch.cuda.is_available()}))'
    )
    if torch_out:
        try:
            info = json.loads(torch_out)
            result.update({
                'torch_available': True,
                'torch_version': info.get('version'),
                'torch_cuda': info.get('cuda'),
                'cuda_available': bool(info.get('cuda_available')),
            })
        except json.JSONDecodeError:
            pass

    demucs_out = run('import demucs; print(getattr(demucs, "__version__", "ok"))')
    if demucs_out:
        result.update({
            'demucs_available': True,
            'demucs_version': demucs_out,
        })
    return result


class InstallManager:
    """PyTorch/Demucs 后台安装管理器。

    服务启动时自动检测运行时；缺失时在后台安装（pip 在线安装，或
    使用用户上传到 INSTALL_DIR 的 wheel 离线包），不阻塞服务启动。
    安装全程状态可查询（/api/install/status），未就绪时调用方可获得
    明确的兜底信息而非笼统错误。
    """

    def __init__(self):
        self._state = STATE_NOT_INSTALLED
        self._mode: Optional[str] = None  # pip | wheel
        self._target: Optional[str] = None  # cpu | cuda
        self._stage: Optional[str] = None  # torch | demucs | verifying
        self._progress = 0.0
        self._error: Optional[str] = None
        self._started_at: Optional[float] = None
        self._finished_at: Optional[float] = None
        self._logs: deque = deque(maxlen=2000)  # (timestamp, line)
        self._task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()
        self._probe: dict = {}
        self._probe_at = 0.0
        self._probe_lock = asyncio.Lock()
        self._auto_check_done = False

    # ---------- 日志 ----------

    def _log(self, line: str):
        logger.info(f'[install] {line}')
        self._logs.append((time.time(), line))

    # ---------- 状态查询 ----------

    def _probe_cached(self, force: bool = False) -> dict:
        if force or (time.time() - self._probe_at > PROBE_CACHE_SECONDS):
            self._probe = _probe_runtime(_get_python())
            self._probe_at = time.time()
        return self._probe

    async def _probe_async(self, force: bool = False) -> dict:
        stale = time.time() - self._probe_at > PROBE_CACHE_SECONDS
        if force or stale:
            # 锁 + 双检：并发请求共享同一次慢速探测，避免重复子进程导入
            async with self._probe_lock:
                stale = time.time() - self._probe_at > PROBE_CACHE_SECONDS
                if force or stale:
                    self._probe = await asyncio.to_thread(_probe_runtime, _get_python())
                    self._probe_at = time.time()
        return self._probe

    def runtime_ready(self) -> bool:
        probe = self._probe_cached()
        return bool(probe.get('torch_available') and probe.get('demucs_available'))

    def get_unavailable_reason(self) -> str:
        """兜底信息：运行时未就绪时返回给调用方的明确说明。"""
        if self._state == STATE_INSTALLING:
            return (
                f'人声分离引擎（PyTorch/Demucs）正在后台安装中：{self._stage or "准备"}'
                f'（进度 {int(self._progress)}%），安装完成后即可使用，请稍后重试'
                f'或查询安装状态 /api/install/status'
            )
        if self._state == STATE_FAILED:
            return (
                f'人声分离引擎安装失败：{self._error}。'
                f'可在管理后台重试安装，或将离线安装包（wheel 文件）上传至 {INSTALL_DIR}'
            )
        return (
            f'人声分离引擎（PyTorch/Demucs）尚未安装，系统正准备在后台自动安装，'
            f'请稍后重试（安装状态可查询 /api/install/status）'
        )

    async def get_status(self) -> dict:
        """完整安装状态（供 /api/install/status 与 SSE 转发）。"""
        probe = await self._probe_async()
        wheel_files = self.get_wheel_files()
        runtime_ready = bool(probe.get('torch_available') and probe.get('demucs_available'))
        return {
            'state': self._state,
            'mode': self._mode,
            'target': self._target,
            'stage': self._stage,
            'progress': self._progress,
            'error': self._error,
            'torch_available': bool(probe.get('torch_available')),
            'torch_version': probe.get('torch_version'),
            'torch_cuda_version': probe.get('torch_cuda'),
            'cuda_available': bool(probe.get('cuda_available')),
            'demucs_available': bool(probe.get('demucs_available')),
            'demucs_version': probe.get('demucs_version'),
            'install_dir': str(INSTALL_DIR),
            'wheel_files': wheel_files,
            'logs': [line for _, line in self._logs],
            'started_at': self._started_at,
            'finished_at': self._finished_at,
            'reason': None if runtime_ready else self.get_unavailable_reason(),
        }

    # ---------- wheel 文件 ----------

    def get_wheel_files(self) -> List[str]:
        if not INSTALL_DIR.exists():
            return []
        return sorted(Path(p).name for p in glob.glob(str(INSTALL_DIR / '*.whl')))

    def save_wheel_file(self, filename: str, content: bytes) -> Path:
        INSTALL_DIR.mkdir(parents=True, exist_ok=True)
        safe_name = os.path.basename(filename)
        target = INSTALL_DIR / safe_name
        target.write_bytes(content)
        self._log(f'Uploaded install file: {safe_name}')
        return target

    # ---------- 安装触发 ----------

    def _detect_target(self) -> str:
        return 'cuda' if detect_nvidia_gpu() else 'cpu'

    def _resolve_target(self, target: Optional[str]) -> str:
        if target in ('cpu', 'cuda'):
            return target
        return self._detect_target()

    def get_install_plan(self) -> dict:
        """当前环境的自动安装计划（pip 模式）：目标与将使用的 PyTorch 渠道。

        - 无 NVIDIA GPU → CPU 版
        - 有 GPU：按驱动支持的 CUDA 版本自动匹配兼容渠道（12.4/12.1/11.8）；
          驱动 CUDA 版本过低时自动降级 CPU 版（避免装上后 CUDA 不可用）
        - 显式设置了 PYTORCH_INDEX_URL 时优先使用
        """
        target = self._detect_target()
        plan = {'target': target}
        if target == 'cuda':
            gpus = detect_nvidia_gpu()
            driver_cuda = gpus[0].get('driver_cuda_version') if gpus else None
            explicit = os.environ.get('PYTORCH_INDEX_URL')
            if explicit:
                plan['index_url'] = explicit
                plan['index_reason'] = 'PYTORCH_INDEX_URL 环境变量'
            else:
                chosen = _resolve_cuda_index(driver_cuda)
                if chosen:
                    plan['index_url'] = chosen
                    plan['index_reason'] = f'按驱动支持的 CUDA {driver_cuda} 自动匹配'
                else:
                    plan['target'] = 'cpu'
                    plan['index_url'] = PYTORCH_CPU_INDEX_URL
                    plan['index_reason'] = (
                        f'驱动支持的 CUDA 版本过低（{driver_cuda}），自动降级为 CPU 版；'
                        '升级 NVIDIA 驱动后可在管理后台重装 CUDA 版'
                    )
            plan['driver_cuda_version'] = driver_cuda
        else:
            plan['index_url'] = PYTORCH_CPU_INDEX_URL
            plan['index_reason'] = '未检测到 NVIDIA GPU，自动选择 CPU 版'
        return plan

    async def trigger_install(self, target: Optional[str] = None,
                              mode: Optional[str] = None,
                              proxy: Optional[str] = None) -> Tuple[bool, str]:
        """触发后台安装；已在安装中则返回 (False, 当前状态说明)。

        target: auto | cpu | cuda（None=auto）
        mode:   pip | wheel（None=自动：install 目录有 wheel 则用 wheel）
        """
        async with self._lock:
            if self._state == STATE_INSTALLING:
                return False, (
                    f'安装已在后台进行中（目标 {self._target}，模式 {self._mode}，'
                    f'阶段 {self._stage or "准备"}），请稍后重试'
                )
            resolved_target = self._resolve_target(target)
            # auto 模式下若驱动不支持任何 CUDA 渠道，自动降级 CPU 版
            if resolved_target == 'cuda' and target in (None, 'auto'):
                if self.get_install_plan().get('target') == 'cpu':
                    resolved_target = 'cpu'
            resolved_mode = mode
            if resolved_mode is None:
                resolved_mode = 'wheel' if self.get_wheel_files() else 'pip'
            if resolved_mode not in MODES:
                return False, f'不支持的安装模式: {resolved_mode}'
            if resolved_mode == 'wheel' and not self.get_wheel_files():
                return False, '未找到离线安装包（wheel 文件），请先上传到 ' + str(INSTALL_DIR)

            self._state = STATE_INSTALLING
            self._mode = resolved_mode
            self._target = resolved_target
            self._stage = 'preparing'
            self._progress = 0.0
            self._error = None
            self._started_at = time.time()
            self._finished_at = None
            self._logs.clear()
            self._log(f'后台安装启动：目标={resolved_target}，模式={resolved_mode}')
            self._task = asyncio.create_task(self._install(proxy))
            return True, '安装任务已在后台启动'

    async def start_auto_checkup(self):
        """服务启动时调用：检测运行时（后台执行，不阻塞服务启动），缺失则自动在后台安装。"""
        if self._auto_check_done:
            return
        self._auto_check_done = True
        try:
            probe = await self._probe_async(force=True)
            if probe.get('torch_available') and probe.get('demucs_available'):
                self._state = STATE_INSTALLED
                self._log(
                    f'运行时就绪：PyTorch {probe.get("torch_version")}'
                    f'（CUDA {"可用" if probe.get("torch_cuda") else "不可用"}），'
                    f'Demucs {probe.get("demucs_version")}'
                )
                return
            ok, msg = await self.trigger_install()
            if not ok:
                self._state = STATE_FAILED
                self._error = msg
                self._log(f'后台安装启动失败: {msg}')
            else:
                self._log('运行时尚缺，已自动转入后台安装')
        except Exception as e:
            logger.exception('Auto install checkup failed')
            self._state = STATE_FAILED
            self._error = str(e)

    # ---------- 后台安装执行 ----------

    async def _run_pip(self, args: list, env: dict, stage: str) -> int:
        """执行一条 pip 安装命令，日志实时收集。"""
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(PROJECT_ROOT),
            env=env,
        )
        async for line in _stream_lines(process):
            self._log(f'{stage}: {line}')
        await process.wait()
        return process.returncode

    async def _install(self, proxy: Optional[str]):
        """后台安装主流程：torch（pip/wheel）→ demucs → 校验。"""
        env = os.environ.copy()
        if proxy:
            env['HTTP_PROXY'] = proxy
            env['HTTPS_PROXY'] = proxy
            env['ALL_PROXY'] = proxy

        tool, base_cmd = _find_installer()
        try:
            # 步骤 1：torch + torchaudio
            self._stage = 'torch'
            self._progress = 10
            self._log(f'[{tool}] 安装 PyTorch（目标 {self._target}）...')
            if self._mode == 'wheel':
                wheels = self.get_wheel_files()
                cmd = base_cmd + ['--find-links', str(INSTALL_DIR)] + [
                    str(INSTALL_DIR / w) for w in wheels
                ]
                self._log(f'使用离线安装包: {", ".join(wheels)}')
            else:
                plan = self.get_install_plan()
                index_url = plan['index_url']
                self._log(f'在线源: {index_url}（{plan["index_reason"]}）')
                cmd = base_cmd + ['torch', 'torchaudio', '--index-url', index_url]
            self._progress = 25
            rc = await self._run_pip(cmd, env, 'torch')
            if rc != 0:
                raise RuntimeError(f'PyTorch 安装失败（exit {rc}）')
            self._progress = 60
            self._log('PyTorch 安装完成')

            # 步骤 2：demucs（PyPI 镜像；torch 已装时不会重复拉取）
            probe = await self._probe_async(force=True)
            if not probe.get('demucs_available'):
                self._stage = 'demucs'
                self._progress = 65
                self._log('安装 Demucs ...')
                cmd = base_cmd + ['demucs', '--index-url', PYPI_INDEX_URL]
                rc = await self._run_pip(cmd, env, 'demucs')
                if rc != 0:
                    raise RuntimeError(f'Demucs 安装失败（exit {rc}）')
            self._progress = 90

            # 步骤 3：校验
            self._stage = 'verifying'
            probe = await self._probe_async(force=True)
            if not probe.get('torch_available'):
                raise RuntimeError('PyTorch 校验失败：导入异常')
            if not probe.get('demucs_available'):
                raise RuntimeError('Demucs 校验失败：导入异常')

            self._state = STATE_INSTALLED
            self._progress = 100
            self._stage = 'done'
            self._finished_at = time.time()
            self._log(
                f'后台安装完成：PyTorch {probe.get("torch_version")}'
                f'（CUDA {"可用" if probe.get("torch_cuda") else "不可用"}），'
                f'Demucs {probe.get("demucs_version")}'
            )
        except Exception as e:
            self._state = STATE_FAILED
            self._error = str(e)
            self._stage = None
            self._finished_at = time.time()
            self._log(f'后台安装失败: {e}')
            logger.exception('Background install failed')

    # ---------- SSE 转发 ----------

    async def stream_install_logs(self, from_ts: Optional[float] = None) -> AsyncGenerator[str, None]:
        """按 (timestamp, line) 顺序转发安装日志，直到进入终态且日志发送完毕。"""
        seen = from_ts if from_ts is not None else 0.0
        sent_until = seen
        while True:
            for ts, line in self._logs:
                if ts > sent_until:
                    sent_until = ts
                    yield line
            if self._state in (STATE_INSTALLED, STATE_FAILED):
                return
            await asyncio.sleep(0.5)

    def current_log_tail_ts(self) -> float:
        """当前日志尾部时间戳（SSE 从此刻起转发，避免重放历史日志）。"""
        return self._logs[-1][0] if self._logs else time.time()


install_manager = InstallManager()

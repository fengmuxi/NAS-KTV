import os
import sys
import argparse
import subprocess
import shutil
import platform

IS_WINDOWS = platform.system() == 'Windows'
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SEPARATOR_DIR = os.path.dirname(SCRIPT_DIR)
VENV_DIR = os.path.join(SEPARATOR_DIR, '.venv')

PYPI_INDEX_URL = os.environ.get('PIP_INDEX_URL') or 'https://pypi.tuna.tsinghua.edu.cn/simple'
PYPI_TRUSTED_HOST = 'pypi.tuna.tsinghua.edu.cn'
PYTORCH_INDEX_URL = os.environ.get('PYTORCH_INDEX_URL') or 'https://download.pytorch.org/whl/cu124'

def get_venv_python():
    if IS_WINDOWS:
        return os.path.join(VENV_DIR, 'Scripts', 'python.exe')
    return os.path.join(VENV_DIR, 'bin', 'python')

def find_uv():
    uv = shutil.which('uv')
    if uv:
        return uv
    raise FileNotFoundError('uv not found. Install: https://docs.astral.sh/uv/')

def run_uv(*args, check=True):
    uv = find_uv()
    cmd = [uv] + list(args)
    print(f'  > {" ".join(cmd)}')
    return subprocess.run(cmd, check=check, cwd=SEPARATOR_DIR)

def run_uv_stream(*args):
    uv = find_uv()
    cmd = [uv] + list(args)
    print(f'  > {" ".join(cmd)}')
    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding='utf-8',
        errors='replace',
        cwd=SEPARATOR_DIR,
    )
    for line in iter(process.stdout.readline, ''):
        print(f'  {line}', end='')
    process.wait()
    return process.returncode

def create_venv():
    if os.path.exists(get_venv_python()):
        print(f'[setup] venv already exists at {VENV_DIR}')
        return
    print(f'[setup] Creating venv at {VENV_DIR} ...')
    run_uv('venv', VENV_DIR, '--python', '3.12')
    print('[setup] venv created.')

def install_base_deps():
    req_file = os.path.join(SEPARATOR_DIR, 'requirements.txt')
    print(f'[setup] Installing base dependencies from {req_file} (PyTorch/Demucs not included, installed separately) ...')
    print(f'[setup] Using mirror: {PYPI_INDEX_URL}')
    run_uv('pip', 'install',
        '--python', get_venv_python(),
        '-r', req_file,
        '--index-url', PYPI_INDEX_URL,
        '--trusted-host', PYPI_TRUSTED_HOST,
    )
    print('[setup] Base dependencies installed.')

def install_torch():
    """同步安装 PyTorch + Demucs（--with-torch 模式）。有 NVIDIA GPU 时安装 CUDA 版，否则 CPU 版。"""
    gpus = detect_gpu()
    if gpus:
        target = 'cuda'
        index_url = PYTORCH_INDEX_URL
        print(f'[setup] Detected GPU: {gpus[0]["name"]}')
    else:
        target = 'cpu'
        index_url = os.environ.get('PYTORCH_CPU_INDEX_URL') or 'https://download.pytorch.org/whl/cpu'
    print(f'[setup] Installing {target} PyTorch ...')
    print(f'[setup] PyTorch index: {index_url}')
    print(f'[setup] This may take several minutes depending on network speed.')
    print('')
    rc = run_uv_stream('pip', 'install',
        '--python', get_venv_python(),
        '--force-reinstall',
        'torch', 'torchaudio',
        '--index-url', index_url,
    )
    if rc != 0:
        print(f'\n[setup] PyTorch installation failed (exit code {rc})')
        return False
    print(f'\n[setup] {target} PyTorch installed.')

    req_file = os.path.join(SEPARATOR_DIR, 'requirements-runtime.txt')
    print(f'\n[setup] Installing Demucs from {req_file} ...')
    rc = run_uv_stream('pip', 'install',
        '--python', get_venv_python(),
        '-r', req_file,
        '--index-url', PYPI_INDEX_URL,
        '--trusted-host', PYPI_TRUSTED_HOST,
    )
    if rc != 0:
        print(f'\n[setup] Demucs installation failed (exit code {rc})')
        return False
    print('\n[setup] Demucs installed.')
    return True

def verify_installation():
    python = get_venv_python()
    print('[setup] Verifying installation ...')
    result = subprocess.run(
        [python, '-c', 'import torch; print(f"PyTorch {torch.__version__}, CUDA: {torch.cuda.is_available()}")'],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        print(f'[setup] {result.stdout.strip()}')
    else:
        print(f'[setup] Warning: Could not verify PyTorch: {result.stderr.strip()}')

    result = subprocess.run(
        [python, '-c', 'import demucs; print("Demucs OK")'],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        print(f'[setup] {result.stdout.strip()}')
    else:
        print(f'[setup] Warning: Could not verify Demucs: {result.stderr.strip()}')

def detect_gpu():
    nvidia_smi = shutil.which('nvidia-smi')
    if not nvidia_smi:
        return []
    try:
        result = subprocess.run(
            [nvidia_smi, '--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0 and result.stdout.strip():
            gpus = []
            for line in result.stdout.strip().split('\n'):
                if not line.strip():
                    continue
                parts = [p.strip() for p in line.split(',')]
                if len(parts) >= 2:
                    gpus.append({'name': parts[0], 'memory_mb': int(parts[1]) if parts[1].isdigit() else 0})
            return gpus
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return []

def main():
    print('=' * 50)
    print('NASKTV Separator - Venv Setup')
    print('=' * 50)

    parser = argparse.ArgumentParser(description='NASKTV Separator venv setup')
    parser.add_argument('--with-torch', action='store_true',
                        help='同步安装 PyTorch + Demucs（默认由服务启动后后台自动安装）')
    args = parser.parse_args()

    create_venv()
    install_base_deps()

    gpus = detect_gpu()
    if gpus:
        print(f'\n[setup] Detected GPU: {gpus[0]["name"]}')
    else:
        print('\n[setup] No NVIDIA GPU detected.')

    if args.with_torch:
        if not install_torch():
            sys.exit(1)
        verify_installation()
    else:
        print('\n[setup] PyTorch/Demucs 未安装。分隔服务启动后将自动在后台安装'
              '（也可手动执行 setup_venv.py --with-torch 同步安装，'
              '或将离线 .whl 安装包放入 data/separator-install/ 由服务后台离线安装）。')

    print('\n' + '=' * 50)
    print('Setup complete!')
    print(f'Venv: {VENV_DIR}')
    print(f'Python: {get_venv_python()}')
    print('=' * 50)

if __name__ == '__main__':
    main()

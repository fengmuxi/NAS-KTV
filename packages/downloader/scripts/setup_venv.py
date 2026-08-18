import os
import sys
import subprocess
import shutil
import platform

IS_WINDOWS = platform.system() == 'Windows'
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DOWNLOADER_DIR = os.path.dirname(SCRIPT_DIR)
VENV_DIR = os.path.join(DOWNLOADER_DIR, '.venv')

PYPI_INDEX_URL = os.environ.get('PIPI_INDEX_URL') or 'https://pypi.tuna.tsinghua.edu.cn/simple'
PYPI_TRUSTED_HOST = 'pypi.tuna.tsinghua.edu.cn'

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
    return subprocess.run(cmd, check=check, cwd=DOWNLOADER_DIR)

def create_venv():
    if os.path.exists(get_venv_python()):
        print(f'[setup] venv already exists at {VENV_DIR}')
        return
    print(f'[setup] Creating venv at {VENV_DIR} ...')
    run_uv('venv', VENV_DIR, '--python', '3.12')
    print('[setup] venv created.')

def install_deps():
    req_file = os.path.join(DOWNLOADER_DIR, 'requirements.txt')
    print(f'[setup] Installing dependencies from {req_file} ...')
    print(f'[setup] Using mirror: {PYPI_INDEX_URL}')
    run_uv('pip', 'install',
        '--python', get_venv_python(),
        '-r', req_file,
        '--index-url', PYPI_INDEX_URL,
        '--trusted-host', PYPI_TRUSTED_HOST,
    )
    print('[setup] Dependencies installed.')

def verify_installation():
    python = get_venv_python()
    print('[setup] Verifying installation ...')
    result = subprocess.run(
        [python, '-c', 'import musicdl, fastapi, uvicorn; print("musicdl + fastapi OK")'],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        print(f'[setup] {result.stdout.strip()}')
    else:
        print(f'[setup] Warning: verify failed: {result.stderr.strip()}')

def main():
    print('=' * 50)
    print('NASKTV Downloader - Venv Setup')
    print('=' * 50)

    create_venv()
    install_deps()
    verify_installation()

    print('\n' + '=' * 50)
    print('Setup complete!')
    print(f'Venv: {VENV_DIR}')
    print(f'Python: {get_venv_python()}')
    print('=' * 50)

if __name__ == '__main__':
    main()

# 声明 VITE_API_BASE_URL：docker.yml 通过 --build-arg 把它透传给所有镜像，
# 本镜像虽不消费该参数，声明后可消除 buildx "build arg 未消费" 的告警。
ARG VITE_API_BASE_URL

FROM python:3.11-slim

WORKDIR /app

# 默认走清华 PyPI 镜像（与 setup_venv.py / install_manager 一致），放宽超时与重试
ENV PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple \
    PIP_TRUSTED_HOST=pypi.tuna.tsinghua.edu.cn \
    PIP_DEFAULT_TIMEOUT=600 \
    PIP_RETRIES=8

# 系统依赖：ffmpeg（音频解码）+ libsndfile1（soundfile 运行时依赖）+ OpenMP（torch 运行时）+ 编译工具（多架构运行时安装 wheel 回退用）
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    libgomp1 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 先升级 pip（旧版无法为部分包构建 wheel）
RUN pip install --no-cache-dir --upgrade pip

# 仅安装轻量基础依赖（fastapi/uvicorn/numpy/pydantic/python-multipart/requests/soundfile）。
# PyTorch / Demucs 体积大（torch ~2GB），不在镜像内预装——由 app/install_manager.py 在
# 容器启动时后台自动安装（按 GPU 自动选 CPU/CUDA 渠道，或用 data/separator-install/ 下
# 离线 wheel），状态可经 /api/install/status 查询、不阻塞服务启动。这样大幅减小镜像体积
# 与构建时间。启动钩子见 main.py lifespan 中的 start_auto_checkup()。
COPY requirements.txt ./
RUN pip install --no-cache-dir --retries 8 --timeout 600 -r requirements.txt

COPY pyproject.toml ./
COPY app/ ./app/

RUN mkdir -p /app/cache /app/data /app/data/separator-install

ENV TORCH_HOME=/app/cache \
    DEMUCS_CACHE=/app/cache \
    HF_ENDPOINT=https://hf-mirror.com \
    SEPARATOR_INSTALL_DIR=/app/data/separator-install

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/api/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]

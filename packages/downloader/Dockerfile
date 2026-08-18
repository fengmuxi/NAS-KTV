# 声明 VITE_API_BASE_URL：docker.yml 通过 --build-arg 透传，本镜像不消费但消除 buildx 告警
ARG VITE_API_BASE_URL

FROM python:3.11-slim

WORKDIR /app

# 默认走清华 PyPI 镜像，放宽超时与重试
ENV PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple \
    PIP_TRUSTED_HOST=pypi.tuna.tsinghua.edu.cn \
    PIP_DEFAULT_TIMEOUT=600 \
    PIP_RETRIES=8

# 系统依赖：ffmpeg（HLS/混流，部分源可能用到）+ libsndfile1（soundfile 运行时）
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --upgrade pip

# musicdl 会拉取自身依赖（requests/mutagen/rich/click/json_repair/pycryptodome 等）
COPY requirements.txt ./
RUN pip install --no-cache-dir --retries 8 --timeout 600 -r requirements.txt

COPY app/ ./app/

RUN mkdir -p /app/data/songs/Downloads

ENV DOWNLOAD_DIR=/app/data/songs/Downloads \
    DOWNLOAD_CONCURRENCY=2

EXPOSE 8002

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8002/api/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]

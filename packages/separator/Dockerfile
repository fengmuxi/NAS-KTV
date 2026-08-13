FROM python:3.11-slim

WORKDIR /app

# Install system dependencies: ffmpeg + build tools for compiling Python extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgomp1 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip FIRST — old pip (24.0) cannot build wheels for scipy/numpy etc.
RUN pip install --no-cache-dir --upgrade pip

COPY pyproject.toml requirements.txt ./
COPY app/ ./app/

# Install PyTorch CPU-only first (largest package ~2GB, separate step for caching/retry)
# Using PyTorch CPU stable channel with extended timeout
RUN pip install --no-cache-dir --retries 5 --timeout 300 \
    torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# Install remaining dependencies: base app deps + runtime engine (demucs; torch 已装时不会重复拉取)
RUN pip install --no-cache-dir --retries 5 --timeout 120 \
    -r requirements.txt -r requirements-runtime.txt

RUN mkdir -p /app/cache /app/data /app/data/separator-install

ENV TORCH_HOME=/app/cache
ENV DEMUCS_CACHE=/app/cache
ENV HF_ENDPOINT=https://hf-mirror.com

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/api/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]

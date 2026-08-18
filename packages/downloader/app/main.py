"""
Downloader 微服务入口（FastAPI）。

提供：
- GET  /api/health                      健康检查
- GET  /api/download/platforms          可用平台列表
- POST /api/config                       运行时更新配置（启用源 / 下载并发）
- POST /api/download/search             多源搜索（结果缓存在服务端，返回轻量描述 + key）
- POST /api/download                    按 key 批量提交下载任务
- GET  /api/download/{task_id}          任务状态
- POST /api/download/{task_id}/cancel   取消任务
"""
import os
import re
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware


def _setup_logging() -> logging.Logger:
    """为 downloader 自身日志配置独立控制台处理器（默认 DEBUG，详细输出到控制台）。

    只作用于 `app` 命名空间下的 logger，不影响 musicdl / uvicorn 等第三方库的日志级别；
    通过 propagate=False 避免与 uvicorn 的 root handler 重复打印。
    可用环境变量 DOWNLOADER_LOG_LEVEL 覆盖（DEBUG/INFO/WARNING...）。
    """
    logger = logging.getLogger('app')
    if not logger.handlers:
        # Windows 控制台/管道默认 GBK 编码，musicdl 返回的歌名常含非常规字符
        # （如日文人名中点 \u30fb），日志写入时会抛 UnicodeEncodeError 导致进程崩溃。
        # 强制 stdout/stderr 使用 UTF-8，从根本上避免编码崩溃（不影响日志内容）。
        for _stream in (sys.stdout, sys.stderr):
            if hasattr(_stream, 'reconfigure'):
                try:
                    _stream.reconfigure(encoding='utf-8')
                except (ValueError, OSError):
                    pass
        level_name = os.environ.get('DOWNLOADER_LOG_LEVEL', 'DEBUG').upper()
        level = getattr(logging, level_name, logging.DEBUG)
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter(
                '%(asctime)s [%(levelname)s] %(name)s: %(message)s',
                datefmt='%Y-%m-%d %H:%M:%S',
            )
        )
        logger.addHandler(handler)
        logger.setLevel(level)
        logger.propagate = False
    return logger


logger = _setup_logging()

from .models import (
    ConfigRequest,
    DownloadRequest,
    PlatformInfo,
    SearchRequest,
    SongDescriptor,
    TaskStatus,
)
from .downloader import (
    DOWNLOAD_DIR,
    LABELS,
    SOURCES,
    SEARCH_CACHE,
    _song_summary,
    get_search_task,
    submit_search,
    enabled_keys,
    get_cached_song,
    set_enabled_sources,
)
from .worker import worker


def _load_env():
    """手动加载项目根 .env（不依赖 python-dotenv），兼容本地与 Docker。"""
    root = Path(__file__).resolve().parent
    while not (root / '.env').exists() and root.parent != root:
        root = root.parent
    env_file = root / '.env'
    if env_file.exists():
        with open(env_file, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                m = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)=(.*)$', line)
                if m:
                    os.environ.setdefault(m.group(1), m.group(2).strip().strip('"').strip("'"))


_load_env()
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info('Starting NASKTV Downloader Service')
    logger.info('download_dir=%s', DOWNLOAD_DIR)
    logger.info('enabled_sources=%s', ','.join(enabled_keys()) or '(all)')
    yield
    logger.info('Shutting down NASKTV Downloader Service')


app = FastAPI(title='NASKTV Downloader', version='0.1.0', lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.get('/api/health')
def health():
    logger.debug('health check')
    return {
        'status': 'ok',
        'download_dir': str(DOWNLOAD_DIR),
        'enabled_sources': enabled_keys(),
        'concurrency': worker.max_workers,
    }


@app.get('/api/download/platforms', response_model=list[PlatformInfo])
def platforms():
    enabled = set(enabled_keys())
    logger.debug('platforms requested, enabled=%s', sorted(enabled))
    return [
        PlatformInfo(key=key, id=cls, label=LABELS.get(key, key), enabled=key in enabled)
        for key, cls in SOURCES.items()
    ]


@app.post('/api/config')
def update_config(req: ConfigRequest):
    """运行时更新下载配置（由后端系统设置推送）。

    - enabled_sources: 覆盖下载默认启用的源（None=不修改）
    - concurrency:     覆盖下载并发上限（None=不修改）
    """
    if req.enabled_sources is not None:
        set_enabled_sources(req.enabled_sources)
    if req.concurrency is not None:
        worker.set_max_workers(req.concurrency)
    logger.info(
        '[step=config] applied enabled_sources=%s concurrency=%d',
        ','.join(enabled_keys()) or '(all)',
        worker.max_workers,
    )
    return {
        'status': 'ok',
        'enabled_sources': enabled_keys(),
        'concurrency': worker.max_workers,
    }


@app.post('/api/download/search')
def search(req: SearchRequest):
    """提交异步搜索，立即返回 search_id（结果经 GET /api/download/search/{id} 轮询）。"""
    if not req.keyword or not req.keyword.strip():
        logger.warning('search rejected: empty keyword')
        raise HTTPException(status_code=400, detail='keyword required')
    keyword = req.keyword.strip()
    logger.info('[step=search/submit] keyword=%r sources=%s', keyword, req.sources or '(all enabled)')
    search_id = submit_search(keyword, req.sources)
    return {'search_id': search_id, 'status': 'pending'}


@app.get('/api/download/search/{search_id}')
def search_result(search_id: str):
    """轮询搜索结果：pending 返回空结果，done 返回构建好的 SongDescriptor 列表。"""
    logger.debug('search result query search_id=%s', search_id)
    task = get_search_task(search_id)
    if not task:
        raise HTTPException(status_code=404, detail='search not found')
    status = task['status']
    if status != 'done':
        return {
            'search_id': search_id,
            'status': status,
            'keyword': task.get('keyword'),
            'per_source': task.get('per_source'),
            'total': 0,
            'results': [],
            'error': task.get('error'),
        }
    filtered = SEARCH_CACHE.get(search_id, {})
    results: list[SongDescriptor] = []
    for cls, songs in filtered.items():
        key = next((k for k, v in SOURCES.items() if v == cls), cls)
        for idx, song in enumerate(songs):
            results.append(
                SongDescriptor(
                    key=f"{search_id}|{key}|{idx}",
                    source=key,
                    source_label=LABELS.get(key, key),
                    song_name=song.song_name or '',
                    singers=song.singers,
                    album=song.album,
                    duration=song.duration,
                    ext=song.ext,
                    file_size=song.file_size,
                    lyric_available=bool(song.lyric),
                )
            )
    logger.info('[step=search/result] search_id=%s total=%d per_source=%s', search_id, len(results), task.get('per_source'))
    for cls, songs in filtered.items():
        key = next((k for k, v in SOURCES.items() if v == cls), cls)
        logger.debug('[step=search/result] source=%s label=%s count=%d', cls, LABELS.get(key, key), len(songs))
        for i, song in enumerate(songs):
            logger.debug('  [search result] %s -> %s', LABELS.get(key, key), _song_summary(song, i))
    return {
        'search_id': search_id,
        'status': 'done',
        'keyword': task.get('keyword'),
        'per_source': task.get('per_source'),
        'total': len(results),
        'results': results,
        'error': None,
    }


@app.post('/api/download')
def download(req: DownloadRequest):
    if not req.keys:
        logger.warning('download rejected: empty keys')
        raise HTTPException(status_code=400, detail='keys required')
    logger.info('[step=download/request] keys=%s', req.keys)
    task_ids: list[str] = []
    for key in req.keys:
        try:
            search_id, source_key, idx = key.split('|')
            idx = int(idx)
        except Exception:
            logger.warning('[step=download/request] skipped malformed key %r', key)
            continue
        song = get_cached_song(search_id, source_key, idx)
        if song is None:
            logger.warning('[step=download/request] skipped song not found for key %r', key)
            continue
        logger.info('[step=download/request] resolved key=%s -> name=%r source=%s', key, getattr(song, 'song_name', None), source_key)
        task_ids.append(worker.submit(song, source_key))
    if not task_ids:
        logger.warning('[step=download/request] rejected: no valid songs')
        raise HTTPException(status_code=400, detail='no valid songs')
    logger.info('[step=download/request] submitted task_ids=%s count=%d', task_ids, len(task_ids))
    return {'task_ids': task_ids, 'count': len(task_ids)}


@app.get('/api/download/{task_id}', response_model=TaskStatus)
def task_status(task_id: str):
    logger.debug('task status query task_id=%s', task_id)
    task = worker.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail='task not found')
    return TaskStatus(**task)


@app.post('/api/download/{task_id}/cancel')
def cancel(task_id: str):
    logger.info('cancel requested task_id=%s', task_id)
    ok = worker.cancel(task_id)
    if not ok:
        logger.warning('cancel failed task_id=%s (not found or already terminal)', task_id)
        raise HTTPException(status_code=404, detail='task not found or already terminal')
    logger.info('cancel ok task_id=%s', task_id)
    return {'task_id': task_id, 'status': 'cancelled'}

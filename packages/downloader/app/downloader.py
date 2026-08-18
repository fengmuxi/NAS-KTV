"""
musicdl 封装层：构建 MusicClient、执行搜索、缓存结果、把歌曲落地目录改到 DOWNLOAD_DIR。

关键事实（基于 musicdl master 源码核实）：
- MusicClient(music_sources=[类名...]) 的源标识是**注册类名**（如 'QQMusicClient'），
  不是短名；所有合法类名见 musicdl.modules.sources.MusicClientBuilder.REGISTERED_MODULES。
- search(keyword) 返回 dict[源类名 -> list[SongInfo]]。
- SongInfo 是 dataclass，落地路径由属性 save_path 推导为
  <work_dir>/<song_name> - <identifier>.<ext>，其中 identifier 保证唯一。
  我们只需把 song.work_dir 改到目标目录即可控制落盘位置。
"""
import os
import threading
import time
import logging
from pathlib import Path
from typing import Dict, List, Optional
from concurrent.futures import ThreadPoolExecutor

try:
    from musicdl import MusicClient
except Exception:  # pragma: no cover - 退回子模块导入
    from musicdl.musicdl import MusicClient

# rich 是 musicdl 的依赖，用于复用与 musicdl 一致的共享 Progress 上下文，
# 避免逐源搜索各自弹进度条刷屏。
try:
    from rich.progress import (
        Progress,
        TextColumn,
        BarColumn,
        MofNCompleteColumn,
        TimeRemainingColumn,
    )
    _HAVE_RICH = True
except Exception:  # pragma: no cover - 极少数环境缺 rich 时退回官方 search
    _HAVE_RICH = False

logger = logging.getLogger(__name__)


def _song_summary(song, idx: int | None = None) -> str:
    """把一首歌的关键字段拼成单行调试串（用于详细日志打印内容）。"""
    prefix = f'#{idx} ' if idx is not None else ''
    # musicdl SongInfo 的字段可能为 None，逐个安全取
    name = getattr(song, 'song_name', None)
    singers = getattr(song, 'singers', None)
    album = getattr(song, 'album', None)
    duration = getattr(song, 'duration', None)
    ext = getattr(song, 'ext', None)
    size = getattr(song, 'file_size', None)
    lyric = bool(getattr(song, 'lyric', None))
    return (
        f'{prefix}name={name!r} singers={singers!r} album={album!r} '
        f'duration={duration!r} ext={ext!r} size={size!r} lyric={lyric}'
    )

# short key -> musicdl 注册类名（必须与 REGISTERED_MODULES 的 key 完全一致）
SOURCES: Dict[str, str] = {
    'qq': 'QQMusicClient',
    'kugou': 'KugouMusicClient',
    'kuwo': 'KuwoMusicClient',
    'netease': 'NeteaseMusicClient',
    'soda': 'SodaMusicClient',
    'fivesing': 'FiveSingMusicClient',
    'bodian': 'BodianMusicClient',
}

LABELS: Dict[str, str] = {
    'qq': 'QQ音乐',
    'kugou': '酷狗音乐',
    'kuwo': '酷我音乐',
    'netease': '网易云音乐',
    'soda': '汽水音乐',
    'fivesing': '5SING',
    'bodian': '波点音乐',
}

# 落盘根目录：Docker 用环境变量（/app/data/songs/Downloads），
# 本地开发回落到仓库根 data/songs/Downloads（本文件在 packages/downloader/app/）。
_DOWNLOAD_DIR_ENV = os.environ.get('DOWNLOAD_DIR')
if _DOWNLOAD_DIR_ENV:
    DOWNLOAD_DIR = Path(_DOWNLOAD_DIR_ENV)
else:
    DOWNLOAD_DIR = Path(__file__).resolve().parents[3] / 'data' / 'songs' / 'Downloads'

_client_cache: Dict[frozenset, MusicClient] = {}
_client_lock = threading.Lock()
SEARCH_CACHE: Dict[str, Dict[str, list]] = {}
SEARCH_CACHE_LOCK = threading.Lock()

# 运行时可覆盖的启用源（由后端系统设置经 /api/config 推送；None=回落到启动 env / 全部）。
_ENABLED_SOURCES_OVERRIDE: Optional[List[str]] = None


def set_enabled_sources(keys: Optional[List[str]]) -> None:
    """运行时覆盖启用的源（None 表示回落到启动 env / 全部）。

    入口由后端系统设置推送；仅用于调整「下载默认走的全部启用源」，
    不影响前端显式指定的搜索源（搜索始终按请求源构建客户端）。
    """
    global _ENABLED_SOURCES_OVERRIDE
    normalized: List[str] = []
    for k in keys or []:
        k = k.strip()
        if k in SOURCES:
            normalized.append(k)
    _ENABLED_SOURCES_OVERRIDE = normalized if normalized else None
    logger.info(
        '[step=config] enabled_sources override -> %s',
        ','.join(_ENABLED_SOURCES_OVERRIDE) if _ENABLED_SOURCES_OVERRIDE else '(none/auto)',
    )


def enabled_keys() -> List[str]:
    if _ENABLED_SOURCES_OVERRIDE is not None:
        return _ENABLED_SOURCES_OVERRIDE
    env = os.environ.get('ENABLED_SOURCES')
    if env:
        keys = [k.strip() for k in env.split(',') if k.strip() in SOURCES]
        if keys:
            return keys
    return list(SOURCES.keys())


def get_client(sources: Optional[List[str]] = None) -> MusicClient:
    """懒加载 MusicClient（按「源集合」缓存，构建客户端较耗时，每个源集合只建一次）。

    关键修复：musicdl 的 MusicClient.search() 会搜索 MusicClient 初始化时包含的**所有**源，
    而非调用方想要的子集。因此这里只按调用方实际请求的源集合来构建客户端——
    搜 1 个源就只建 1 个源，避免「只传 1 个源却搜了全部 7 个源」导致的极慢问题。
    - sources=None          → 使用全部启用源（下载走这条，保证任意源可用）
    - sources=['qq', ...]   → 只构建这些源（搜索走这条，速度与请求源数成正比）
    """
    if sources:
        keys = [s for s in sources if s in SOURCES]
        if not keys:  # 传了非法源，回退全部
            keys = enabled_keys()
    else:
        keys = enabled_keys()
    cache_key = frozenset(keys)
    with _client_lock:
        cached = _client_cache.get(cache_key)
        if cached is not None:
            logger.debug('MusicClient cache hit sources=%s', sorted(cache_key))
            return cached
        classes = [SOURCES[k] for k in keys]
        cfg = {}
        for k in keys:
            cfg[SOURCES[k]] = {
                'work_dir': str(DOWNLOAD_DIR / k),
                'disable_print': True,
                'search_size_per_source': 10,
                'max_retries': 3,
            }
        logger.info('[step=client/init] building MusicClient for %d source(s): %s', len(classes), classes)
        logger.debug('[step=client/init] work_dirs: %s', {k: str(DOWNLOAD_DIR / k) for k in keys})
        client = MusicClient(music_sources=classes, init_music_clients_cfg=cfg)
        _client_cache[cache_key] = client
        logger.info('[step=client/init] MusicClient ready sources=%s', sorted(cache_key))
        return client


# ---- 异步搜索任务注册表（与下载任务同构：提交即返回 search_id，前端轮询结果）----
SEARCH_TASKS: Dict[str, dict] = {}
SEARCH_TASKS_LOCK = threading.Lock()
_search_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix='dl-search')


def _search_sources(client: MusicClient, keyword: str, search_id: str) -> Dict[str, list]:
    """对 client 内**每个**源执行搜索，返回 {源类名: [SongInfo]}。

    复用 musicdl 官方的共享 Progress 上下文 + 线程池写法，额外记录每源耗时，
    便于排查「哪个源慢」。client 已被 get_client() 限定为请求的子集，故不会搜多余源。
    若环境缺 rich，则退回官方 client.search()（仅打印总耗时）。
    """
    sources = list(client.music_sources)
    if not _HAVE_RICH:
        logger.debug('[step=search/run] rich unavailable, fallback to client.search()')
        return client.search(keyword=keyword)

    results: Dict[str, list] = {}
    max_workers = min(len(sources), 10)
    with Progress(
        TextColumn('{task.description}'),
        BarColumn(bar_width=None),
        MofNCompleteColumn(),
        TimeRemainingColumn(),
        refresh_per_second=10,
    ) as main_process_context:
        main_progress_id = main_process_context.add_task(
            'Search From Sources >>> Completed (0/0) Search URLs', total=0
        )

        def search_func(ms):
            t0 = time.time()
            try:
                songs = client.music_clients[ms].search(
                    keyword=keyword,
                    num_threadings=client.clients_threadings.get(ms, 5),
                    request_overrides=client.requests_overrides.get(ms, {}),
                    rule=client.search_rules.get(ms, {}),
                    main_process_context=main_process_context,
                    main_progress_id=main_progress_id,
                    main_progress_lock=threading.Lock(),
                )
                return ms, songs, time.time() - t0, None
            except Exception as err:  # noqa: BLE001 - 单源失败不影响其它源
                return ms, [], time.time() - t0, repr(err)

        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            futs = {ex.submit(search_func, ms): ms for ms in sources}
            for fut in futs:  # as_completed 顺序不定，但各自已打日志
                ms, songs, elapsed, err = fut.result()
                results[ms] = songs
                if err:
                    logger.error('[step=search/source] %s FAILED elapsed=%.2fs err=%s', ms, elapsed, err)
                else:
                    logger.info('[step=search/source] %s count=%d elapsed=%.2fs', ms, len(songs), elapsed)
                    for i, song in enumerate(songs):
                        logger.debug('  [search result] %s -> %s', ms, _song_summary(song, i))
    return results


def _do_search_sync(keyword: str, sources, search_id: str) -> Dict:
    """执行 musicdl 搜索并将结果按 search_id 写入 SEARCH_CACHE（供后续下载提交按 key 取用）。"""
    client = get_client(sources)
    wanted_classes = list(client.music_sources)
    logger.info('[step=search/run] search_id=%s keyword=%r sources=%s', search_id, keyword, wanted_classes)
    t0 = time.time()
    results = _search_sources(client, keyword, search_id)
    elapsed = time.time() - t0
    # results 已是请求源的子集，无需再过滤
    with SEARCH_CACHE_LOCK:
        SEARCH_CACHE[search_id] = results
    logger.info(
        '[step=search/done] search_id=%s keyword=%r total_elapsed=%.2fs per_source=%s',
        search_id, keyword, elapsed, {k: len(v) for k, v in results.items()},
    )
    return results


def submit_search(keyword: str, sources: Optional[List[str]] = None) -> str:
    """提交一次异步搜索，立即返回 search_id（结果经 get_search_task 轮询获取）。"""
    search_id = os.urandom(8).hex()
    now = time.time()
    with SEARCH_TASKS_LOCK:
        SEARCH_TASKS[search_id] = {
            'search_id': search_id,
            'status': 'pending',
            'keyword': keyword,
            'sources': sources,
            'per_source': None,
            'error': None,
            'created_at': now,
            'updated_at': now,
        }
    logger.info('[step=search/submit] search_id=%s keyword=%r', search_id, keyword)
    _search_executor.submit(_run_search, search_id, keyword, sources)
    return search_id


def _run_search(search_id: str, keyword: str, sources: Optional[List[str]]):
    t0 = time.time()
    try:
        _do_search_sync(keyword, sources, search_id)
        elapsed = time.time() - t0
        per_source = {k: len(v) for k, v in SEARCH_CACHE.get(search_id, {}).items()}
        logger.info('search[%s] completed elapsed=%.2fs per_source=%s', search_id, elapsed, per_source)
        _update_search(search_id, status='done', per_source=per_source)
    except Exception:
        elapsed = time.time() - t0
        logger.exception('search[%s] failed elapsed=%.2fs', search_id, elapsed)
        _update_search(search_id, status='failed', error='search failed')


def _update_search(search_id: str, **kwargs):
    with SEARCH_TASKS_LOCK:
        task = SEARCH_TASKS.get(search_id)
        if task:
            task.update(kwargs)
            task['updated_at'] = time.time()


def get_search_task(search_id: str):
    with SEARCH_TASKS_LOCK:
        return SEARCH_TASKS.get(search_id)


def get_cached_song(search_id: str, source_key: str, index: int):
    with SEARCH_CACHE_LOCK:
        cached = SEARCH_CACHE.get(search_id)
    if not cached:
        return None
    cls = SOURCES.get(source_key)
    songs = cached.get(cls) if cls else None
    if not songs or index >= len(songs):
        return None
    return songs[index]


def prepare_song(song, source_key: str):
    """把歌曲落地目录改到 DOWNLOAD_DIR/<source_key>/，清空 _save_path 缓存以按新 work_dir 重算。"""
    base = DOWNLOAD_DIR / source_key
    base.mkdir(parents=True, exist_ok=True)
    logger.info(
        '[step=download/prepare] source=%s target_dir=%s song=%s',
        source_key, base, getattr(song, 'song_name', None),
    )
    logger.debug('[step=download/prepare] song detail: %s', _song_summary(song))
    song.work_dir = str(base)
    song._save_path = None
    logger.debug('[step=download/prepare] work_dir set=%s (save_path reset)', song.work_dir)
    return song

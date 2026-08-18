"""下载微服务的数据模型（FastAPI / Pydantic）。"""
from typing import List, Optional

from pydantic import BaseModel


class SearchRequest(BaseModel):
    keyword: str
    # short key 列表，如 ['qq','netease']；None 表示启用全部已配置源
    sources: Optional[List[str]] = None


class SongDescriptor(BaseModel):
    key: str
    source: str
    source_label: str
    song_name: str
    singers: Optional[str] = None
    album: Optional[str] = None
    duration: Optional[str] = None
    ext: Optional[str] = None
    file_size: Optional[str] = None
    lyric_available: bool = False


class DownloadRequest(BaseModel):
    keys: List[str]


class TaskStatus(BaseModel):
    task_id: str
    status: str
    source: Optional[str] = None
    song_name: Optional[str] = None
    singers: Optional[str] = None
    save_path: Optional[str] = None
    error: Optional[str] = None
    created_at: float
    updated_at: float


class PlatformInfo(BaseModel):
    key: str
    id: str
    label: str
    enabled: bool


class ConfigRequest(BaseModel):
    # short key 列表，如 ['qq','netease']；None 表示不修改（保持当前配置）
    enabled_sources: Optional[List[str]] = None
    # 下载并发上限；None 表示不修改
    concurrency: Optional[int] = None

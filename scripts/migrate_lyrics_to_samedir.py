#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
歌词存储布局迁移：data/lyrics/<id>.lrc  ->  与音频文件同目录同名 .lrc

背景：scanner 内嵌歌词提取与后台保存歌词原本统一落盘到 data/lyrics/<id>.lrc，
现改为"与音频文件同目录、同名 .lrc"（外部同名 lrc 早已是此格式）。本脚本把历史
落在 data/lyrics/ 下的歌词文件搬回各自歌曲目录，并同步更新 songs.lyrics_path。

用法：
  python scripts/migrate_lyrics_to_samedir.py            # 仅打印迁移计划（dry-run）
  python scripts/migrate_lyrics_to_samedir.py --apply    # 执行迁移（先自动备份 db）

安全：
  - --apply 前会复制 data/db.sqlite 为带时间戳的备份。
  - 若目标同名 lrc 已存在（外部 lrc），跳过该首并告警，不覆盖用户文件。
  - 迁移后清理 data/lyrics/ 下无任何歌曲引用的孤儿文件。
"""
import os
import shutil
import sqlite3
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 项目根
DB = os.path.join(ROOT, "data", "db.sqlite")
LYRICS_DIR = os.path.join(ROOT, "data", "lyrics")


def norm(p: str) -> str:
    return p.replace("\\", "/")


def compute_target(file_path: str) -> str:
    """音频路径 -> 同目录同名 .lrc（统一用 / 分隔，与 file_path 风格一致）。"""
    d = os.path.dirname(file_path)
    stem = os.path.splitext(os.path.basename(file_path))[0]
    return norm(os.path.join(d, stem + ".lrc"))


def main(apply: bool) -> int:
    if not os.path.exists(DB):
        print(f"未找到数据库：{DB}")
        return 1

    conn = sqlite3.connect(DB)
    rows = conn.execute(
        "SELECT id, file_path, lyrics_path FROM songs WHERE lyrics_path IS NOT NULL"
    ).fetchall()

    plan = []
    for song_id, file_path, lyrics_path in rows:
        nlp = norm(lyrics_path)
        if "/data/lyrics/" not in nlp:
            # 已经是同名同目录格式（外部 lrc 或之前已迁移），跳过
            continue
        if not file_path:
            print(f"  ! 跳过 id={song_id}：file_path 为空，无法定位目标目录")
            continue
        target = compute_target(file_path)
        plan.append((song_id, lyrics_path, target))

    print(f"需迁移的歌词文件：{len(plan)} 个")
    for song_id, src, target in plan:
        mark = "  (目标已存在-将以同目录为准)" if os.path.exists(target) else ""
        print(f"  [{song_id}] {src}  ->  {target}{mark}")

    if not apply:
        print("\n以上为迁移计划（dry-run）。确认无误后加 --apply 执行。")
        conn.close()
        return 0

    # ---- 执行阶段 ----
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    db_bak = f"{DB}.bak_before_lyrics_migrate_{ts}"
    shutil.copy2(DB, db_bak)
    print(f"\n已备份数据库：{db_bak}")

    moved = 0
    pointed = 0
    for song_id, src, target in plan:
        if os.path.exists(target):
            # 目标已存在（同目录同名 .lrc，如恢复脚本先前写入的外部版本）：以它为准，
            # 仅更新 DB 指向；data/lyrics 下的冗余副本交给随后的孤儿清理删除。
            conn.execute(
                "UPDATE songs SET lyrics_path = ? WHERE id = ?", (target, song_id)
            )
            conn.commit()
            pointed += 1
            print(f"  ↦ 指向已有目标 id={song_id} -> {target}")
            continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.move(src, target)
        conn.execute(
            "UPDATE songs SET lyrics_path = ? WHERE id = ?", (target, song_id)
        )
        conn.commit()
        moved += 1
        print(f"  ✓ 迁移 id={song_id}")

    # ---- 清理孤儿 ----
    referenced = {
        norm(r[0])
        for r in conn.execute(
            "SELECT lyrics_path FROM songs WHERE lyrics_path IS NOT NULL"
        ).fetchall()
    }
    orphans = []
    if os.path.isdir(LYRICS_DIR):
        for f in os.listdir(LYRICS_DIR):
            if f.lower().endswith(".lrc"):
                p = norm(os.path.join(LYRICS_DIR, f))
                if p not in referenced:
                    orphans.append(p)
    for p in orphans:
        try:
            os.remove(p)
            print(f"  ✓ 删除孤儿 {p}")
        except OSError as e:
            print(f"  ! 删除失败 {p}: {e}")

    conn.close()
    print(f"\n完成：迁移 {moved} 个，指向已有 {pointed} 个，清理孤儿 {len(orphans)} 个。")
    return 0


if __name__ == "__main__":
    apply = "--apply" in sys.argv
    sys.exit(main(apply))

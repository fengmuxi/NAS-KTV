#!/usr/bin/env python3
"""
一次性治理：合并"同房间 + 同昵称 + 多个有效 session"的堆积。

背景：H5 每次扫码加入都会创建新 room_session，旧 session 不退出。
导致同房间内出现多个有效 session，而待播队列项归属旧 session，
用户重新扫码后（新 sessionId）无法置顶/取消自己之前点的歌
（后端「只能置顶自己点的歌曲」归属校验失败）。

处理：
- 对每个房间内「昵称相同且 left_at 为空」的 session 组，保留 joined_at 最新一个；
- 把旧 session 名下 pending/playing 的 room_queues 归属迁移到保留的 session；
- 旧 session 标记 left_at=now 退出。

用法：dry-run（默认，只打印计划）/ --apply（执行，先自动备份 db.sqlite）。
"""
import sqlite3
import sys
import time
import shutil
import os
import datetime

DB_PATH = "data/db.sqlite"
KEEP_STATUS = ("pending", "playing")


def now_ms() -> int:
    return int(time.time() * 1000)


def main() -> int:
    apply = "--apply" in sys.argv
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    print(f"模式: {'--apply 执行' if apply else 'dry-run 预览'}\n")

    # 1. 找所有有效 session（left_at 为空），按房间+昵称分组
    sessions = conn.execute(
        "SELECT id, room_id, nickname, joined_at FROM room_sessions WHERE left_at IS NULL ORDER BY room_id, joined_at"
    ).fetchall()

    groups: dict[tuple[int, str], list[dict]] = {}
    for s in sessions:
        key = (s["room_id"], s["nickname"])
        groups.setdefault(key, []).append(
            {"id": s["id"], "joined_at": s["joined_at"]}
        )

    plan = []
    for (room_id, nickname), items in groups.items():
        if len(items) <= 1:
            continue
        # 保留 joined_at 最大的（最新）
        keep = max(items, key=lambda x: x["joined_at"])
        stale = [x for x in items if x["id"] != keep["id"]]
        # 统计 stale session 名下待迁移的队列项
        stale_ids = [x["id"] for x in stale]
        placeholders = ",".join("?" * len(stale_ids))
        rows = conn.execute(
            f"SELECT id, song_id, status FROM room_queues "
            f"WHERE room_id=? AND user_session_id IN ({placeholders}) "
            f"AND status IN ('pending','playing')",
            (room_id, *stale_ids),
        ).fetchall()
        plan.append(
            {
                "room_id": room_id,
                "nickname": nickname,
                "keep": keep["id"],
                "stale": stale_ids,
                "queues": [dict(r) for r in rows],
            }
        )

    total_queues = sum(len(p["queues"]) for p in plan)
    total_stale = sum(len(p["stale"]) for p in plan)
    print(f"待合并组: {len(plan)}，旧 session 数: {total_stale}，待迁移队列项: {total_queues}\n")
    for p in plan:
        print(
            f"  room={p['room_id']} 昵称={p['nickname']!r} "
            f"保留 session={p['keep']} 退出 session={p['stale']}"
        )
        for q in p["queues"]:
            print(f"      - 队列项 id={q['id']} song={q['song_id']} {q['status']} -> 归属 {p['keep']}")

    if not apply:
        print("\n(dry-run 结束，加 --apply 执行)")
        conn.close()
        return 0

    # 2. 备份
    if os.path.exists(DB_PATH):
        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        bak = f"{DB_PATH}.bak_before_merge_sessions_{stamp}"
        shutil.copy2(DB_PATH, bak)
        print(f"\n已备份: {bak}")

    # 3. 执行
    migrated = 0
    exited = 0
    for p in plan:
        stale_ids = p["stale"]
        ph = ",".join("?" * len(stale_ids))
        cur = conn.execute(
            f"UPDATE room_queues SET user_session_id=? WHERE room_id=? "
            f"AND user_session_id IN ({ph}) AND status IN ('pending','playing')",
            (str(p["keep"]), p["room_id"], *stale_ids),
        )
        migrated += cur.rowcount
        cur = conn.execute(
            f"UPDATE room_sessions SET left_at=? WHERE id IN ({ph})",
            (now_ms(), *stale_ids),
        )
        exited += cur.rowcount
        print(f"  ✓ room={p['room_id']}: 迁移 {cur.rowcount} session 名下队列，退出 {cur.rowcount} 个 session")
    conn.commit()

    # 4. 验证
    left = conn.execute(
        "SELECT room_id, nickname, COUNT(*) n FROM room_sessions WHERE left_at IS NULL GROUP BY room_id, nickname HAVING COUNT(*) > 1"
    ).fetchall()
    print(f"\n完成：迁移队列项 {migrated}，退出 session {exited}，剩余重复组 {len(left)}")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

-- songs.created_at 历史数据全为 NULL/0（schema 无默认值 + 插入路径未传）。
-- 该 SQLite 版本族不支持 ALTER COLUMN SET DEFAULT，改用 AFTER INSERT 触发器兜底：
-- 新插入行 created_at 为空时自动填充 unixepoch()，等价于 schema 的 defaultNow()。
CREATE TRIGGER songs_created_at_autofill
AFTER INSERT ON songs
FOR EACH ROW
WHEN NEW.created_at IS NULL
BEGIN
  UPDATE songs SET created_at = unixepoch() WHERE id = NEW.id;
END;

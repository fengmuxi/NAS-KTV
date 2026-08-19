import { Router } from 'express';
import { authenticateToken } from '../middleware/jwt';
import { logService } from '../services/log-service';
import { setLogLevel } from '../logger';

const router = Router();

router.get('/system/logs/stats', authenticateToken, async (_req, res) => {
  try {
    const stats = logService.getLogStats();
    return res.json({ success: true, data: stats });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch log stats' });
  }
});

router.patch('/system/logs/level', authenticateToken, async (req, res) => {
  const level = (req.body?.level as string | undefined) || 'info';
  try {
    setLogLevel(level);
    return res.json({ success: true, data: { level } });
  } catch (err) {
    return res.status(400).json({ success: false, error: (err as Error).message });
  }
});

router.get('/system/logs', authenticateToken, async (req, res) => {
  const { level, service, keyword, startTime, endTime, limit, offset } = req.query;

  const filters = {
    level: level as string | undefined,
    service: service as string | undefined,
    keyword: keyword as string | undefined,
    startTime: startTime as string | undefined,
    endTime: endTime as string | undefined,
    limit: limit ? parseInt(limit as string, 10) : undefined,
    offset: offset ? parseInt(offset as string, 10) : undefined,
  };

  try {
    const logs = logService.queryLogs(filters);
    return res.json({ success: true, data: { logs, total: logs.length } });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch logs' });
  }
});

router.get('/system/logs/export', authenticateToken, async (req, res) => {
  const { level, service, keyword, startTime, endTime, format } = req.query;

  const filters = {
    level: level as string | undefined,
    service: service as string | undefined,
    keyword: keyword as string | undefined,
    startTime: startTime as string | undefined,
    endTime: endTime as string | undefined,
    limit: 100000,
  };

  try {
    const logs = logService.queryLogs(filters);

    if (format === 'csv') {
      const escape = (v: unknown): string => {
        const s = String(v ?? '');
        return `"${s.replace(/"/g, '""')}"`;
      };
      const header = ['timestamp', 'level', 'service', 'message', 'meta'];
      const rows = logs.map((e) =>
        [
          escape(e.timestamp),
          escape(e.level),
          escape(e.service),
          escape(e.message),
          escape(e.meta ? JSON.stringify(e.meta) : ''),
        ].join(','),
      );
      const csv = [header.join(','), ...rows].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="nasktv-logs.csv"');
      return res.send('\uFEFF' + csv);
    }

    res.setHeader('Content-Disposition', 'attachment; filename="nasktv-logs.json"');
    return res.json({ success: true, data: { logs, total: logs.length } });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to export logs' });
  }
});

export default router;

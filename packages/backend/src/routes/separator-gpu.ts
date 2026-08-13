import { Router, Request, Response } from 'express';
import multer from 'multer';
import logger from '../logger';
import { separatorClient } from '../services/separator-client';
import { authenticateToken } from '../middleware/jwt';
import * as settingsService from '../services/settings-service';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
});

router.get('/separator/gpu/info', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const info = await separatorClient.getGpuInfo();
    res.json({ success: true, data: info });
  } catch (err: any) {
    logger.error({ err }, 'Failed to get GPU info');
    res.status(502).json({ success: false, error: err.message || 'Separator service unavailable' });
  }
});

router.get('/separator/gpu/proxy', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const proxy = await settingsService.getPytorchProxy();
    res.json({ success: true, data: { proxy } });
  } catch (err: any) {
    logger.error({ err }, 'Failed to get PyTorch proxy config');
    res.status(500).json({ success: false, error: err.message || 'Failed to get proxy config' });
  }
});

router.put('/separator/gpu/proxy', authenticateToken, async (req: Request, res: Response) => {
  try {
    const proxy = (req.body?.proxy ?? '').toString().trim();
    await settingsService.updateSettings([{ key: 'pytorch_proxy', value: proxy }]);
    res.json({ success: true, data: { proxy } });
  } catch (err: any) {
    logger.error({ err }, 'Failed to save PyTorch proxy config');
    res.status(500).json({ success: false, error: err.message || 'Failed to save proxy config' });
  }
});

async function installPytorch(
  req: Request,
  res: Response,
  installFn: (proxy: string) => ReturnType<typeof fetch>,
) {
  try {
    const proxy = await settingsService.getPytorchProxy();
    const upstream = await installFn(proxy);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (!upstream.body) {
      res.write('data: ERROR: No response from separator\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const reader = (upstream.body as any).getReader?.() ?? null;

    if (reader) {
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(decoder.decode(value, { stream: true }));
        }
      } catch (err: any) {
        logger.error({ err }, 'SSE stream read error');
      }
    } else {
      const text = await upstream.text();
      res.write(text);
    }

    res.end();
  } catch (err: any) {
    logger.error({ err }, 'Failed to install PyTorch');
    res.write(`data: ERROR: ${err.message || 'Separator service unavailable'}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

router.post('/separator/gpu/install-gpu', authenticateToken, (req: Request, res: Response) => {
  return installPytorch(req, res, proxy => separatorClient.installGpu(proxy));
});

router.post('/separator/gpu/install-cpu', authenticateToken, (req: Request, res: Response) => {
  return installPytorch(req, res, proxy => separatorClient.installCpu(proxy));
});

router.get('/separator/gpu/install/status', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const status = await separatorClient.getInstallStatus();
    res.json({ success: true, data: status });
  } catch (err: any) {
    logger.error({ err }, 'Failed to get install status');
    res.status(502).json({ success: false, error: err.message || 'Separator service unavailable' });
  }
});

router.post('/separator/gpu/install/trigger', authenticateToken, async (req: Request, res: Response) => {
  try {
    const proxy = await settingsService.getPytorchProxy();
    const body: {
      target?: 'auto' | 'cpu' | 'cuda';
      mode?: 'pip' | 'wheel';
      proxy?: string;
    } = {};
    const { target, mode } = req.body ?? {};
    if (target === 'cpu' || target === 'cuda' || target === 'auto') body.target = target;
    if (mode === 'pip' || mode === 'wheel') body.mode = mode;
    body.proxy = proxy;
    const result = await separatorClient.triggerInstall(body);
    res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error({ err }, 'Failed to trigger install');
    res.status(502).json({ success: false, error: err.message || 'Separator service unavailable' });
  }
});

router.post(
  '/separator/gpu/install/upload',
  authenticateToken,
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ success: false, error: '缺少上传文件（字段名 file）' });
        return;
      }
      const result = await separatorClient.uploadInstallFile(
        file.originalname,
        file.buffer,
        file.mimetype,
      );
      res.json({ success: true, data: result });
    } catch (err: any) {
      logger.error({ err }, 'Failed to upload install file');
      res.status(502).json({ success: false, error: err.message || 'Separator service unavailable' });
    }
  },
);

export default router;

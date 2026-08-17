import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import logger from '../logger';
import { config } from '../config';
import { authenticateToken } from '../middleware/jwt';
import { createAppError } from '../middleware/error';
import * as settingsService from '../services/settings-service';

const router = Router();

// 设置键：自定义 logo 文件路径（相对项目根），空/缺失 = 使用默认 logo
const KEY_LOGO_PATH = 'logo_path';
const DEFAULT_LOGO_FILE = path.join(config.assetsDir, 'logo.png');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('仅支持上传图片文件'));
    }
  },
});

/**
 * GET /logo - 获取系统 Logo 图片（公开，三端共用）
 * 已设置自定义 logo 时返回自定义图片，否则返回默认 logo.png
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const setting = await settingsService.getSetting(KEY_LOGO_PATH);
    const customPath =
      setting?.value && path.isAbsolute(setting.value)
        ? setting.value
        : setting?.value
          ? path.resolve(config.projectRoot, setting.value)
          : null;
    const filePath =
      customPath && fs.existsSync(customPath) ? customPath : DEFAULT_LOGO_FILE;

    // no-store：浏览器不对 Logo 做任何缓存（含标签页 favicon），管理员更换后各端刷新即可生效
    res.setHeader('Cache-Control', 'no-store');
    // 覆盖 Helmet 默认的 same-origin：Logo 需被三端（含 TV Tauri WebView 跨源）嵌入，
    // 否则会被 Cross-Origin-Resource-Policy 拦截（ERR_BLOCKED_BY_RESPONSE.NotSameOrigin）
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.sendFile(filePath, (err) => {
      if (err) {
        logger.error({ err, filePath }, 'Failed to send logo');
        if (!res.headersSent) {
          res.status(404).end();
        }
      }
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to get logo');
    res.status(500).end();
  }
});

/**
 * POST /logo - 上传自定义 Logo（管理员）
 * 保存到 config.logoPath 并写入 settings.logo_path，全端生效
 */
router.post(
  '/',
  authenticateToken,
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        throw createAppError('请选择要上传的图片文件', 400);
      }
      fs.mkdirSync(path.dirname(config.logoPath), { recursive: true });
      fs.writeFileSync(config.logoPath, req.file.buffer);
      await settingsService.updateSettings([
        { key: KEY_LOGO_PATH, value: config.logoPath },
      ]);
      res.json({ success: true, message: 'Logo 已更新' });
    } catch (error) {
      if (error instanceof Error && 'statusCode' in error) {
        return res
          .status((error as { statusCode: number }).statusCode)
          .json({ success: false, error: error.message });
      }
      logger.error({ err: error }, 'Failed to upload logo');
      res.status(500).json({ success: false, error: '上传 Logo 失败' });
    }
  },
);

/**
 * DELETE /logo - 恢复默认 Logo（管理员）
 */
router.delete('/', authenticateToken, async (_req: Request, res: Response) => {
  try {
    if (fs.existsSync(config.logoPath)) {
      fs.unlinkSync(config.logoPath);
    }
    await settingsService.updateSettings([{ key: KEY_LOGO_PATH, value: '' }]);
    res.json({ success: true, message: '已恢复默认 Logo' });
  } catch (error) {
    logger.error({ err: error }, 'Failed to reset logo');
    res.status(500).json({ success: false, error: '恢复默认 Logo 失败' });
  }
});

export default router;

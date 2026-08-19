import dotenv from 'dotenv';
import path from 'path';

// 项目根目录（packages/backend/src/config/ -> ../../../.. -> 项目根目录）
// 本地：D:\gitee\nasktv；Docker：/app（两种布局层级一致）
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

// 将相对路径解析为相对于项目根目录的绝对路径
const resolvePath = (p: string): string =>
  path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);

export const config = {
  projectRoot: PROJECT_ROOT,
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'default-secret-change-me',
  dbPath: resolvePath(process.env.DB_PATH || './data/db.sqlite'),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  h5SessionTtlMinutes: Math.min(
    7 * 24 * 60,
    Math.max(1, parseInt(process.env.H5_SESSION_TTL_MINUTES || '240', 10) || 240),
  ),
  h5JoinTicketTtlMinutes: Math.min(
    30,
    Math.max(1, parseInt(process.env.H5_JOIN_TICKET_TTL_MINUTES || '5', 10) || 5),
  ),
  scanPath: resolvePath(process.env.SCAN_PATH || './data/songs'),
  uploadPath: resolvePath(process.env.UPLOAD_PATH || './data/uploads'),
  // 后端内置静态资源（默认 logo 等）
  assetsDir: resolvePath('./packages/backend/assets'),
  // 自定义 logo 保存路径（上传后写入此处，settings.logo_path 指向）
  logoPath: resolvePath(process.env.LOGO_PATH || './data/uploads/logo.png'),
  separationOutputDir: resolvePath(
    process.env.SEPARATION_OUTPUT_DIR || './data/separation',
  ),
} as const;

export type Config = typeof config;

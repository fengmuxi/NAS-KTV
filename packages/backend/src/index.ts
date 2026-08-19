import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { WebSocketServer } from 'ws';
import { config } from './config';
import logger, { initLogger } from './logger';
import { errorHandler } from './middleware/error';
import { requestLogger } from './middleware/request-logger';
import { verifyToken } from './middleware/jwt';
import { runMigrations } from './db/migrate';
import { initDatabase } from './db/init';
import routes from './routes';
import { initScanProgressHandler, registerScanClient } from './ws/scan-handler';
import { initAiParseProgressHandler, registerAiParseClient } from './ws/ai-parse-handler';
import { initSeparationProgressHandler, registerSeparationClient } from './ws/separation-handler';
import { initRoomWsHandler, broadcastRoomExpiringSoon } from './ws/room-handler';
import { separationQueue, backfillMissingDurations } from './services/separation-queue';
import { aiParseQueue } from './services/ai-queue';
import { findExpiringSoonRooms, revokeExpiredAuthorizations, closeIdleAndStaleRooms } from './services/room-service';
import { createLogTransport, logService } from './services/log-service';
import { startSeparatorLogPoller, stopSeparatorLogPoller } from './services/separator-log-poller';
import { startDownloaderLogPoller, stopDownloaderLogPoller } from './services/downloader-log-poller';
import { startDiscoveryBroadcast } from './services/discovery';

// 全局兜底：异步 handler 中未捕获的错误不应导致进程退出
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (error) => {
  logger.error({ err: error }, 'Uncaught exception');
});

// 临时授权过期提醒配置
const EXPIRING_SOON_WINDOW_MINUTES = 5;
const EXPIRING_CHECK_INTERVAL_MS = 60_000;
const notifiedExpiringRoomIds = new Set<number>();

/**
 * 检查即将过期的临时授权房间并推送 ROOM_EXPIRING_SOON。
 * 每个房间在每个过期窗口内仅通知一次（续期或重新授权后重置）。
 */
async function checkExpiringSoonRooms(): Promise<void> {
  try {
    const expiringRooms = await findExpiringSoonRooms(EXPIRING_SOON_WINDOW_MINUTES);
    const currentRoomIds = new Set(expiringRooms.map((r) => r.id));

    for (const room of expiringRooms) {
      if (notifiedExpiringRoomIds.has(room.id)) {
        continue;
      }
      const expiresAt = room.authorizeExpiresAt;
      if (!expiresAt) {
        continue;
      }
      const remainingMs = expiresAt.getTime() - Date.now();
      broadcastRoomExpiringSoon(room.code, {
        roomCode: room.code,
        expiresAt: expiresAt.toISOString(),
        remainingMinutes: Math.max(0, Math.floor(remainingMs / 60000)),
      });
      notifiedExpiringRoomIds.add(room.id);
    }

    // 清理已离开窗口的房间（已续期、已过期或已撤销）
    for (const id of notifiedExpiringRoomIds) {
      if (!currentRoomIds.has(id)) {
        notifiedExpiringRoomIds.delete(id);
      }
    }
  } catch (err) {
    logger.error({ err }, 'Failed to check expiring soon rooms');
  }
}

/**
 * 检查并撤销已过期的临时授权房间（与 EXPIRING_SOON 检查共用定时器）。
 */
async function checkAndRevokeExpiredAuthorizations(): Promise<void> {
  try {
    const revoked = await revokeExpiredAuthorizations();
    if (revoked.length > 0) {
      logger.info(
        `Revoked ${revoked.length} expired authorization(s): ${revoked.map((r) => r.code).join(', ')}`,
      );
    }
  } catch (err) {
    logger.error({ err }, 'Failed to revoke expired authorizations');
  }
}

async function main() {
  try {
    initLogger(createLogTransport());

    logger.info('Running database migrations...');
    runMigrations();

    logger.info('Initializing database...');
    await initDatabase();

    const app = express();

    // 禁用 ETag：动态 API 响应被 WebView/浏览器缓存后，二次请求返回 304，
    // axios/fetch 将 304 视为错误导致前端误判「后端不可达」
    app.disable('etag');

    app.use(helmet());
    app.use(cors());
    app.use(express.json());
    app.use(requestLogger);

    app.get('/api/health', (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: { status: 'ok' } });
    });

    app.use('/api', routes);

    app.use(errorHandler);

    // 初始化 WebSocket 进度推送
    initScanProgressHandler();
    initAiParseProgressHandler();
    initSeparationProgressHandler();

    // 启动 UDP 局域网发现广播（TV 端自动扫描后端服务用）
    startDiscoveryBroadcast();

    // 恢复数据库中未完成的分离任务
    separationQueue.recoverPendingTasks();
    // 恢复数据库中未完成的 AI 解析任务
    aiParseQueue.recoverPendingTasks();
    // 回填存量分离歌曲缺失的时长（不阻塞启动）
    void backfillMissingDurations();

    const server = app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port} [${config.nodeEnv}]`);
    });

    // 初始化房间 WebSocket handler（挂载到 HTTP server 的 /ws/room 路径）
    initRoomWsHandler(server);

    // 初始化 Admin WebSocket handler（挂载到 /ws 路径，注册 scan/separation/ai-parse 进度推送）
    const adminWss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '', `http://${request.headers.host}`);

      const rejectUnauthorized = () => {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      };

      if (url.pathname === '/ws/logs') {
        const token = url.searchParams.get('token');
        if (!token || !verifyToken(token)) {
          rejectUnauthorized();
          return;
        }
        const logWss = new WebSocketServer({ noServer: true });
        logWss.handleUpgrade(request, socket, head, (ws) => {
          const level = url.searchParams.get('level') || undefined;
          const service = url.searchParams.get('service') || undefined;
          logService.registerLogClient(ws, { level, service });
          ws.on('close', () => logService.unregisterLogClient(ws));
          logWss.emit('connection', ws, request);
          logger.info('Log WebSocket client connected');
        });
        return;
      }

      if (url.pathname !== '/ws') {
        return;
      }

      const token = url.searchParams.get('token');
      if (!token || !verifyToken(token)) {
        rejectUnauthorized();
        return;
      }

      adminWss.handleUpgrade(request, socket, head, (ws) => {
        registerScanClient(ws);
        registerSeparationClient(ws);
        registerAiParseClient(ws);
        adminWss.emit('connection', ws, request);
        logger.info('Admin WebSocket client connected');
      });
    });

    // 启动临时授权过期提醒调度器（每分钟检查一次，提前 5 分钟通知）
    const expiringTimer = setInterval(() => {
      checkExpiringSoonRooms();
      checkAndRevokeExpiredAuthorizations();
      closeIdleAndStaleRooms().catch((err) => {
        logger.error({ err }, 'Failed to close idle rooms');
      });
    }, EXPIRING_CHECK_INTERVAL_MS);

    // 启动 Separator 日志轮询器
    startSeparatorLogPoller();
    // 启动 Downloader 日志轮询器
    startDownloaderLogPoller();

    process.on('SIGTERM', () => {
      clearInterval(expiringTimer);
      stopSeparatorLogPoller();
      stopDownloaderLogPoller();
    });
    process.on('SIGINT', () => {
      clearInterval(expiringTimer);
      stopSeparatorLogPoller();
      stopDownloaderLogPoller();
    });
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
}

main();

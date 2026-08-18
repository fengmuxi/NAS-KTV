import { Router } from 'express';
import authRouter from './auth';
import songsRouter from './songs';
import scanRouter from './scan';
import aiParseRouter from './ai-parse';
import separationRouter from './separation';
import roomsRouter from './rooms';
import roomSessionsRouter from './room-sessions';
import devicesRouter from './devices';
import artistsRouter from './artists';
import categoriesRouter from './categories';
import categoryItemsRouter from './category-items';
import settingsRouter from './settings';
import logoRouter from './logo';
import playlistsRouter from './playlists';
import separatorGpuRouter from './separator-gpu';
import systemRouter from './system';
import logsRouter from './logs';
import backupRouter from './backup';
import dedupRouter from './dedup';
import downloadRouter from './download';

const router = Router();

router.use('/auth', authRouter);
// separationRouter 须在 songsRouter 之前注册，以接管
// /songs/:id/separate、/songs/:id/instrumental、/songs/:id/vocals
router.use('/', separationRouter);
router.use('/songs', songsRouter);
router.use('/scan', scanRouter);
router.use('/', aiParseRouter);
router.use('/rooms', roomsRouter);
router.use('/room-sessions', roomSessionsRouter);
router.use('/devices', devicesRouter);
router.use('/artists', artistsRouter);
router.use('/categories', categoriesRouter);
router.use('/category-items', categoryItemsRouter);
router.use('/settings', settingsRouter);
// logo 必须公开访问（GET /logo 无鉴权，三端共用；上传/恢复需 JWT）
router.use('/logo', logoRouter);
router.use('/playlists', playlistsRouter);
router.use('/', separatorGpuRouter);
router.use('/', logsRouter);
router.use('/system', systemRouter);
router.use('/', backupRouter);
router.use('/dedup', dedupRouter);
router.use('/download', downloadRouter);

export default router;

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Music,
  User,
  Smartphone,
  Mic,
  FolderSearch,
  Sparkles,
  Waves,
  ShieldCheck,
  ChevronRight,
  Inbox,
  AlertCircle,
  RefreshCcw,
  Activity,
  CalendarRange,
  CopyX,
  Server,
  type LucideIcon,
} from 'lucide-react';
import Loading from '../components/Loading';
import Badge, { type BadgeVariant } from '../components/Badge';
import Button from '../components/Button';
import { scanApi } from '../api/scan';
import { dedupApi, type DedupTaskItem } from '../api/dedup';
import { systemApi, type DashboardStats, type DashboardHistory, type ServicesHealth } from '../api/system';
import type { ScanTask } from '../types';
import { useCountUp } from '../hooks/useCountUp';

/* Hallmark · component: dashboard · genre: modern-minimal · theme: Cobalt
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 * motion: count-up（数字滚动）· draw-in（图表描边/淡入）· stagger-in（区块入场）
 * contrast: pass (AA on paper/ink pairings)
 */

const QUICK_ACTIONS = [
  { label: '扫描歌曲', description: '扫描本地音乐目录', path: '/scan', icon: FolderSearch },
  { label: 'AI 解析', description: '智能识别歌曲信息', path: '/ai-parse', icon: Sparkles },
  { label: '人声分离', description: '分离伴奏与人声', path: '/separation', icon: Waves },
  { label: '设备授权', description: '管理设备授权', path: '/devices', icon: ShieldCheck },
] satisfies { label: string; description: string; path: string; icon: LucideIcon }[];

const SCAN_STATUS_MAP: Record<ScanTask['status'], { variant: BadgeVariant; label: string }> = {
  completed: { variant: 'success', label: '已完成' },
  failed: { variant: 'danger', label: '失败' },
  running: { variant: 'warning', label: '进行中' },
};

// 近 14 天趋势：三个可切换指标（数据来自 /system/dashboard/history）
type TrendKey = 'playback' | 'separation' | 'aiParse';

const TREND_META: Record<TrendKey, { label: string; color: string; icon: LucideIcon }> = {
  playback: { label: '播放量', color: 'var(--color-accent)', icon: Activity },
  separation: { label: '分离完成', color: 'var(--color-success)', icon: Waves },
  aiParse: { label: 'AI 解析完成', color: 'var(--color-info)', icon: Sparkles },
};

function getNewSongs(result: unknown): number | null {
  if (result && typeof result === 'object' && 'newSongs' in result) {
    const v = (result as Record<string, unknown>).newSongs;
    return typeof v === 'number' ? v : null;
  }
  return null;
}

function formatTime(ts: number): string {
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 千分位数字 + 滚动动画（刷新时平滑过渡） */
function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const v = useCountUp(value);
  return <span className={className}>{v.toLocaleString()}</span>;
}

function SegmentBar({ segments }: { segments: { key: string; label: string; value: number; color: string }[] }) {
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="space-y-sm">
      <div className="h-2 w-full overflow-hidden rounded-full bg-paper-3" role="img" aria-label="状态分布">
        {segments.map((item) => (
          <div
            key={item.key}
            className="h-full transition-all duration-700 ease-out"
            style={{ width: `${total ? (item.value / total) * 100 : 0}%`, backgroundColor: item.color }}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-xs text-xs text-ink-3">
        {segments.map((item) => (
          <div key={item.key} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="truncate">{item.label}</span>
            <span className="ml-auto font-mono text-ink">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分钟`;
}

type HealthStatus = 'ok' | 'installing' | 'down';

const HEALTH_VARIANT: Record<HealthStatus, { variant: BadgeVariant; label: string }> = {
  ok: { variant: 'success', label: '正常' },
  installing: { variant: 'warning', label: '安装中' },
  down: { variant: 'danger', label: '异常' },
};

const HEALTH_COLOR: Record<HealthStatus, string> = {
  ok: 'var(--color-success)',
  installing: 'var(--color-warning)',
  down: 'var(--color-danger)',
};

function ServiceHealthCard({
  title,
  icon: Icon,
  status,
  detail,
  sub,
}: {
  title: string;
  icon: LucideIcon;
  status: HealthStatus;
  detail: string;
  sub?: string;
}) {
  const info = HEALTH_VARIANT[status];
  const color = HEALTH_COLOR[status];
  return (
    <div className="bg-paper-2 border border-border rounded-lg p-lg flex items-center gap-md min-w-0 animate-hall-in">
      <div
        className="w-12 h-12 rounded-md flex items-center justify-center shrink-0"
        style={{ backgroundColor: `color-mix(in oklch, ${color} 12%, transparent)`, color }}
      >
        <Icon className="w-6 h-6" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-sm">
          <span className="text-sm font-medium text-ink truncate">{title}</span>
          <Badge variant={info.variant} dot>
            {info.label}
          </Badge>
        </div>
        <div className="text-xs text-ink-3 mt-1 truncate">{detail}</div>
        {sub && <div className="text-xs text-ink-3 mt-0.5 truncate">{sub}</div>}
      </div>
    </div>
  );
}

function SparklineChart({ data, color, height = 40, label }: { data: number[]; color: string; height?: number; label: string }) {
  const width = 180;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const points = data
    .map((v, i) => {
      const x = i * step;
      const y = height - 4 - ((v - min) / range) * (height - 8);
      return `${x},${y}`;
    })
    .join(' ');
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={`grad-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#grad-${color.replace(/[^a-z0-9]/gi, '')})`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-all duration-700 ease-out"
      />
      {data.map((v, i) => {
        const x = i * step;
        const y = height - 4 - ((v - min) / range) * (height - 8);
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="2.5"
            vectorEffect="non-scaling-stroke"
            fill="var(--color-paper)"
            stroke={color}
            strokeWidth="1.5"
            className="opacity-0 hover:opacity-100 transition-opacity duration-200"
          />
        );
      })}
    </svg>
  );
}

function TrendCard({ title, value, subtitle, data, color, icon: Icon, delayClass }: {
  title: string;
  value: number;
  subtitle: string;
  data: number[];
  color: string;
  icon: LucideIcon;
  delayClass: string;
}) {
  return (
    <div className={`bg-paper-2 border border-border rounded-lg p-lg min-w-0 ${delayClass} hover:-translate-y-0.5 hover:shadow-md transition-all duration-300`}>
      <div className="flex items-start justify-between mb-md">
        <div className="flex items-center gap-sm min-w-0">
          <div className="w-10 h-10 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: `color-mix(in oklch, ${color} 12%, transparent)`, color }}>
            <Icon className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-ink-3">{title}</div>
            <div className="text-2xl font-display font-bold text-ink leading-tight">
              <AnimatedNumber value={value} />
            </div>
          </div>
        </div>
        <div className="text-xs text-ink-3 bg-paper-3 rounded-md px-2 py-1 shrink-0">{subtitle}</div>
      </div>
      <SparklineChart data={data} color={color} label={`${title}趋势`} />
    </div>
  );
}

function DonutChart({ segments, size = 160, thickness = 16 }: { segments: { key: string; label: string; value: number; color: string }[]; size?: number; thickness?: number }) {
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  const animatedTotal = useCountUp(total, 700);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-md">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="占比图" className="hall-fade-up">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-paper-3)" strokeWidth={thickness} />
        {segments.map((item) => {
          const ratio = total ? item.value / total : 0;
          const length = ratio * circumference;
          const currentOffset = offset;
          offset += length;
          return (
            <circle
              key={item.key}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={item.color}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-currentOffset}
              className="transition-all duration-700 ease-out"
            />
          );
        })}
        <text x="50%" y="46%" textAnchor="middle" className="fill-ink text-xl font-display font-bold" dominantBaseline="central">
          {animatedTotal}
        </text>
        <text x="50%" y="62%" textAnchor="middle" className="fill-ink-3 text-xs" dominantBaseline="central">
          任务总量
        </text>
      </svg>
      <div className="grid grid-cols-2 gap-x-md gap-y-xs text-xs text-ink-3">
        {segments.map((item) => (
          <div key={item.key} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="truncate">{item.label}</span>
            <span className="ml-auto font-mono text-ink">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 近 14 天趋势大图：SVG 折线 + 面积渐变 + 网格 + hover tooltip。
 * 文字全部用 HTML 渲染（svg preserveAspectRatio=none 拉伸时不变形），
 * 折线用 pathLength=1 归一化 + hall-line-draw 描边动画（切换指标时重放）。
 */
function TrendChart({ labels, data, color, accentLabel }: { labels: string[]; data: number[]; color: string; accentLabel: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const width = 560;
  const height = 200;
  const padL = 10;
  const padR = 10;
  const padT = 14;
  const padB = 10;
  const max = Math.max(...data, 1);
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const step = data.length > 1 ? innerW / (data.length - 1) : innerW;

  const points = data.map((v, i) => ({
    x: padL + i * step,
    y: padT + innerH - (v / max) * innerH,
    v,
  }));
  const linePoints = points.map((p) => `${p.x},${p.y}`).join(' ');
  const areaPath = `M ${padL},${padT + innerH} L ${linePoints.split(' ').join(' L ')} L ${width - padR},${padT + innerH} Z`;

  // x 轴刻度：取 14 天里的 ~4 个（首/1/3 处/末），避免移动端拥挤
  const tickIndexes = data.length > 1 ? [0, Math.floor((data.length - 1) / 3), Math.floor(((data.length - 1) * 2) / 3), data.length - 1] : [0];
  const gridLines = [0.25, 0.5, 0.75, 1].map((ratio) => padT + innerH * (1 - ratio));

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const idx = Math.max(0, Math.min(data.length - 1, Math.round((x - padL) / step)));
    setHoverIndex(idx);
  };

  const hover = hoverIndex != null ? points[hoverIndex] : null;

  return (
    <div ref={containerRef} className="relative min-w-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="auto"
        preserveAspectRatio="none"
        role="img"
        aria-label={`近 14 天${accentLabel}趋势`}
        className="overflow-visible"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id={`trend-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridLines.map((y, i) => (
          <line
            key={i}
            x1={padL}
            x2={width - padR}
            y1={y}
            y2={y}
            stroke="var(--color-border)"
            strokeWidth="1"
            strokeDasharray="4 6"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={areaPath} fill={`url(#trend-${color.replace(/[^a-z0-9]/gi, '')})`} className="hall-fade-up" />
        <polyline
          key={`line-${accentLabel}`}
          points={linePoints}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          className="hall-line-draw"
        />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="4"
            vectorEffect="non-scaling-stroke"
            fill={color}
            className={hoverIndex === i ? 'opacity-100' : 'opacity-0'}
            style={{ transition: 'opacity var(--dur-fast) var(--ease-out)' }}
          />
        ))}
      </svg>
      {/* x 轴标签：HTML 渲染，避免 SVG 拉伸变形 */}
      <div className="flex justify-between mt-sm text-xs text-ink-3 font-mono">
        {tickIndexes.map((i) => (
          <span key={i} className="truncate">{labels[i]?.slice(5)}</span>
        ))}
      </div>
      {/* hover tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 bg-ink text-paper text-xs font-mono rounded-md px-2 py-1 shadow-lg"
          style={{
            left: `${(hover.x / width) * 100}%`,
            top: `${(hover.y / height) * 100}%`,
            transform: `translate(-50%, calc(-100% - 8px))`,
          }}
        >
          {labels[hoverIndex!]?.slice(5)} · {hover.v}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [history, setHistory] = useState<DashboardHistory | null>(null);
  const [scanTasks, setScanTasks] = useState<ScanTask[]>([]);
  const [dedupTasks, setDedupTasks] = useState<DedupTaskItem[]>([]);
  const [dedupEnabled, setDedupEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState('');
  const [trendTab, setTrendTab] = useState<TrendKey>('playback');
  const [health, setHealth] = useState<ServicesHealth | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading((prev) => !stats && prev);
      setError('');
      try {
        const [dashboardRes, scanRes, dedupStatusRes, dedupTasksRes, healthRes] = await Promise.all([
          systemApi.getDashboard(),
          scanApi.history({ limit: 5, offset: 0 }),
          dedupApi.status().catch(() => null),
          dedupApi.tasks(100).catch(() => []),
          systemApi.getHealth().catch(() => null),
        ]);
        if (cancelled) return;
        setStats(dashboardRes);
        setScanTasks(scanRes.items ?? []);
        setDedupEnabled(dedupStatusRes?.lastResult?.enabled ?? null);
        setDedupTasks(dedupTasksRes);
        setHealth(healthRes);
        setUpdatedAt(new Date());
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '加载仪表盘数据失败');
      } finally {
        if (!cancelled) setLoading(false);
        if (!cancelled) setRefreshing(false);
      }
    }
    load();
    // 主数据轮询 10s；页面从后台切回时立即刷新，保证实时性
    const timer = setInterval(load, 10000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // 趋势历史独立轮询（60s）：14 天聚合查询成本较高，且任务/播放趋势分钟级刷新足够
  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      try {
        const res = await systemApi.getDashboardHistory();
        if (!cancelled) setHistory(res);
      } catch {
        // 趋势区失败静默降级（主面板不受影响）
      }
    }
    loadHistory();
    const timer = setInterval(loadHistory, 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const summaryCards = useMemo(
    () =>
      stats
        ? [
            { label: '歌曲库', value: stats.songs.total, icon: Music, caption: `歌词 ${stats.songs.hasLyrics}` },
            { label: '歌手库', value: stats.artists.total, icon: User, caption: '关联元信息维护' },
            { label: '今日播放', value: stats.playback.today, icon: Smartphone, caption: `累计 ${stats.playback.total}` },
            { label: '活跃房间', value: stats.rooms.active, icon: Mic, caption: `全部 ${stats.rooms.total}` },
          ]
        : [],
    [stats]
  );

  const separationSegments = useMemo(() => {
    if (!stats) return [];
    const { pending, processing, completed, failed } = stats.separation;
    return [
      { key: 'pending', label: '排队中', value: pending, color: 'var(--color-ink-3)' },
      { key: 'processing', label: '分离中', value: processing, color: 'var(--color-warning)' },
      { key: 'completed', label: '已完成', value: completed, color: 'var(--color-success)' },
      { key: 'failed', label: '失败', value: failed, color: 'var(--color-danger)' },
    ];
  }, [stats]);

  const aiSegments = useMemo(() => {
    if (!stats) return [];
    const { pending, processing, completed, failed, needReview } = stats.aiParse;
    return [
      { key: 'pending', label: '排队中', value: pending, color: 'var(--color-ink-3)' },
      { key: 'processing', label: '解析中', value: processing, color: 'var(--color-info)' },
      { key: 'completed', label: '已完成', value: completed, color: 'var(--color-success)' },
      { key: 'failed', label: '失败', value: failed, color: 'var(--color-danger)' },
      { key: 'need_review', label: '待复核', value: needReview, color: 'var(--color-warning)' },
    ];
  }, [stats]);

  const metadataSegments = useMemo(() => {
    if (!stats) return [];
    return [
      { key: 'complete', label: '元信息完整', value: stats.songs.metadataComplete, color: 'var(--color-success)' },
      { key: 'missing_title', label: '缺标题', value: stats.songs.metadataMissingTitle, color: 'var(--color-danger)' },
      { key: 'missing_artist', label: '缺歌手', value: stats.songs.metadataMissingArtist, color: 'var(--color-warning)' },
    ];
  }, [stats]);

  // AI 智能去重汇总：近 100 次任务聚合
  const dedupSummary = useMemo(() => {
    let checked = 0;
    let removed = 0;
    for (const t of dedupTasks) {
      checked += t.checked;
      removed += t.removed;
    }
    return { runs: dedupTasks.length, checked, removed };
  }, [dedupTasks]);
  const latestDedup = dedupTasks[0] ?? null;

  // 趋势区数据：当前指标序列 + 三张汇总卡（近 14 天合计/日均/峰值）
  const trendData = history ? (history[trendTab] ?? []) : [];
  const trendMeta = TREND_META[trendTab];
  const trendSeries = useMemo(() => {
    if (!history) return [];
    return (Object.keys(TREND_META) as TrendKey[]).map((key) => {
      const data = history[key] ?? [];
      const total = data.reduce((s, v) => s + v, 0);
      const avg = data.length ? total / data.length : 0;
      const peak = data.length ? Math.max(...data) : 0;
      return { key, meta: TREND_META[key], data, total, avg, peak };
    });
  }, [history]);

  const handleRefresh = () => {
    setRefreshing(true);
    setError('');
    // 最短可见时长：本地后端响应极快（<16ms），若不兜底，refreshing 在浏览器
    // 绘制前就被设回 false，用户完全看不到旋转动画。强制 spinner 至少展示 400ms。
    const minSpinner = new Promise<void>((resolve) => setTimeout(resolve, 400));
    // 手动刷新同时拉取历史趋势
    const historyReq = systemApi
      .getDashboardHistory()
      .then((h) => setHistory(h))
      .catch(() => {});
    // 触发主数据轮询（通过重新挂载不优雅，直接并行请求一次）
    const mainReq = Promise.all([
      systemApi.getDashboard(),
      scanApi.history({ limit: 5, offset: 0 }),
      dedupApi.status().catch(() => null),
      dedupApi.tasks(100).catch(() => []),
      systemApi.getHealth().catch(() => null),
    ])
      .then(([d, s, ds, dt, h]) => {
        setStats(d);
        setScanTasks(s.items ?? []);
        setDedupEnabled(ds?.lastResult?.enabled ?? null);
        setDedupTasks(dt);
        setHealth(h);
        setUpdatedAt(new Date());
      })
      .catch((err) => setError(err instanceof Error ? err.message : '刷新失败'));
    // 数据与最短时长都完成才结束旋转，保证用户能感知到刷新动作
    Promise.all([historyReq, mainReq, minSpinner]).finally(() =>
      setRefreshing(false),
    );
  };

  return (
    <div className="p-lg space-y-lg">
      <header className="flex flex-col gap-sm sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-ink">仪表盘</h1>
          <p className="text-sm text-ink-3">歌曲库、任务处理与近 14 天趋势一览，数据自动刷新。</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          leftIcon={<RefreshCcw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />}
          onClick={handleRefresh}
        >
          {updatedAt ? `更新于 ${formatTime(updatedAt.getTime())}` : '刷新数据'}
        </Button>
      </header>

      {loading ? (
        <Loading />
      ) : stats ? (
        <>
          {error && (
            <div className="flex items-center gap-sm text-danger">
              <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          {/* 摘要指标：移动 1 列 / 平板 2 列 / 桌面 4 列，数字滚动 + 交错入场 */}
          <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-md">
            {summaryCards.map((card, i) => {
              const Icon = card.icon;
              const delayClass = i === 0 ? '' : i === 1 ? 'animate-hall-in-delay-1' : i === 2 ? 'animate-hall-in-delay-2' : 'animate-hall-in-delay-3';
              return (
                <div
                  key={card.label}
                  className={`bg-paper-2 border border-border rounded-lg p-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md focus-visible:ring focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper flex items-center gap-md min-w-0 animate-hall-in ${delayClass}`}
                >
                  <div className="w-12 h-12 rounded-md bg-accent-soft flex items-center justify-center text-accent shrink-0">
                    <Icon className="w-6 h-6" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-3xl font-display font-bold text-ink leading-tight tabular-nums">
                      <AnimatedNumber value={card.value} />
                    </div>
                    <div className="text-sm font-body text-ink-3 mt-xs">{card.label}</div>
                    <div className="text-xs text-ink-3 mt-1 truncate">{card.caption}</div>
                  </div>
                </div>
              );
            })}
          </section>

          {/* 服务健康：后端 API + 人声分离服务（随仪表盘 10s 轮询刷新） */}
          {health && (
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-md animate-hall-in-delay-1">
              <ServiceHealthCard
                title="后端服务"
                icon={Server}
                status="ok"
                detail={`v${health.backend.version} · 已运行 ${formatUptime(health.backend.uptimeSec)}`}
              />
              {(() => {
                const sep = health.separator;
                let detail = '';
                let sub: string | undefined;
                if (sep.status === 'down') {
                  detail = sep.error ?? '分离服务不可达';
                } else {
                  const device = sep.device ? `设备 ${sep.device}` : '设备 —';
                  detail = `${device} · ffmpeg ${sep.ffmpegAvailable ? '就绪' : '缺失'} · 模型 ${sep.modelLoaded ? '已加载' : '未加载'}`;
                  if (sep.status === 'installing') {
                    sub = `依赖安装中 ${Math.round(sep.installProgress ?? 0)}%`;
                  } else if (sep.installState === 'failed') {
                    sub = sep.error ? `安装失败：${sep.error}` : '依赖安装失败';
                  }
                }
                return (
                  <ServiceHealthCard
                    title="人声分离服务"
                    icon={Waves}
                    status={sep.status}
                    detail={detail}
                    sub={sub}
                  />
                );
              })()}
            </section>
          )}

          {/* 近 14 天趋势：大图（指标切换）+ 三张汇总卡 */}
          {history && (
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-md animate-hall-in-delay-1">
              <div className="lg:col-span-2 bg-paper-2 border border-border rounded-lg p-lg min-w-0">
                <div className="flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between mb-md">
                  <h2 className="text-lg font-display font-semibold text-ink flex items-center gap-sm">
                    <CalendarRange className="w-5 h-5 text-accent" aria-hidden="true" />
                    近 14 天趋势
                  </h2>
                  <div className="flex gap-xs bg-paper-3 rounded-md p-xs" role="tablist" aria-label="趋势指标切换">
                    {(Object.keys(TREND_META) as TrendKey[]).map((key) => (
                      <button
                        key={key}
                        role="tab"
                        aria-selected={trendTab === key}
                        onClick={() => setTrendTab(key)}
                        className={`px-sm py-1 rounded-md text-xs font-medium transition-all duration-200 focus-visible:ring focus-visible:ring-accent focus-visible:ring-offset-1 ${
                          trendTab === key ? 'bg-paper text-accent shadow-sm' : 'text-ink-3 hover:text-ink'
                        }`}
                      >
                        {TREND_META[key].label}
                      </button>
                    ))}
                  </div>
                </div>
                <TrendChart key={trendTab} labels={history.labels} data={trendData} color={trendMeta.color} accentLabel={trendMeta.label} />
              </div>

              <div className="flex flex-col gap-md">
                {trendSeries.map((s, i) => (
                  <TrendCard
                    key={s.key}
                    title={`近 14 天${s.meta.label}`}
                    value={s.total}
                    subtitle={`日均 ${Math.round(s.avg)}`}
                    data={s.data}
                    color={s.meta.color}
                    icon={s.meta.icon}
                    delayClass={i === 0 ? '' : i === 1 ? 'animate-hall-in-delay-1' : 'animate-hall-in-delay-2'}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 任务处理状态 + 歌曲资料完整度 */}
          <section className="grid grid-cols-1 xl:grid-cols-3 gap-md animate-hall-in-delay-2">
            <div className="xl:col-span-2 bg-paper-2 border border-border rounded-lg p-lg">
              <h2 className="text-lg font-display font-semibold text-ink mb-md">任务处理状态</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-lg">
                <DonutChart segments={separationSegments} />
                <div className="space-y-md">
                  <div className="text-sm text-ink-2">人声分离队列</div>
                  <SegmentBar segments={separationSegments} />
                  <div className="text-sm text-ink-2">AI 解析队列</div>
                  <SegmentBar segments={aiSegments} />
                  <div className="text-xs text-ink-3">正在分离 {stats.separation.processing} 项，正在 AI 解析 {stats.aiParse.processing} 项。</div>
                </div>
              </div>
            </div>
            <div className="bg-paper-2 border border-border rounded-lg p-lg">
              <h2 className="text-lg font-display font-semibold text-ink mb-md">歌曲资料完整度</h2>
              <div className="space-y-md">
                <DonutChart segments={metadataSegments} size={150} thickness={18} />
                <div className="grid grid-cols-2 gap-sm text-sm text-ink-2">
                  <div className="rounded-md bg-paper-3 p-sm">
                    <div className="text-xs text-ink-3">歌词覆盖</div>
                    <div className="font-display text-ink">{stats.songs.hasLyrics} 首</div>
                  </div>
                  <div className="rounded-md bg-paper-3 p-sm">
                    <div className="text-xs text-ink-3">已生成人声</div>
                    <div className="font-display text-ink">{stats.songs.hasVocal} 首</div>
                  </div>
                  <div className="rounded-md bg-paper-3 p-sm">
                    <div className="text-xs text-ink-3">已生成伴奏</div>
                    <div className="font-display text-ink">{stats.songs.hasInstrumental} 首</div>
                  </div>
                  <div className="rounded-md bg-paper-3 p-sm">
                    <div className="text-xs text-ink-3">待复核</div>
                    <div className="font-display text-ink">{stats.aiParse.needReview} 条</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 最近扫描任务 + 快捷操作 + AI 智能去重 */}
          <section className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-md animate-hall-in-delay-3">
            <div className="bg-paper-2 border border-border rounded-lg p-lg min-w-0">
              <h2 className="text-lg font-display font-semibold text-ink mb-md">最近扫描任务</h2>
              {scanTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-xl text-ink-3 gap-sm">
                  <Inbox className="w-10 h-10" aria-hidden="true" />
                  <span className="text-sm">暂无扫描记录</span>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {scanTasks.map((task) => {
                    const statusInfo = SCAN_STATUS_MAP[task.status] ?? { variant: 'neutral' as BadgeVariant, label: task.status };
                    const newSongs = getNewSongs(task.result);
                    return (
                      <li key={task.id} className="py-md flex items-start gap-md min-w-0">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-sm mb-xs">
                            <Badge variant={statusInfo.variant} dot>{statusInfo.label}</Badge>
                            <span className="text-xs text-ink-3 font-mono">{formatTime(task.startTime)}</span>
                          </div>
                          <div className="text-sm text-ink font-body truncate" title={task.scanPath}>{task.scanPath || '—'}</div>
                          <div className="text-xs text-ink-3 font-body mt-xs">{newSongs !== null ? `新增 ${newSongs} 首` : '—'}</div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="bg-paper-2 border border-border rounded-lg p-lg">
              <h2 className="text-lg font-display font-semibold text-ink mb-md">快捷操作</h2>
              <div className="space-y-sm">
                {QUICK_ACTIONS.map((action) => {
                  const Icon = action.icon;
                  return (
                    <Button
                      key={action.path}
                      variant="secondary"
                      className="w-full justify-start py-md"
                      leftIcon={<Icon className="w-5 h-5" aria-hidden="true" />}
                      rightIcon={<ChevronRight className="w-4 h-4 text-ink-3" aria-hidden="true" />}
                      onClick={() => navigate(action.path)}
                    >
                      <span className="flex flex-col items-start text-left mr-auto">
                        <span className="text-sm font-medium">{action.label}</span>
                        <span className="text-xs text-ink-3">{action.description}</span>
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="bg-paper-2 border border-border rounded-lg p-lg">
              <h2 className="text-lg font-display font-semibold text-ink mb-md flex items-center gap-sm">
                <CopyX className="w-5 h-5 text-accent" aria-hidden="true" />
                智能去重
              </h2>
              <div className="space-y-md">
                <div className="flex items-center gap-sm flex-wrap">
                  <Badge variant={dedupEnabled ? 'success' : 'neutral'} dot>
                    {dedupEnabled === null ? '未执行过' : dedupEnabled ? '启用' : '停用'}
                  </Badge>
                  <span className="text-xs text-ink-3">同名 + 同歌手 + 同版本比对</span>
                </div>
                {latestDedup ? (
                  <div className="rounded-md bg-paper-3 p-sm space-y-sm">
                    <div className="text-xs text-ink-3">
                      最近执行 · {formatTime(latestDedup.startedAt)}
                    </div>
                    <div className="flex gap-lg text-sm text-ink-2">
                      <span>
                        检查{' '}
                        <span className="font-mono text-ink">{latestDedup.checked}</span>{' '}
                        首
                      </span>
                      <span>
                        删除{' '}
                        <span className="font-mono text-danger">{latestDedup.removed}</span>{' '}
                        首
                      </span>
                    </div>
                    {latestDedup.status === 'failed' && (
                      <div className="text-xs text-danger break-all">
                        {latestDedup.error}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-ink-3">尚未执行过智能去重</p>
                )}
                <div className="grid grid-cols-2 gap-sm text-sm text-ink-2">
                  <div className="rounded-md bg-paper-3 p-sm">
                    <div className="text-xs text-ink-3">累计执行</div>
                    <div className="font-display text-ink">{dedupSummary.runs} 次</div>
                  </div>
                  <div className="rounded-md bg-paper-3 p-sm">
                    <div className="text-xs text-ink-3">累计检查</div>
                    <div className="font-display text-ink">{dedupSummary.checked} 首</div>
                  </div>
                </div>
                <Link
                  to="/dedup"
                  className="inline-flex items-center gap-1 text-sm text-accent hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
                >
                  去重管理
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

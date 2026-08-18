import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Smartphone,
  Pencil,
  ShieldOff,
  Shield,
  RefreshCw,
  Check,
  Trash2,
  CheckSquare,
  Square,
  X,
  Loader2,
} from 'lucide-react';
import { devicesApi } from '../api/devices';
import type { Device } from '../types';
import Button from '../components/Button';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import Input from '../components/Input';
import Pagination from '../components/Pagination';
import Loading from '../components/Loading';
import { useToast } from '../components/Toast';

type DeviceStatus = 'pending' | 'active' | 'revoked' | 'closed';

const statusVariantMap: Record<
  DeviceStatus,
  'warning' | 'success' | 'danger' | 'neutral'
> = {
  pending: 'warning',
  active: 'success',
  revoked: 'danger',
  closed: 'neutral',
};

const statusLabel: Record<DeviceStatus, string> = {
  pending: '待授权',
  active: '已授权',
  revoked: '已撤销',
  closed: '已关闭',
};

function getStatus(device: Device): DeviceStatus {
  const map: Record<number, DeviceStatus> = {
    0: 'pending',
    1: 'active',
    2: 'revoked',
    3: 'closed',
  };
  let status = map[device.authorized] ?? 'pending';
  if (device.status === 'revoked' || device.status === 'closed') {
    status = device.status;
  }
  if (
    status === 'active' &&
    device.authorizeType === 'temporary' &&
    device.authorizeExpiresAt &&
    new Date(device.authorizeExpiresAt).getTime() <= Date.now()
  ) {
    status = 'revoked';
  }
  return status;
}

function authorizeTypeVariant(
  type: string | null
): 'info' | 'warning' | 'neutral' {
  if (type === 'permanent') return 'info';
  if (type === 'temporary') return 'warning';
  return 'neutral';
}

function authorizeTypeLabel(type: string | null): string {
  if (type === 'permanent') return '永久';
  if (type === 'temporary') return '临时';
  return '—';
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

interface AuthorizeModalState {
  device: Device;
  mode: 'authorize' | 'renew';
}

const durationPresets = [
  { label: '2 小时', ms: 2 * 60 * 60 * 1000 },
  { label: '1 天', ms: 24 * 60 * 60 * 1000 },
  { label: '7 天', ms: 7 * 24 * 60 * 60 * 1000 },
];

export default function Devices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<DeviceStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const [authModal, setAuthModal] = useState<AuthorizeModalState | null>(null);
  const [durationMs, setDurationMs] = useState<number>(durationPresets[0].ms);
  const [customHours, setCustomHours] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  // 单行授权类型：与批量授权保持一致，弹窗内可切换永久/临时
  const [authAuthorizeType, setAuthAuthorizeType] = useState<
    'permanent' | 'temporary'
  >('temporary');

  const [renameModal, setRenameModal] = useState<Device | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);

  const [deleteModal, setDeleteModal] = useState<Device | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // 多选状态：选中设备 id 集合。翻页/筛选切换时清空，避免对不可见设备误操作。
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // 批量操作类型：'authorize' | 'revoke' | 'delete'
  // authorize 模式下 authorizeType='permanent' | 'temporary'，临时模式带 expiresAt
  const [batchModal, setBatchModal] = useState<
    | {
        type: 'authorize' | 'revoke' | 'delete';
        ids: number[];
      }
    | null
  >(null);
  // 批量授权参数（仅 type='authorize' 时使用）
  const [batchAuthorizeType, setBatchAuthorizeType] = useState<
    'permanent' | 'temporary'
  >('permanent');
  const [batchDurationMs, setBatchDurationMs] = useState<number>(
    durationPresets[0].ms
  );
  const [batchCustomHours, setBatchCustomHours] = useState('');
  const [batchLoading, setBatchLoading] = useState(false);

  const [undoBanner, setUndoBanner] = useState<{
    id: number;
    label: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  // 刷新相关状态
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const { showToast, ToastContainer } = useToast();

  // 静默刷新：不触发 loading 遮罩，仅更新数据。用于轮询和手动刷新按钮。
  const refreshDevices = useCallback(async () => {
    setRefreshing(true);
    try {
      const params: { page: number; limit: number; status?: string } = {
        page,
        limit: pageSize,
      };
      if (statusFilter !== 'all') params.status = statusFilter;
      const res = await devicesApi.list(params);
      setDevices(res.items ?? []);
      // Number 兜底：后端 count(*) 理论返回 number，但保险起见
      setTotal(Number(res.total ?? 0));
      setLastUpdated(new Date());
    } catch {
      // 静默刷新失败不打扰用户，下次轮询会重试
    } finally {
      setRefreshing(false);
    }
  }, [page, pageSize, statusFilter]);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      const params: { page: number; limit: number; status?: string } = {
        page,
        limit: pageSize,
      };
      if (statusFilter !== 'all') params.status = statusFilter;
      const res = await devicesApi.list(params);
      setDevices(res.items ?? []);
      setTotal(Number(res.total ?? 0));
      setLastUpdated(new Date());
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : '加载设备列表失败';
      showToast('error', msg);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter, showToast]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  // 自动轮询刷新：每 10 秒静默刷新设备列表，及时发现新注册设备。
  // 当有弹窗打开，或正在展示「撤销 Undo」横幅时暂停轮询，避免轮询在
  // 延迟的撤销 API 真正发出前把仍是 active 的设备重新加回界面（导致界面不刷新）。
  const hasOpenModal =
    authModal || renameModal || deleteModal || batchModal || undoBanner;
  useEffect(() => {
    if (hasOpenModal) return;
    const timer = setInterval(() => {
      refreshDevices();
    }, 10_000);
    return () => clearInterval(timer);
  }, [hasOpenModal, refreshDevices]);

  // 清理 undo 定时器
  useEffect(() => {
    return () => {
      if (undoBanner) clearTimeout(undoBanner.timer);
    };
  }, [undoBanner]);

  const openAuthorize = (device: Device, mode: AuthorizeModalState['mode']) => {
    setAuthModal({ device, mode });
    setDurationMs(durationPresets[0].ms);
    setCustomHours('');
    // 续期模式：根据当前授权类型预选（已是永久则默认永久，否则临时）
    // 授权模式：默认临时（pending 设备通常先给临时授权试用）
    setAuthAuthorizeType(
      mode === 'renew' && device.authorizeType === 'permanent'
        ? 'permanent'
        : 'temporary'
    );
  };

  const submitAuthorize = async () => {
    if (!authModal) return;
    const { device, mode } = authModal;
    const authorizeType = authAuthorizeType;
    let expiresAt: string | undefined;

    if (authorizeType === 'temporary') {
      let ms = durationMs;
      if (ms < 0) {
        const hours = parseFloat(customHours);
        if (!Number.isFinite(hours) || hours <= 0) {
          showToast('warning', '请输入有效的自定义时长');
          return;
        }
        ms = hours * 60 * 60 * 1000;
      }
      // 续期模式：基于原过期时间往后延；授权模式：从当前时间开始计算
      const base =
        mode === 'renew' && device.authorizeExpiresAt
          ? new Date(device.authorizeExpiresAt).getTime()
          : Date.now();
      expiresAt = new Date(base + ms).toISOString();
    }

    setAuthLoading(true);
    try {
      if (mode === 'renew' && authorizeType === 'temporary') {
        // 续期临时授权：用 renew 接口（仅更新 expiresAt）
        await devicesApi.renew(device.id, { expiresAt });
      } else {
        // 新授权 或 续期时转永久：用 authorize 接口（更新 authorizeType + expiresAt）
        await devicesApi.authorize(device.id, { authorizeType, expiresAt });
      }
      showToast('success', mode === 'renew' ? '设备续期成功' : '设备授权成功');
      setAuthModal(null);
      await loadDevices();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : '授权操作失败';
      showToast('error', msg);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRevoke = (device: Device) => {
    // optimistic update + Undo banner
    const snapshot = devices;
    setDevices((prev) => prev.filter((d) => d.id !== device.id));
    const timer = setTimeout(async () => {
      try {
        await devicesApi.revoke(device.id);
      } catch (err) {
        setDevices(snapshot);
        const msg =
          err instanceof Error ? err.message : '撤销授权失败';
        showToast('error', msg);
      } finally {
        setUndoBanner(null);
        // 撤销 API 落库后立即与服务端同步：成功→该行以「已撤销」状态重新出现，
        // 失败→回滚为「已授权」。避免界面停留在乐观删除后的状态、看起来「不刷新」。
        refreshDevices();
      }
    }, 5000);
    setUndoBanner({
      id: device.id,
      label: device.deviceName || device.deviceId,
      timer,
    });
  };

  const handleUndo = () => {
    if (!undoBanner) return;
    clearTimeout(undoBanner.timer);
    setUndoBanner(null);
    loadDevices();
  };

  const openRename = (device: Device) => {
    setRenameModal(device);
    setRenameValue(device.deviceName || '');
  };

  const submitRename = async () => {
    if (!renameModal) return;
    const name = renameValue.trim();
    if (!name) {
      showToast('warning', '设备名不能为空');
      return;
    }
    setRenameLoading(true);
    try {
      await devicesApi.rename(renameModal.id, { name });
      showToast('success', '设备重命名成功');
      setRenameModal(null);
      await loadDevices();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : '重命名失败';
      showToast('error', msg);
    } finally {
      setRenameLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteModal) return;
    setDeleteLoading(true);
    try {
      await devicesApi.delete(deleteModal.id);
      setDeleteModal(null);
      showToast('success', '设备已删除');
      await loadDevices();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : '删除设备失败';
      showToast('error', msg);
    } finally {
      setDeleteLoading(false);
    }
  };

  // ============ 多选操作 ============

  // 当前页全部设备 id（用于全选）
  const currentPageIds = useMemo(
    () => devices.map((d) => d.id),
    [devices]
  );
  const allSelected =
    currentPageIds.length > 0 &&
    currentPageIds.every((id) => selectedIds.has(id));
  const someSelected = currentPageIds.some((id) => selectedIds.has(id));

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        // 取消当前页全选
        currentPageIds.forEach((id) => next.delete(id));
      } else {
        // 选中当前页全部（保留其他页已选）
        currentPageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // 翻页/筛选切换时清空选择
  useEffect(() => {
    clearSelection();
  }, [page, statusFilter, pageSize]);

  // 批量授权（弹窗内可选永久/临时）
  const openBatchAuthorize = () => {
    if (selectedIds.size === 0) return;
    // 重置为默认值：永久授权
    setBatchAuthorizeType('permanent');
    setBatchDurationMs(durationPresets[0].ms);
    setBatchCustomHours('');
    setBatchModal({
      type: 'authorize',
      ids: Array.from(selectedIds),
    });
  };

  // 批量撤销
  const openBatchRevoke = () => {
    if (selectedIds.size === 0) return;
    setBatchModal({
      type: 'revoke',
      ids: Array.from(selectedIds),
    });
  };

  // 批量删除
  const openBatchDelete = () => {
    if (selectedIds.size === 0) return;
    setBatchModal({
      type: 'delete',
      ids: Array.from(selectedIds),
    });
  };

  // 执行批量操作：循环调用单个接口，统计成功/失败数
  const submitBatch = async () => {
    if (!batchModal) return;
    const { type, ids } = batchModal;

    // 授权模式：计算 authorizeType 和 expiresAt
    let authorizeType: string | null = null;
    let expiresAt: string | undefined;
    if (type === 'authorize') {
      authorizeType = batchAuthorizeType;
      if (batchAuthorizeType === 'temporary') {
        let ms = batchDurationMs;
        if (ms < 0) {
          const hours = parseFloat(batchCustomHours);
          if (!Number.isFinite(hours) || hours <= 0) {
            showToast('warning', '请输入有效的自定义时长');
            return;
          }
          ms = hours * 60 * 60 * 1000;
        }
        expiresAt = new Date(Date.now() + ms).toISOString();
      }
    }

    setBatchLoading(true);
    let success = 0;
    let failed = 0;
    let firstError = '';

    for (const id of ids) {
      try {
        if (type === 'authorize' && authorizeType) {
          await devicesApi.authorize(id, { authorizeType, expiresAt });
        } else if (type === 'revoke') {
          await devicesApi.revoke(id);
        } else if (type === 'delete') {
          await devicesApi.delete(id);
        }
        success++;
      } catch (err) {
        if (!firstError) {
          firstError =
            err instanceof Error ? err.message : '操作失败';
        }
        failed++;
      }
    }

    setBatchLoading(false);
    setBatchModal(null);
    clearSelection();

    if (failed === 0) {
      const actionLabel =
        type === 'authorize'
          ? batchAuthorizeType === 'permanent'
            ? '永久授权'
            : '临时授权'
          : type === 'revoke'
          ? '撤销'
          : '删除';
      showToast('success', `${actionLabel}完成：成功 ${success} 台`);
    } else if (success === 0) {
      showToast('error', `全部失败：${firstError}`);
    } else {
      showToast(
        'warning',
        `成功 ${success} 台，失败 ${failed} 台。${firstError}`
      );
    }
    await loadDevices();
  };

  const batchModalTitle =
    batchModal?.type === 'authorize'
      ? '批量授权'
      : batchModal?.type === 'revoke'
      ? '批量撤销授权'
      : '批量删除设备';

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const filterTabs: { value: DeviceStatus | 'all'; label: string }[] = [
    { value: 'all', label: '全部' },
    { value: 'pending', label: '待授权' },
    { value: 'active', label: '已授权' },
    { value: 'revoked', label: '已撤销' },
    { value: 'closed', label: '已关闭' },
  ];

  return (
    <div className="p-lg">
      <ToastContainer />
      <div className="flex items-start justify-between mb-md gap-md flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold text-ink mb-xs">
            设备授权
          </h1>
          <p className="text-sm text-ink-3">
            管理接入系统的设备授权与房间码
          </p>
        </div>
        <div className="flex items-center gap-md">
          <div className="text-sm text-ink-3 font-mono text-right">
            <div>共 {total} 台设备</div>
            {lastUpdated && (
              <div className="text-xs text-ink-4">
                更新于 {formatDateTime(lastUpdated.toISOString())}
              </div>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={
              <RefreshCw
                className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
              />
            }
            onClick={refreshDevices}
            disabled={refreshing}
          >
            刷新
          </Button>
        </div>
      </div>

      {/* Undo banner */}
      {undoBanner && (
        <div
          className="mb-md flex items-center justify-between gap-md px-md py-sm rounded-md border border-border bg-paper-2"
          role="status"
        >
          <div className="flex items-center gap-sm text-sm text-ink-2">
            <ShieldOff className="w-4 h-4 text-warning" />
            <span>
              已撤销 <strong className="text-ink">{undoBanner.label}</strong> 的授权
            </span>
          </div>
          <button
            onClick={handleUndo}
            className="text-sm font-medium text-accent hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
          >
            撤销操作
          </button>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-xs mb-md flex-wrap">
        {filterTabs.map((tab) => {
          const active = statusFilter === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => {
                setStatusFilter(tab.value);
                setPage(1);
              }}
              className={[
                'inline-flex items-center px-sm py-1.5 rounded-md text-sm font-medium',
                'border transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                active
                  ? 'border-accent bg-accent text-paper'
                  : 'border-border bg-paper text-ink-2 hover:bg-paper-2 hover:text-ink',
              ].join(' ')}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 批量操作工具栏：有选中设备时显示 */}
      {selectedIds.size > 0 && (
        <div
          className="mb-md flex items-center justify-between gap-md px-md py-sm rounded-md border border-accent bg-accent/5"
          role="toolbar"
          aria-label="批量操作"
        >
          <div className="flex items-center gap-sm text-sm text-ink-2">
            <CheckSquare className="w-4 h-4 text-accent" />
            <span>
              已选中 <strong className="text-ink">{selectedIds.size}</strong> 台设备
            </span>
          </div>
          <div className="flex items-center gap-xs flex-wrap">
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Shield className="w-3.5 h-3.5" />}
              onClick={openBatchAuthorize}
              disabled={batchLoading}
            >
              授权
            </Button>
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<ShieldOff className="w-3.5 h-3.5" />}
              onClick={openBatchRevoke}
              disabled={batchLoading}
            >
              撤销
            </Button>
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
              onClick={openBatchDelete}
              disabled={batchLoading}
              className="text-danger hover:text-danger"
            >
              删除
            </Button>
            <button
              onClick={clearSelection}
              disabled={batchLoading}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-3 hover:text-ink hover:bg-paper-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors"
              aria-label="取消选择"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-paper border border-border rounded-lg overflow-hidden">
        {loading ? (
          <Loading />
        ) : devices.length === 0 ? (
          <div className="py-xl text-center text-ink-3 text-sm">
            暂无设备记录
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-paper-2 text-ink-3">
                <tr>
                  <th className="text-left font-medium px-sm py-sm w-10">
                    <button
                      onClick={toggleSelectAll}
                      disabled={currentPageIds.length === 0}
                      className="inline-flex items-center justify-center w-5 h-5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                      aria-label={allSelected ? '取消全选' : '全选当前页'}
                      aria-checked={allSelected}
                      role="checkbox"
                    >
                      {allSelected ? (
                        <CheckSquare className="w-5 h-5 text-accent" />
                      ) : someSelected ? (
                        <CheckSquare className="w-5 h-5 text-accent/50" />
                      ) : (
                        <Square className="w-5 h-5 text-ink-4" />
                      )}
                    </button>
                  </th>
                  <th className="text-left font-medium px-md py-sm whitespace-nowrap">
                    设备名
                  </th>
                  <th className="text-left font-medium px-md py-sm whitespace-nowrap">
                    房间码
                  </th>
                  <th className="text-left font-medium px-md py-sm whitespace-nowrap">
                    授权状态
                  </th>
                  <th className="text-left font-medium px-md py-sm whitespace-nowrap">
                    在线状态
                  </th>
                  <th className="text-left font-medium px-md py-sm whitespace-nowrap">
                    房间人数
                  </th>
                  <th className="text-left font-medium px-md py-sm whitespace-nowrap">
                    授权类型
                  </th>
                  <th className="text-left font-medium px-md py-sm whitespace-nowrap">
                    过期时间
                  </th>
                  <th className="text-left font-medium px-md py-sm whitespace-nowrap">
                    最后活跃
                  </th>
                  <th className="text-right font-medium px-md py-sm whitespace-nowrap">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => {
                  const status = getStatus(device);
                  const isTemp = device.authorizeType === 'temporary';
                  const isActive = status === 'active';
                  const isSelected = selectedIds.has(device.id);
                  return (
                    <tr
                      key={device.id}
                      className={[
                        'border-t border-border transition-colors',
                        isSelected ? 'bg-accent/5' : 'hover:bg-paper-2',
                      ].join(' ')}
                    >
                      <td className="px-sm py-sm">
                        <button
                          onClick={() => toggleSelect(device.id)}
                          className="inline-flex items-center justify-center w-5 h-5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          aria-label={isSelected ? '取消选择' : '选择该设备'}
                          aria-checked={isSelected}
                          role="checkbox"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-5 h-5 text-accent" />
                          ) : (
                            <Square className="w-5 h-5 text-ink-4 hover:text-ink-3" />
                          )}
                        </button>
                      </td>
                      <td className="px-md py-sm text-ink">
                        <div className="flex items-center gap-sm">
                          <Smartphone className="w-4 h-4 text-ink-3" />
                          <span className="font-medium">
                            {device.deviceName || device.deviceId}
                          </span>
                        </div>
                      </td>
                      <td className="px-md py-sm text-ink-2 font-mono">
                        {device.roomCode || '—'}
                      </td>
                      <td className="px-md py-sm">
                        <Badge variant={statusVariantMap[status]} dot>
                          {statusLabel[status]}
                        </Badge>
                      </td>
                      <td className="px-md py-sm">
                        <Badge variant={device.isOnline ? 'success' : 'neutral'} dot>
                          {device.isOnline ? '在线' : '离线'}
                        </Badge>
                      </td>
                      <td className="px-md py-sm text-ink-2 whitespace-nowrap">
                        {device.memberCount != null
                          ? `${device.memberCount} 人`
                          : '—'}
                      </td>
                      <td className="px-md py-sm">
                        <Badge variant={authorizeTypeVariant(device.authorizeType)}>
                          {authorizeTypeLabel(device.authorizeType)}
                        </Badge>
                      </td>
                      <td className="px-md py-sm text-ink-2 whitespace-nowrap">
                        {formatDateTime(device.authorizeExpiresAt)}
                      </td>
                      <td className="px-md py-sm text-ink-2 whitespace-nowrap">
                        {formatDateTime(device.lastActiveAt)}
                      </td>
                      <td className="px-md py-sm">
                        <div className="flex items-center justify-end gap-xs flex-wrap">
                          {status !== 'active' && (
                            <Button
                              size="sm"
                              variant="secondary"
                              leftIcon={<Shield className="w-3.5 h-3.5" />}
                              onClick={() => openAuthorize(device, 'authorize')}
                            >
                              授权
                            </Button>
                          )}
                          {isActive && isTemp && (
                            <Button
                              size="sm"
                              variant="ghost"
                              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                              onClick={() => openAuthorize(device, 'renew')}
                            >
                              续期
                            </Button>
                          )}
                          {isActive && (
                            <Button
                              size="sm"
                              variant="ghost"
                              leftIcon={<ShieldOff className="w-3.5 h-3.5" />}
                              onClick={() => handleRevoke(device)}
                            >
                              撤销
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            leftIcon={<Pencil className="w-3.5 h-3.5" />}
                            onClick={() => openRename(device)}
                          >
                            重命名
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                            onClick={() => setDeleteModal(device)}
                            className="text-danger hover:text-danger"
                          >
                            删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 分页栏：计数 + 统一分页组件（含每页条数选择） */}
      {!loading && (
        <div className="flex items-center justify-between gap-md mt-md flex-wrap">
          <span className="text-sm text-ink-3">
            第 {page}/{totalPages} 页，共 {total} 条
          </span>
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
            state={loading ? 'loading' : 'default'}
            pageSize={pageSize}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          />
        </div>
      )}

      {/* Authorize / Renew modal（与批量授权 UI 保持一致：永久/临时切换 + 时长选择） */}
      <Modal
        isOpen={!!authModal}
        onClose={() => setAuthModal(null)}
        title={authModal?.mode === 'renew' ? '续期授权' : '设备授权'}
      >
        {authModal && (
          <div className="space-y-md">
            <div className="text-sm text-ink-2 bg-paper-2 border border-border rounded-md px-md py-sm">
              <div className="flex items-center gap-sm">
                <Smartphone className="w-4 h-4 text-ink-3" />
                <span className="font-medium text-ink">
                  {authModal.device.deviceName || authModal.device.deviceId}
                </span>
                <span className="font-mono text-ink-3">
                  · {authModal.device.roomCode}
                </span>
              </div>
            </div>

            {/* 授权类型：永久 / 临时 切换（与批量授权一致） */}
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-xs">
                授权类型
              </label>
              <div className="grid grid-cols-2 gap-xs">
                <button
                  type="button"
                  onClick={() => setAuthAuthorizeType('permanent')}
                  className={[
                    'px-sm py-2 rounded-md text-sm font-medium border transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    authAuthorizeType === 'permanent'
                      ? 'border-accent bg-accent text-paper'
                      : 'border-border bg-paper text-ink-2 hover:bg-paper-2',
                  ].join(' ')}
                >
                  永久授权
                </button>
                <button
                  type="button"
                  onClick={() => setAuthAuthorizeType('temporary')}
                  className={[
                    'px-sm py-2 rounded-md text-sm font-medium border transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    authAuthorizeType === 'temporary'
                      ? 'border-accent bg-accent text-paper'
                      : 'border-border bg-paper text-ink-2 hover:bg-paper-2',
                  ].join(' ')}
                >
                  临时授权
                </button>
              </div>
            </div>

            {authAuthorizeType === 'permanent' ? (
              <p className="text-sm text-ink-2">
                永久授权后不会过期，需要手动撤销。
              </p>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-xs">
                    授权时长
                  </label>
                  <div className="grid grid-cols-2 gap-xs sm:grid-cols-4">
                    {durationPresets.map((preset) => {
                      const active = durationMs === preset.ms;
                      return (
                        <button
                          key={preset.ms}
                          type="button"
                          onClick={() => {
                            setDurationMs(preset.ms);
                            setCustomHours('');
                          }}
                          className={[
                            'px-sm py-2 rounded-md text-sm font-medium border transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                            active
                              ? 'border-accent bg-accent text-paper'
                              : 'border-border bg-paper text-ink-2 hover:bg-paper-2',
                          ].join(' ')}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setDurationMs(-1)}
                      className={[
                        'col-span-2 sm:col-span-1 px-sm py-2 rounded-md text-sm font-medium border transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        durationMs < 0
                          ? 'border-accent bg-accent text-paper'
                          : 'border-border bg-paper text-ink-2 hover:bg-paper-2',
                      ].join(' ')}
                    >
                      自定义
                    </button>
                  </div>
                </div>

                {durationMs < 0 && (
                  <Input
                    label="自定义时长（小时）"
                    type="number"
                    min="1"
                    step="1"
                    value={customHours}
                    onChange={(e) => setCustomHours(e.target.value)}
                    placeholder="例如 12"
                  />
                )}

                {authModal.mode === 'renew' && authModal.device.authorizeExpiresAt && (
                  <p className="text-xs text-ink-3">
                    续期将基于原过期时间（{formatDateTime(authModal.device.authorizeExpiresAt)}）往后延。
                  </p>
                )}
              </>
            )}

            <div className="flex items-center justify-end gap-xs pt-sm">
              <Button
                variant="ghost"
                onClick={() => setAuthModal(null)}
                disabled={authLoading}
              >
                取消
              </Button>
              <Button
                onClick={submitAuthorize}
                loading={authLoading}
                leftIcon={<Check className="w-4 h-4" />}
              >
                确认
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Rename modal */}
      <Modal
        isOpen={!!renameModal}
        onClose={() => setRenameModal(null)}
        title="重命名设备"
      >
        {renameModal && (
          <div className="space-y-md">
            <Input
              label="设备名"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="请输入设备名"
              autoFocus
            />
            <div className="flex items-center justify-end gap-xs pt-sm">
              <Button
                variant="ghost"
                onClick={() => setRenameModal(null)}
                disabled={renameLoading}
              >
                取消
              </Button>
              <Button
                onClick={submitRename}
                loading={renameLoading}
                leftIcon={<Check className="w-4 h-4" />}
              >
                保存
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete confirm modal */}
      <Modal
        isOpen={!!deleteModal}
        onClose={() => setDeleteModal(null)}
        title="删除设备"
      >
        {deleteModal && (
          <div className="space-y-md">
            <div className="text-sm text-ink-2 bg-paper-2 border border-border rounded-md px-md py-sm">
              <div className="flex items-center gap-sm">
                <Smartphone className="w-4 h-4 text-ink-3" />
                <span className="font-medium text-ink">
                  {deleteModal.deviceName || deleteModal.deviceId}
                </span>
                <span className="font-mono text-ink-3">
                  · {deleteModal.roomCode}
                </span>
              </div>
            </div>
            <p className="text-sm text-ink-2">
              删除后设备将解绑，TV 端会重新生成设备信息并出现在待授权列表中。此操作不可撤销。
            </p>
            <div className="flex items-center justify-end gap-xs pt-sm">
              <Button
                variant="ghost"
                onClick={() => setDeleteModal(null)}
                disabled={deleteLoading}
              >
                取消
              </Button>
              <Button
                variant="danger"
                onClick={handleDelete}
                loading={deleteLoading}
                leftIcon={<Trash2 className="w-4 h-4" />}
              >
                确认删除
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* 批量操作确认 modal */}
      <Modal
        isOpen={!!batchModal}
        onClose={() => !batchLoading && setBatchModal(null)}
        title={batchModalTitle}
      >
        {batchModal && (
          <div className="space-y-md">
            <div className="text-sm text-ink-2 bg-paper-2 border border-border rounded-md px-md py-sm">
              <div className="flex items-center gap-sm">
                <CheckSquare className="w-4 h-4 text-accent" />
                <span className="font-medium text-ink">
                  已选中 {batchModal.ids.length} 台设备
                </span>
              </div>
            </div>

            {/* 授权模式：永久 / 临时 切换 + 时长选择（与单行授权 UI 一致） */}
            {batchModal.type === 'authorize' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-xs">
                    授权类型
                  </label>
                  <div className="grid grid-cols-2 gap-xs">
                    <button
                      type="button"
                      onClick={() => setBatchAuthorizeType('permanent')}
                      className={[
                        'px-sm py-2 rounded-md text-sm font-medium border transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        batchAuthorizeType === 'permanent'
                          ? 'border-accent bg-accent text-paper'
                          : 'border-border bg-paper text-ink-2 hover:bg-paper-2',
                      ].join(' ')}
                    >
                      永久授权
                    </button>
                    <button
                      type="button"
                      onClick={() => setBatchAuthorizeType('temporary')}
                      className={[
                        'px-sm py-2 rounded-md text-sm font-medium border transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        batchAuthorizeType === 'temporary'
                          ? 'border-accent bg-accent text-paper'
                          : 'border-border bg-paper text-ink-2 hover:bg-paper-2',
                      ].join(' ')}
                    >
                      临时授权
                    </button>
                  </div>
                </div>

                {batchAuthorizeType === 'permanent' ? (
                  <p className="text-sm text-ink-2">
                    永久授权后不会过期，需要手动撤销。
                  </p>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-ink-2 mb-xs">
                        授权时长
                      </label>
                      <div className="grid grid-cols-2 gap-xs sm:grid-cols-4">
                        {durationPresets.map((preset) => {
                          const active = batchDurationMs === preset.ms;
                          return (
                            <button
                              key={preset.ms}
                              type="button"
                              onClick={() => {
                                setBatchDurationMs(preset.ms);
                                setBatchCustomHours('');
                              }}
                              className={[
                                'px-sm py-2 rounded-md text-sm font-medium border transition-colors',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                                active
                                  ? 'border-accent bg-accent text-paper'
                                  : 'border-border bg-paper text-ink-2 hover:bg-paper-2',
                              ].join(' ')}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => setBatchDurationMs(-1)}
                          className={[
                            'col-span-2 sm:col-span-1 px-sm py-2 rounded-md text-sm font-medium border transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                            batchDurationMs < 0
                              ? 'border-accent bg-accent text-paper'
                              : 'border-border bg-paper text-ink-2 hover:bg-paper-2',
                          ].join(' ')}
                        >
                          自定义
                        </button>
                      </div>
                    </div>

                    {batchDurationMs < 0 && (
                      <Input
                        label="自定义时长（小时）"
                        type="number"
                        min="1"
                        step="1"
                        value={batchCustomHours}
                        onChange={(e) => setBatchCustomHours(e.target.value)}
                        placeholder="例如 12"
                      />
                    )}
                  </>
                )}
              </>
            )}

            {/* 撤销 / 删除 提示文案 */}
            {batchModal.type === 'revoke' && (
              <p className="text-sm text-ink-2">
                将撤销所选设备的授权，TV 端会立即进入未授权状态。
              </p>
            )}
            {batchModal.type === 'delete' && (
              <p className="text-sm text-ink-2">
                将删除所选设备及关联的队列、会话数据。TV 端会重新生成设备信息并出现在待授权列表中。此操作不可撤销。
              </p>
            )}

            <div className="flex items-center justify-end gap-xs pt-sm">
              <Button
                variant="ghost"
                onClick={() => setBatchModal(null)}
                disabled={batchLoading}
              >
                取消
              </Button>
              <Button
                variant={batchModal.type === 'delete' ? 'danger' : 'primary'}
                onClick={submitBatch}
                loading={batchLoading}
                leftIcon={
                  batchLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : batchModal.type === 'authorize' ? (
                    <Shield className="w-4 h-4" />
                  ) : batchModal.type === 'revoke' ? (
                    <ShieldOff className="w-4 h-4" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )
                }
              >
                确认{batchModalTitle.replace('批量', '')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

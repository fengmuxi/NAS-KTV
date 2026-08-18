import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Settings as SettingsIcon,
  Save,
  Bot,
  Mic,
  Search,
  Database,
  HardDrive,
  Tag,
  Smartphone,
  Image as ImageIcon,
  Upload,
  Trash2,
  Download,
  RefreshCw,
  Shield,
  Fingerprint,
  Copy,
} from 'lucide-react';
import { aiParseApi } from '../api/ai-parse';
import { settingsApi } from '../api/settings';
import { backupApi } from '../api/backup';
import type { BackupInfo } from '../api/backup';
import { downloadApi, type PlatformInfo } from '../api/download';
import { systemApi } from '../api/system';
import type { SystemInfo } from '../api/system';
import type { AiParseConfig } from '../types';
import Button from '../components/Button';
import Input from '../components/Input';
import ConfirmModal from '../components/ConfirmModal';
import Loading from '../components/Loading';
import { useToast } from '../components/Toast';
import { SEPARATION_MODELS, type SeparationModel } from '../constants';

interface ScanSettings {
  scanRoot: string;
  autoAiParse: boolean;
  autoSeparation: boolean;
}

interface SeparationSettings {
  model: SeparationModel;
  concurrency: number;
  autoSeparation: boolean;
}

const STORAGE_KEY = 'nasktv:settings';

const defaultScan: ScanSettings = {
  scanRoot: '',
  autoAiParse: false,
  autoSeparation: false,
};

const defaultSeparation: SeparationSettings = {
  model: 'htdemucs',
  concurrency: 1,
  autoSeparation: false,
};

const defaultSystemInfo: SystemInfo = {
  version: '—',
  databasePath: '—',
  storageUsedBytes: 0,
  storageTotalBytes: 0,
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const idx = Math.min(i, units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[idx]}`;
}

function loadLocalSettings(): {
  scan: ScanSettings;
  separation: SeparationSettings;
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { scan: defaultScan, separation: defaultSeparation };
    const parsed = JSON.parse(raw);
    return {
      scan: { ...defaultScan, ...(parsed.scan ?? {}) },
      separation: { ...defaultSeparation, ...(parsed.separation ?? {}) },
    };
  } catch {
    return { scan: defaultScan, separation: defaultSeparation };
  }
}

function saveLocalSettings(data: {
  scan: ScanSettings;
  separation: SeparationSettings;
}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

// 下载默认源勾选：最多同时选中 MAX_DOWNLOAD_SOURCES 个（与下载页一致）
function toggleDownloadSource(
  key: string,
  selected: string[],
  max: number,
  setSelected: (v: string[]) => void,
) {
  if (selected.includes(key)) {
    setSelected(selected.filter((k) => k !== key));
  } else if (selected.length < max) {
    setSelected([...selected, key]);
  }
}

function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-md py-sm">
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink-2">{label}</div>
        {description && (
          <div className="text-xs text-ink-3 mt-0.5">{description}</div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-disabled={disabled}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={[
          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
          checked ? 'bg-accent' : 'bg-paper-3',
          disabled ? 'opacity-40 cursor-not-allowed' : '',
        ].join(' ')}
      >
        <span
          className={[
            'inline-block h-5 w-5 transform rounded-full bg-paper shadow-sm transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          ].join(' ')}
        />
      </button>
    </div>
  );
}

function SettingCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-paper border border-border rounded-lg p-md">
      <div className="flex items-center gap-sm mb-md">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-accent-soft text-accent">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold font-display text-ink">
            {title}
          </h2>
          {description && (
            <p className="text-xs text-ink-3 mt-0.5">{description}</p>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
  mono = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-md py-sm border-b border-border last:border-b-0">
      <div className="flex items-center gap-sm text-sm text-ink-2 min-w-0">
        <span className="text-ink-3 shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div
        className={[
          'text-sm text-ink text-right min-w-0 truncate',
          mono ? 'font-mono' : '',
        ].join(' ')}
      >
        {value}
      </div>
    </div>
  );
}

export default function Settings() {
  const [aiConfig, setAiConfig] = useState<AiParseConfig>({
    baseUrl: '',
    apiKey: '',
    model: '',
    enabled: false,
  });
  const [aiLoading, setAiLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [scan, setScan] = useState<ScanSettings>(defaultScan);
  const [separation, setSeparation] = useState<SeparationSettings>(defaultSeparation);
  const [systemInfo, setSystemInfo] = useState<SystemInfo>(defaultSystemInfo);

  const [h5BaseUrl, setH5BaseUrl] = useState('');
  const [h5Loading, setH5Loading] = useState(true);

  // 去重与并发配置
  const [aiParseConcurrency, setAiParseConcurrency] = useState(1);
  const [md5Dedup, setMd5Dedup] = useState(true);
  const [aiDedup, setAiDedup] = useState(false);

  // 下载配置（音乐源默认选中 + 下载并发）
  const [downloadPlatforms, setDownloadPlatforms] = useState<PlatformInfo[]>([]);
  const [downloadDefaultSources, setDownloadDefaultSources] = useState<string[]>(['qq']);
  const [downloadConcurrency, setDownloadConcurrency] = useState(2);
  // 下载配置最多同时默认选中的平台数（与下载页一致）
  const MAX_DOWNLOAD_SOURCES = 3;

  // 备份管理
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupCreating, setBackupCreating] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: React.ReactNode;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  // 品牌 Logo 维护
  const [logoCustom, setLogoCustom] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoVersion, setLogoVersion] = useState(() => Date.now());
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);

  const { showToast, ToastContainer } = useToast();

  const loadAll = useCallback(async () => {
    const local = loadLocalSettings();
    setScan(local.scan);
    setSeparation(local.separation);

    setAiLoading(true);
    try {
      const data = await aiParseApi.getConfig();
      setAiConfig(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载 AI 配置失败';
      showToast('error', msg);
    } finally {
      setAiLoading(false);
    }

    try {
      const info = await systemApi.getInfo();
      setSystemInfo(info);
    } catch {
      // keep defaults on error
    }

    setH5Loading(true);
    try {
      const allSettings = await settingsApi.getAll();
      const byKey = new Map(allSettings.map(s => [s.key, s.value]));
      const h5 = byKey.get('h5_base_url');
      setH5BaseUrl(h5 ?? '');
      // 品牌 Logo：settings.logo_path 有值 = 已自定义
      setLogoCustom(!!byKey.get('logo_path'));
      // 从后端读取自动开关/分离参数（覆盖 localStorage，保证与后端实际行为一致）
      const autoSeparation = byKey.get('separation_auto_enable');
      const autoAiParse = byKey.get('ai_parse_auto_enable');
      const model = byKey.get('separation_model');
      const concurrency = byKey.get('separation_concurrency');
      if (autoSeparation !== undefined) {
        setScan(s => ({ ...s, autoSeparation: autoSeparation === 'true' }));
        setSeparation(s => ({ ...s, autoSeparation: autoSeparation === 'true' }));
      }
      if (autoAiParse !== undefined) {
        setScan(s => ({ ...s, autoAiParse: autoAiParse === 'true' }));
      }
      if (SEPARATION_MODELS.some(m => m.value === model)) {
        setSeparation(s => ({ ...s, model: model as SeparationModel }));
      }
      if (concurrency !== undefined && !Number.isNaN(Number(concurrency))) {
        setSeparation(s => ({ ...s, concurrency: Number(concurrency) }));
      }
      const aiConcurrency = byKey.get('ai_parse_concurrency');
      if (aiConcurrency !== undefined && !Number.isNaN(Number(aiConcurrency))) {
        setAiParseConcurrency(Number(aiConcurrency));
      }
      const md5 = byKey.get('scan_md5_dedup');
      if (md5 !== undefined) setMd5Dedup(md5 !== 'false');
      const aiD = byKey.get('ai_dedup_enabled');
      if (aiD !== undefined) setAiDedup(aiD === 'true');
    } catch {
      // keep defaults on error
    } finally {
      setH5Loading(false);
    }

    // 加载备份列表
    setBackupLoading(true);
    try {
      const list = await backupApi.list();
      setBackups(list);
    } catch {
      // ignore
    } finally {
      setBackupLoading(false);
    }

    // 加载下载配置（平台列表 + 默认选中源 + 并发数）
    try {
      const cfg = await downloadApi.config();
      setDownloadPlatforms(cfg.platforms);
      if (cfg.defaultSources.length) setDownloadDefaultSources(cfg.defaultSources);
      setDownloadConcurrency(cfg.concurrency);
    } catch {
      // 下载服务不可用时保留默认，不阻断其它设置加载
    }

  }, [showToast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleSave = async () => {
    setSaving(true);
    try {
      saveLocalSettings({ scan, separation });
      await aiParseApi.updateConfig({
        baseUrl: aiConfig.baseUrl,
        apiKey: aiConfig.apiKey,
        model: aiConfig.model,
        enabled: aiConfig.enabled,
      });
      await settingsApi.update([
        { key: 'h5_base_url', value: h5BaseUrl },
        {
          key: 'separation_auto_enable',
          value: String(scan.autoSeparation || separation.autoSeparation),
        },
        { key: 'ai_parse_auto_enable', value: String(scan.autoAiParse) },
        { key: 'separation_model', value: separation.model },
        { key: 'separation_concurrency', value: String(separation.concurrency) },
        { key: 'ai_parse_concurrency', value: String(aiParseConcurrency) },
        { key: 'scan_md5_dedup', value: String(md5Dedup) },
        { key: 'ai_dedup_enabled', value: String(aiDedup) },
        { key: 'downloader_default_sources', value: downloadDefaultSources.join(',') },
        { key: 'downloader_concurrency', value: String(downloadConcurrency) },
      ]);
      showToast('success', '设置已保存');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存设置失败';
      showToast('error', msg);
    } finally {
      setSaving(false);
    }
  };

  // 备份操作
  const handleCreateBackup = async () => {
    setBackupCreating(true);
    try {
      await backupApi.create();
      showToast('success', '备份创建成功');
      const list = await backupApi.list();
      setBackups(list);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '备份创建失败');
    } finally {
      setBackupCreating(false);
    }
  };

  const handleDeleteBackup = (filename: string) => {
    setConfirmDialog({
      title: '确认删除备份',
      message: (
        <>
          确定要删除备份文件{' '}
          <strong className="text-ink">{filename}</strong> 吗？删除后无法恢复。
        </>
      ),
      onConfirm: async () => {
        try {
          await backupApi.remove(filename);
          showToast('success', '备份已删除');
          setBackups(b => b.filter(x => x.filename !== filename));
        } catch {
          showToast('error', '删除失败');
        }
      },
    });
  };

  const handleRestoreBackup = (filename: string) => {
    setConfirmDialog({
      title: '确认恢复备份',
      message: (
        <>
          恢复备份将<span className="text-danger">替换当前数据库</span>，需要重启服务后生效。确定继续？
        </>
      ),
      confirmLabel: '确认恢复',
      danger: true,
      onConfirm: async () => {
        try {
          await backupApi.restore(filename);
          showToast('success', '数据库已恢复，请重启服务');
        } catch {
          showToast('error', '恢复失败');
        }
      },
    });
  };

  const handleDownloadBackup = (filename: string) => {
    const token = localStorage.getItem('token');
    const url = backupApi.download(filename);
    const a = document.createElement('a');
    a.href = url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token || '');
    a.download = filename;
    a.click();
  };

  const storagePct =
    systemInfo.storageTotalBytes > 0
      ? Math.round(
          (systemInfo.storageUsedBytes / systemInfo.storageTotalBytes) * 100
        )
      : 0;

  // 上传新 Logo：即时保存并刷新预览
  const handleUploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLogoUploading(true);
    try {
      await settingsApi.uploadLogo(file);
      setLogoCustom(true);
      setLogoVersion(Date.now());
      showToast('success', 'Logo 已更新');
    } catch {
      showToast('error', '上传 Logo 失败');
    } finally {
      setLogoUploading(false);
    }
  };

  // 恢复默认 Logo
  const handleResetLogo = async () => {
    setLogoUploading(true);
    try {
      await settingsApi.resetLogo();
      setLogoCustom(false);
      setLogoVersion(Date.now());
      showToast('success', '已恢复默认 Logo');
    } catch {
      showToast('error', '恢复默认 Logo 失败');
    } finally {
      setLogoUploading(false);
    }
  };

  return (
    <div className="p-lg">
      <ToastContainer />

      {/* 删除/恢复确认弹窗 */}
      <ConfirmModal
        isOpen={!!confirmDialog}
        title={confirmDialog?.title || '确认操作'}
        message={confirmDialog?.message ?? null}
        confirmLabel={confirmDialog?.confirmLabel}
        danger={confirmDialog?.danger}
        loading={confirmLoading}
        onConfirm={() => {
          const dialog = confirmDialog;
          if (!dialog) return;
          setConfirmLoading(true);
          Promise.resolve(dialog.onConfirm()).finally(() => {
            setConfirmLoading(false);
            setConfirmDialog(null);
          });
        }}
        onCancel={() => setConfirmDialog(null)}
      />
      <div className="flex items-start justify-between mb-md gap-md flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold text-ink mb-xs">
            系统设置
          </h1>
          <p className="text-sm text-ink-3">
            配置扫描、分离、AI 解析等系统级参数
          </p>
        </div>
        <Button
          onClick={handleSave}
          loading={saving}
          leftIcon={<Save className="w-4 h-4" />}
        >
          保存设置
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-md">
        {/* Scan settings */}
        <SettingCard
          icon={<Search className="w-5 h-5" />}
          title="扫描配置"
          description="设置媒体扫描的根目录与自动化行为"
        >
          <div className="space-y-sm">
            <Input
              label="扫描根目录"
              value={scan.scanRoot}
              onChange={(e) =>
                setScan((s) => ({ ...s, scanRoot: e.target.value }))
              }
              placeholder="/media/music"
            />
            <div className="border-t border-border">
              <Toggle
                label="扫描后自动 AI 解析"
                description="扫描完成后对新发现的歌曲自动触发 AI 解析"
                checked={scan.autoAiParse}
                onChange={(v) => setScan((s) => ({ ...s, autoAiParse: v }))}
              />
              <Toggle
                label="扫描后自动人声分离"
                description="扫描完成后对新发现的歌曲自动触发人声分离"
                checked={scan.autoSeparation}
                onChange={(v) =>
                  setScan((s) => ({ ...s, autoSeparation: v }))
                }
              />
            </div>
            <div className="border-t border-border">
              <Toggle
                label="MD5 文件哈希去重"
                description="扫描时通过文件 MD5 哈希检测重复文件，默认开启"
                checked={md5Dedup}
                onChange={setMd5Dedup}
              />
              <Toggle
                label="智能去重（本地脚本）"
                description="基于库内歌曲信息本地比对：同名 + 同歌手 + 同版本视为重复（音频与视频不互判，不调用 AI 接口），默认关闭"
                checked={aiDedup}
                onChange={setAiDedup}
              />
            </div>
          </div>
        </SettingCard>

        {/* Separation settings */}
        <SettingCard
          icon={<Mic className="w-5 h-5" />}
          title="分离配置"
          description="人声分离模型与并发控制"
        >
          <div className="space-y-sm">
            <div className="flex flex-col">
              <label className="block text-sm font-medium text-ink-2 mb-xs">
                分离模型
              </label>
              <select
                value={separation.model}
                onChange={(e) =>
                  setSeparation((s) => ({
                    ...s,
                    model: e.target.value as SeparationSettings['model'],
                  }))
                }
                className={[
                  'w-full rounded-md border border-border bg-paper text-ink text-sm',
                  'px-3 py-2 focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2',
                  'focus-visible:ring-accent',
                ].join(' ')}
              >
                {SEPARATION_MODELS.map(m => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-ink-3 mt-xs">
                {SEPARATION_MODELS.find(m => m.value === separation.model)?.hint}
              </p>
            </div>
            <Input
              label="并发数"
              type="number"
              min="1"
              max="8"
              step="1"
              value={String(separation.concurrency)}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setSeparation((s) => ({
                  ...s,
                  concurrency: Number.isFinite(n) && n > 0 ? n : 1,
                }));
              }}
              hint="同时执行分离任务的最大数量（1-8）"
            />
            <div className="border-t border-border">
              <Toggle
                label="自动人声分离"
                description="新歌曲入库后自动触发人声分离"
                checked={separation.autoSeparation}
                onChange={(v) =>
                  setSeparation((s) => ({ ...s, autoSeparation: v }))
                }
              />
            </div>
          </div>
        </SettingCard>

        {/* AI settings */}
        <SettingCard
          icon={<Bot className="w-5 h-5" />}
          title="AI 配置"
          description="AI 解析服务的连接参数"
        >
          {aiLoading ? (
            <Loading />
          ) : (
            <div className="space-y-sm">
              <Input
                label="Base URL"
                value={aiConfig.baseUrl}
                onChange={(e) =>
                  setAiConfig((c) => ({ ...c, baseUrl: e.target.value }))
                }
                placeholder="https://api.example.com/v1"
              />
              <Input
                label="API Key"
                type="password"
                value={aiConfig.apiKey}
                onChange={(e) =>
                  setAiConfig((c) => ({ ...c, apiKey: e.target.value }))
                }
                placeholder="sk-..."
              />
              <Input
                label="Model"
                value={aiConfig.model}
                onChange={(e) =>
                  setAiConfig((c) => ({ ...c, model: e.target.value }))
                }
                placeholder="gpt-4o-mini"
              />
              <Input
                label="AI 解析并发数"
                type="number"
                min="1"
                max="8"
                step="1"
                value={String(aiParseConcurrency)}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setAiParseConcurrency(Number.isFinite(n) && n > 0 ? n : 1);
                }}
                hint="同时执行 AI 解析任务的最大数量（1-8）"
              />
              <div className="border-t border-border">
                <Toggle
                  label="启用 AI 自动解析"
                  description="开启后扫描阶段会调用 AI 解析歌曲元数据"
                  checked={aiConfig.enabled}
                  onChange={(v) =>
                    setAiConfig((c) => ({ ...c, enabled: v }))
                  }
                />
              </div>
            </div>
          )}
        </SettingCard>

        {/* H5 settings */}
        <SettingCard
          icon={<Smartphone className="w-5 h-5" />}
          title="H5 手机点歌"
          description="配置手机端 H5 点歌页面的访问地址"
        >
          {h5Loading ? (
            <Loading />
          ) : (
            <div className="space-y-sm">
              <Input
                label="H5 Base URL"
                value={h5BaseUrl}
                onChange={(e) => setH5BaseUrl(e.target.value)}
                placeholder="http://192.168.1.100:8080/h5/"
                hint="手机端 H5 页面的基础地址，用于生成房间二维码"
              />
              {h5BaseUrl && (
                <div className="rounded-md bg-paper-2 border border-border p-sm">
                  <div className="text-xs font-medium text-ink-2 mb-1">扫码点歌链接预览</div>
                  <div className="text-sm font-mono text-ink break-all">
                    {h5BaseUrl.replace(/\/+$/, '')}/join?authorizationCode=XXXXXX
                  </div>
                </div>
              )}
            </div>
          )}
        </SettingCard>

        {/* Download settings */}
        <SettingCard
          icon={<Download className="w-5 h-5" />}
          title="下载配置"
          description="歌曲下载默认选中的音乐源与下载并发数"
        >
          <div className="space-y-sm">
            <div className="flex flex-col">
              <span className="block text-sm font-medium text-ink-2 mb-xs">
                默认选中音乐源
              </span>
              {downloadPlatforms.length === 0 ? (
                <p className="text-xs text-ink-3">
                  加载平台列表失败（下载服务不可用），请确认下载服务已启动。
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {downloadPlatforms
                    .filter((p) => p.enabled)
                    .map((p) => {
                      const active = downloadDefaultSources.includes(p.key);
                      const atLimit =
                        downloadDefaultSources.length >= MAX_DOWNLOAD_SOURCES;
                      const disabled = !active && atLimit;
                      return (
                        <button
                          key={p.key}
                          type="button"
                          disabled={disabled}
                          onClick={() =>
                            toggleDownloadSource(
                              p.key,
                              downloadDefaultSources,
                              MAX_DOWNLOAD_SOURCES,
                              setDownloadDefaultSources,
                            )
                          }
                          aria-pressed={active}
                          title={
                            disabled
                              ? `最多同时默认选中 ${MAX_DOWNLOAD_SOURCES} 个音乐平台`
                              : undefined
                          }
                          className={[
                            'inline-flex items-center h-8 px-3 rounded-md text-sm border transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
                            disabled
                              ? 'opacity-40 cursor-not-allowed border-border text-ink-2'
                              : active
                                ? 'border-accent bg-[color-mix(in_oklch,var(--color-accent)_14%,transparent)] text-accent'
                                : 'border-border text-ink-2 hover:bg-paper-2',
                          ].join(' ')}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                </div>
              )}
              <span className="text-xs text-ink-2 mt-xs">
                已默认选中 {downloadDefaultSources.length} / {MAX_DOWNLOAD_SOURCES}
                （下载页打开时自动勾选这些源，最多同时搜索 {MAX_DOWNLOAD_SOURCES} 个）
              </span>
            </div>
            <Input
              label="下载并发数"
              type="number"
              min="1"
              max="8"
              step="1"
              value={String(downloadConcurrency)}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setDownloadConcurrency(Number.isFinite(n) && n > 0 ? n : 1);
              }}
              hint="同时执行下载任务的最大数量（1-8），保存后立即生效"
            />
          </div>
        </SettingCard>

        {/* Brand logo settings */}
        <SettingCard
          icon={<ImageIcon className="w-5 h-5" />}
          title="品牌 Logo"
          description="自定义系统 Logo（网页标签图标与各端页面显示），未设置时使用默认 Logo"
        >
          <div className="flex items-center gap-md">
            <img
              src={`/api/logo?v=${logoVersion}`}
              alt="当前 Logo"
              className="w-16 h-16 rounded-lg border border-border object-cover bg-paper-2 shrink-0"
            />
            <div className="flex flex-col gap-sm">
              <input
                ref={logoFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleUploadLogo}
              />
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<Upload className="w-4 h-4" />}
                loading={logoUploading}
                onClick={() => logoFileInputRef.current?.click()}
              >
                上传新 Logo
              </Button>
              {logoCustom && (
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<Trash2 className="w-4 h-4" />}
                  disabled={logoUploading}
                  onClick={handleResetLogo}
                >
                  恢复默认
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-ink-3 mt-sm">
            支持 PNG / JPG / WebP，建议使用方形图片（不超过 5MB），上传后全端立即生效
          </p>
        </SettingCard>

        {/* Backup management */}
        <SettingCard
          icon={<Database className="w-5 h-5" />}
          title="数据备份"
          description="创建、下载、恢复数据库备份"
        >
          <div className="space-y-sm">
            <Button
              onClick={handleCreateBackup}
              loading={backupCreating}
              leftIcon={<Copy className="w-4 h-4" />}
              size="sm"
            >
              立即备份
            </Button>
            {backupLoading ? (
              <Loading />
            ) : backups.length === 0 ? (
              <p className="text-sm text-ink-3">暂无备份记录</p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {backups.map(b => (
                  <div
                    key={b.filename}
                    className="flex items-center justify-between gap-sm py-1 px-sm rounded border border-border bg-paper-2 text-sm"
                  >
                    <div className="min-w-0 truncate">
                      <span className="text-ink font-mono text-xs">{b.filename}</span>
                      <span className="text-ink-3 ml-2 text-xs">{formatBytes(b.size)}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleDownloadBackup(b.filename)}
                        className="p-1 rounded hover:bg-paper-3 text-ink-2 hover:text-accent transition-colors"
                        title="下载"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRestoreBackup(b.filename)}
                        className="p-1 rounded hover:bg-paper-3 text-ink-2 hover:text-warning transition-colors"
                        title="恢复"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteBackup(b.filename)}
                        className="p-1 rounded hover:bg-paper-3 text-ink-2 hover:text-danger transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SettingCard>

        {/* System info */}
        <SettingCard
          icon={<SettingsIcon className="w-5 h-5" />}
          title="系统信息"
          description="只读的运行环境信息"
        >
          <div className="space-y-0">
            <InfoRow
              icon={<Tag className="w-4 h-4" />}
              label="版本号"
              value={systemInfo.version}
              mono
            />
            <InfoRow
              icon={<Database className="w-4 h-4" />}
              label="数据库路径"
              value={systemInfo.databasePath}
              mono
            />
            <div className="py-sm border-b border-border last:border-b-0">
              <div className="flex items-center gap-sm text-sm text-ink-2 mb-xs">
                <HardDrive className="w-4 h-4 text-ink-3" />
                <span>存储使用</span>
              </div>
              <div
                className="flex items-center gap-sm"
                role="progressbar"
                aria-valuenow={storagePct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="flex-1 h-1.5 bg-paper-3 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent transition-[width] duration-300 ease-out"
                    style={{ width: `${Math.min(100, storagePct)}%` }}
                  />
                </div>
                <span className="font-mono text-xs text-ink-2 whitespace-nowrap">
                  {storagePct}%
                </span>
              </div>
              <div className="text-xs text-ink-3 mt-1 font-mono">
                {formatBytes(systemInfo.storageUsedBytes)} /{' '}
                {formatBytes(systemInfo.storageTotalBytes)}
              </div>
            </div>
          </div>
        </SettingCard>
      </div>

    </div>
  );
}

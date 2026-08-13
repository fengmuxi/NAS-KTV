import { useState, useEffect, useCallback, useRef } from 'react';
import { Cpu, Download, RefreshCw, CheckCircle, XCircle, AlertTriangle, Globe, Save, UploadCloud, Loader2 } from 'lucide-react';
import { separatorApi, type GpuInfo, type InstallStatus } from '../api/separator';
import Button from '../components/Button';
import Loading from '../components/Loading';
import { useToast } from '../components/Toast';

/* Hallmark · page: gpu-manage · genre: modern-minimal · theme: Cobalt
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 */

export default function GpuManage() {
  const { showToast, ToastContainer } = useToast();
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null);
  const [installStatus, setInstallStatus] = useState<InstallStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const [proxy, setProxy] = useState('');
  const [savingProxy, setSavingProxy] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const fetchProxy = useCallback(async () => {
    try {
      const p = await separatorApi.getProxy();
      setProxy(p);
    } catch {
      showToast('error', '获取代理配置失败');
    }
  }, [showToast]);

  const handleSaveProxy = useCallback(async () => {
    setSavingProxy(true);
    try {
      await separatorApi.saveProxy(proxy.trim());
      showToast('success', '代理配置已保存');
    } catch {
      showToast('error', '保存代理配置失败');
    } finally {
      setSavingProxy(false);
    }
  }, [proxy, showToast]);

  const fetchGpuInfo = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const info = await separatorApi.getGpuInfo();
      setGpuInfo(info);
    } catch {
      showToast('error', '获取 GPU 信息失败');
    } finally {
      if (isRefresh) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [showToast]);

  useEffect(() => {
    fetchGpuInfo();
    fetchProxy();
  }, [fetchGpuInfo, fetchProxy]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [installLogs, installStatus?.logs]);

  // 后台安装状态轮询：installing 时每 3s 刷新一次（后台监控安装）
  useEffect(() => {
    let timer: number | undefined;
    const fetchStatus = async () => {
      try {
        const status = await separatorApi.getInstallStatus();
        setInstallStatus(status);
        if (status.state === 'installing') {
          timer = window.setTimeout(fetchStatus, 3000);
        } else if (!status.torch_available && status.state === 'not_installed') {
          timer = window.setTimeout(fetchStatus, 5000);
        }
      } catch {
        timer = window.setTimeout(fetchStatus, 5000);
      }
    };
    fetchStatus();
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const handleUpload = useCallback(async () => {
    if (!uploadFile) return;
    setUploading(true);
    try {
      const res = await separatorApi.uploadInstallFile(uploadFile);
      showToast('success', res.message);
      setUploadFile(null);
      setInstallStatus(await separatorApi.getInstallStatus());
      await fetchGpuInfo(true);
    } catch (err: any) {
      showToast('error', `上传失败: ${err.message}`);
    } finally {
      setUploading(false);
    }
  }, [uploadFile, showToast, fetchGpuInfo]);

  const handleInstall = useCallback(async (type: 'gpu' | 'cpu') => {
    setInstalling(true);
    setInstallLogs([]);
    const label = type === 'gpu' ? 'GPU' : 'CPU';
    try {
      const installer = type === 'gpu' ? separatorApi.installGpu : separatorApi.installCpu;
      await installer((line: string) => {
        setInstallLogs(prev => {
          const isProgress = /^\s+.*\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?\s+(KB|MB|GB)\b/.test(line);
          if (isProgress && prev.length > 0 && /^\s+.*\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?\s+(KB|MB|GB)\b/.test(prev[prev.length - 1])) {
            return [...prev.slice(0, -1), line];
          }
          return [...prev, line];
        });
      });
      showToast('success', `${label} PyTorch 安装完成`);
      await fetchGpuInfo(true);
    } catch (err: any) {
      showToast('error', `安装失败: ${err.message}`);
    } finally {
      setInstalling(false);
    }
  }, [showToast, fetchGpuInfo]);

  if (loading) return <Loading />;

  return (
    <div className="p-lg space-y-lg">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-display text-ink flex items-center gap-2">
          <Cpu className="w-6 h-6" />
          GPU 管理
        </h1>
        <Button
          onClick={() => fetchGpuInfo(true)}
          variant="secondary"
          size="sm"
          loading={refreshing}
          leftIcon={<RefreshCw className="w-4 h-4" />}
        >
          刷新
        </Button>
      </div>

      <div className="grid gap-lg grid-cols-1 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-paper-2 p-lg space-y-md">
          <h2 className="text-lg font-semibold text-ink">硬件信息</h2>
          <div className="space-y-sm">
            <InfoRow label="GPU 状态" value={
              gpuInfo?.available
                ? <span className="flex items-center gap-1 text-success"><CheckCircle className="w-4 h-4" /> 已检测到</span>
                : <span className="flex items-center gap-1 text-ink-2"><XCircle className="w-4 h-4" /> 未检测到</span>
            } />
            {gpuInfo?.name && <InfoRow label="GPU 名称" value={gpuInfo.name} />}
            {gpuInfo?.memory_mb && <InfoRow label="显存" value={`${gpuInfo.memory_mb} MB`} />}
            {gpuInfo?.driver_version && <InfoRow label="驱动版本" value={gpuInfo.driver_version} />}
            {gpuInfo?.driver_cuda_version && <InfoRow label="驱动支持 CUDA" value={gpuInfo.driver_cuda_version} />}
            {gpuInfo && gpuInfo.driver_cuda_version && gpuInfo.torch_cuda_version && !gpuInfo.cuda_available && (
              <div className="flex items-start gap-2 rounded-md p-md text-sm"
                style={{ background: 'color-mix(in oklch, var(--color-warning) 10%, transparent)' }}>
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--color-warning)' }} />
                {cudaVersionNum(gpuInfo.driver_cuda_version) < cudaVersionNum(gpuInfo.torch_cuda_version) ? (
                  <span>
                    驱动支持的 CUDA 版本（{gpuInfo.driver_cuda_version}）低于 PyTorch 所需（{gpuInfo.torch_cuda_version}），
                    CUDA 加速无法启用，请升级 NVIDIA 显卡驱动或重装对应版本 PyTorch。
                  </span>
                ) : (
                  <span>已检测到 NVIDIA GPU，但当前 PyTorch 的 CUDA 仍不可用（需 {gpuInfo.torch_cuda_version}）。</span>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-paper-2 p-lg space-y-md">
          <h2 className="text-lg font-semibold text-ink">PyTorch 状态</h2>
          <div className="space-y-sm">
            <InfoRow label="虚拟环境" value={
              gpuInfo?.venv_exists
                ? <span className="flex items-center gap-1 text-success"><CheckCircle className="w-4 h-4" /> 已创建</span>
                : <span className="flex items-center gap-1 text-danger"><XCircle className="w-4 h-4" /> 未创建</span>
            } />
            <InfoRow label="PyTorch 版本" value={gpuInfo?.torch_version ?? '未安装'} />
            <InfoRow label="CUDA 可用" value={
              gpuInfo?.cuda_available
                ? <span className="flex items-center gap-1 text-success"><CheckCircle className="w-4 h-4" /> 可用</span>
                : <span className="flex items-center gap-1 text-ink-2"><XCircle className="w-4 h-4" /> 不可用</span>
            } />
            {gpuInfo?.torch_cuda_version && <InfoRow label="CUDA 版本" value={gpuInfo.torch_cuda_version} />}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-paper-2 p-lg space-y-md">
        <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
          <Loader2 className="w-5 h-5" />
          后台安装状态
        </h2>
        <p className="text-sm text-ink-2">
          PyTorch/Demucs 由分离服务在后台监控安装，不阻塞服务启动；未就绪时分离接口会返回明确提示。
        </p>
        {installStatus && (
          <div className="space-y-sm">
            <InfoRow label="引擎状态" value={
              <span className={`flex items-center gap-1 ${installStatus.state === 'installed' ? 'text-success' : installStatus.state === 'installing' ? 'text-accent' : installStatus.state === 'failed' ? 'text-danger' : 'text-ink-2'}`}>
                {installStatus.state === 'installed' ? <CheckCircle className="w-4 h-4" /> :
                 installStatus.state === 'installing' ? <Loader2 className="w-4 h-4 animate-spin" /> :
                 installStatus.state === 'failed' ? <XCircle className="w-4 h-4" /> :
                 <AlertTriangle className="w-4 h-4" />}
                {INSTALL_STATE_LABEL[installStatus.state]}
                {installStatus.state === 'installing' && installStatus.target && `（${installStatus.target === 'cuda' ? 'CUDA' : 'CPU'}${installStatus.mode === 'wheel' ? ' · 离线包' : ''}）`}
              </span>
            } />
            <InfoRow label="PyTorch" value={installStatus.torch_available ? (installStatus.torch_version ?? '已安装') : '未安装'} />
            <InfoRow label="Demucs" value={installStatus.demucs_available ? (installStatus.demucs_version ?? '已安装') : '未安装'} />
            {installStatus.state === 'installing' && (
              <div className="space-y-xs">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-2">{INSTALL_STAGE_LABEL[installStatus.stage ?? ''] ?? installStatus.stage ?? '准备中'}</span>
                  <span className="font-mono text-ink">{Math.round(installStatus.progress)}%</span>
                </div>
                <div className="h-2 rounded-full bg-border overflow-hidden" role="progressbar" aria-valuenow={Math.round(installStatus.progress)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-accent transition-all duration-500" style={{ width: `${installStatus.progress}%` }} />
                </div>
              </div>
            )}
            {installStatus.state === 'failed' && installStatus.error && (
              <div className="flex items-start gap-2 rounded-md p-md text-sm"
                style={{ background: 'color-mix(in oklch, var(--color-danger) 10%, transparent)' }}>
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--color-danger)' }} />
                <span className="text-ink">{installStatus.error}</span>
              </div>
            )}
            {installStatus.state !== 'installed' && installStatus.state !== 'installing' && installStatus.reason && (
              <p className="text-sm text-ink-2">{installStatus.reason}</p>
            )}
            {installStatus.state !== 'installed' && installStatus.logs.length > 0 && (
              <div className="rounded-md bg-ink text-paper p-md">
                <pre className="text-xs overflow-auto max-h-40 font-mono whitespace-pre-wrap break-all leading-relaxed">
                  {installStatus.logs.slice(-30).map((line, i) => (
                    <div key={i} className={
                      line.includes('ERROR') ? 'text-danger' :
                      line.includes('uccessfully') || line.includes('完成') ? 'text-success' :
                      'text-paper'
                    }>{line}</div>
                  ))}
                </pre>
              </div>
            )}
          </div>
        )}
        <div className="flex gap-md items-center flex-wrap">
          <input
            type="file"
            accept=".whl"
            disabled={uploading || installing}
            onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
            className="text-sm text-ink-2 file:mr-3 file:rounded-md file:border file:border-border file:bg-paper file:px-3 file:py-1.5 file:text-sm file:text-ink file:cursor-pointer"
          />
          <Button
            onClick={handleUpload}
            disabled={!uploadFile || uploading}
            loading={uploading}
            variant="secondary"
            size="md"
            leftIcon={<UploadCloud className="w-4 h-4" />}
          >
            {uploading ? '上传中...' : '上传离线安装包'}
          </Button>
          <span className="text-xs text-ink-3">
            将 torch/torchaudio 的 .whl 放入 {installStatus?.install_dir ?? '离线包目录'}，引擎未就绪时自动后台安装
          </span>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-paper-2 p-lg space-y-md">
        <h2 className="text-lg font-semibold text-ink">安装操作</h2>
        <p className="text-sm text-ink-2">
          安装 GPU 版 PyTorch 可显著加速人声分离。需要 NVIDIA 显卡和 CUDA 驱动。
          如无 GPU 或安装失败，可使用 CPU 版本。
        </p>
        <div className="flex gap-md flex-wrap">
          <Button
            onClick={() => handleInstall('gpu')}
            disabled={installing}
            variant="primary"
            leftIcon={<Download className="w-4 h-4" />}
          >
            {installing ? '安装中...' : gpuInfo?.torch_version ? '重装 GPU 版 PyTorch' : '安装 GPU 版 PyTorch'}
          </Button>
          <Button
            onClick={() => handleInstall('cpu')}
            disabled={installing}
            variant="secondary"
            leftIcon={<Download className="w-4 h-4" />}
          >
            {installing ? '安装中...' : gpuInfo?.torch_version ? '重装 CPU 版 PyTorch' : '安装 CPU 版 PyTorch'}
          </Button>
        </div>
        {!gpuInfo?.available && (
          <div className="flex items-start gap-2 rounded-md p-md text-sm"
            style={{ background: 'color-mix(in oklch, var(--color-warning) 10%, transparent)' }}>
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--color-warning)' }} />
            <span>未检测到 NVIDIA GPU，安装 GPU 版 PyTorch 后仍无法使用 CUDA 加速。</span>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-paper-2 p-lg space-y-md">
        <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
          <Globe className="w-5 h-5" />
          下载代理
        </h2>
        <p className="text-sm text-ink-2">
          下载 PyTorch 安装包速度慢时可配置 HTTP/HTTPS 代理（如 http://127.0.0.1:7890），安装时自动生效。
        </p>
        <div className="flex gap-md items-center">
          <input
            type="text"
            value={proxy}
            onChange={e => setProxy(e.target.value)}
            placeholder="http://127.0.0.1:7890"
            className="flex-1 max-w-md rounded-md border border-border bg-paper px-3 py-2 text-sm text-ink
              placeholder:text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
              focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          />
          <Button
            onClick={handleSaveProxy}
            loading={savingProxy}
            variant="primary"
            size="md"
            leftIcon={<Save className="w-4 h-4" />}
          >
            保存
          </Button>
        </div>
      </section>

      {installLogs.length > 0 && (
        <section className="rounded-lg border border-border bg-ink text-paper p-lg space-y-sm">
          <h2 className="text-sm font-semibold text-paper flex items-center gap-2">
            <Download className="w-4 h-4" />
            安装日志
            {installing && (
              <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
            )}
          </h2>
          <pre className="text-xs overflow-auto max-h-96 font-mono whitespace-pre-wrap break-all leading-relaxed">
            {installLogs.map((line, i) => (
              <div key={i} className={
                line.includes('ERROR') ? 'text-danger' :
                line.includes('uccessfully') ? 'text-success' :
                'text-paper'
              }>
                {line}
              </div>
            ))}
            <div ref={logEndRef} />
          </pre>
        </section>
      )}

      <ToastContainer />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-ink-2">{label}</span>
      <span className="text-sm font-medium text-ink">{value}</span>
    </div>
  );
}

function cudaVersionNum(v: string): number {
  const m = v.match(/^(\d+)\.(\d+)/);
  return m ? parseFloat(`${m[1]}.${m[2]}`) : 0;
}

const INSTALL_STATE_LABEL: Record<string, string> = {
  installed: '已就绪',
  installing: '后台安装中',
  failed: '安装失败',
  not_installed: '未安装',
};

const INSTALL_STAGE_LABEL: Record<string, string> = {
  preparing: '准备中',
  torch: '安装 PyTorch',
  demucs: '安装 Demucs',
  verifying: '校验运行环境',
  done: '完成',
};

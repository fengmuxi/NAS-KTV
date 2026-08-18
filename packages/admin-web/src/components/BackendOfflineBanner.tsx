import { useEffect, useState } from 'react';
import { ServerOff } from 'lucide-react';
import { subscribeBackendDown } from '../api/connection';

/* Hallmark · component: backend-offline-banner · genre: modern-minimal · theme: Cobalt
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 * contrast: pass
 */

export default function BackendOfflineBanner() {
  const [down, setDown] = useState(false);

  useEffect(() => subscribeBackendDown(setDown), []);

  if (!down) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-paper bg-danger"
    >
      <ServerOff className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>无法连接后端服务，请确认后端已启动且网络可访问</span>
    </div>
  );
}

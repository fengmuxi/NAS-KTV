/* 后端连接状态（模块级轻量 store，无外部依赖）
 * 由 api/client.ts 的拦截器写入，由 UI 组件订阅展示。
 */

type Listener = (down: boolean) => void;

let backendDown = false;
const listeners = new Set<Listener>();

export function isBackendDown(): boolean {
  return backendDown;
}

export function setBackendDown(value: boolean): void {
  if (backendDown === value) return;
  backendDown = value;
  listeners.forEach((l) => l(backendDown));
}

export function subscribeBackendDown(cb: Listener): () => void {
  listeners.add(cb);
  cb(backendDown);
  return () => {
    listeners.delete(cb);
  };
}

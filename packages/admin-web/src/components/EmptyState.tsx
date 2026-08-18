import type { ReactNode } from 'react';

/* Hallmark · component: empty-state · genre: modern-minimal · theme: Cobalt
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 * contrast: pass
 */

interface EmptyStateProps {
  /** 可选图标，置于标题上方 */
  icon?: ReactNode;
  /** 主标题（如「暂无歌曲数据」） */
  title: string;
  /** 可选补充说明 */
  description?: string;
  /** 可选操作区（如「重新搜索」按钮） */
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 px-md py-xl text-center ${className}`}
      role="status"
      aria-live="polite"
    >
      {icon && <div className="text-ink-3 [&>svg]:w-8 [&>svg]:h-8">{icon}</div>}
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {description && <p className="text-sm text-ink-3 max-w-md">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

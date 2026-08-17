import { CSSProperties, ReactNode } from 'react';

/* Hallmark · component: badge · genre: modern-minimal · theme: Cobalt
 * states: default (status display, non-interactive)
 * contrast: pass (AA on paper/ink pairings)
 */

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

const variantStyles: Record<
  BadgeVariant,
  { bg: string; color: string; dot: string }
> = {
  success: {
    bg: 'color-mix(in oklch, var(--color-success) 12%, transparent)',
    color: 'var(--color-success)',
    dot: 'var(--color-success)',
  },
  warning: {
    bg: 'color-mix(in oklch, var(--color-warning) 14%, transparent)',
    color: 'var(--color-warning)',
    dot: 'var(--color-warning)',
  },
  danger: {
    bg: 'color-mix(in oklch, var(--color-danger) 12%, transparent)',
    color: 'var(--color-danger)',
    dot: 'var(--color-danger)',
  },
  info: {
    bg: 'color-mix(in oklch, var(--color-info) 12%, transparent)',
    color: 'var(--color-info)',
    dot: 'var(--color-info)',
  },
  neutral: {
    bg: 'color-mix(in oklch, var(--color-ink) 6%, transparent)',
    color: 'var(--color-ink-2)',
    dot: 'var(--color-ink-3)',
  },
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: 'text-xs px-2 py-0.5 gap-1',
  md: 'text-sm px-2.5 py-1 gap-1.5',
};

export default function Badge({
  variant = 'neutral',
  size = 'sm',
  dot = false,
  children,
  className = '',
}: BadgeProps) {
  const styles = variantStyles[variant];
  return (
    <span
      className={[
        'inline-flex items-center font-medium rounded-sm whitespace-nowrap',
        sizeClasses[size],
        className,
      ].join(' ')}
      style={{ backgroundColor: styles.bg, color: styles.color } as CSSProperties}
    >
      {dot && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: styles.dot }}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

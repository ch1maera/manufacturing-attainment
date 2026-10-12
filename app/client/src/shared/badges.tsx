/**
 * Small pill-style badges reused across the Operations + Steering pages and
 * the home activity feed. If you add a new status, update both the type union
 * in shared/types.ts and the colour map here.
 */
import type { CaStatus, MissStatus } from './types';

export function StatusBadge({ status }: { status: MissStatus }) {
  const styles: Record<MissStatus, string> = {
    open: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]',
    'action assigned':
      'bg-[var(--info-subtle)] text-[var(--info-subtle-foreground)]',
    resolved:
      'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${styles[status]}`}
    >
      {status}
    </span>
  );
}

export function CaStatusBadge({ status }: { status: CaStatus | string | null }) {
  const styles: Record<string, string> = {
    planned: 'bg-muted text-muted-foreground',
    'in progress':
      'bg-[var(--info-subtle)] text-[var(--info-subtle-foreground)]',
    completed:
      'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
  };
  const cls = (status && styles[status]) || 'bg-muted text-muted-foreground';
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${cls}`}
    >
      {status ?? '—'}
    </span>
  );
}

export function ReasonBadge({ reason }: { reason: string | null }) {
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-muted text-muted-foreground">
      {reason ?? '—'}
    </span>
  );
}

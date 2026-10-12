/**
 * Three KPI cards at the top of the Operations page: open / action assigned /
 * resolved with counts + total missed units. Drives the "live update" demo
 * moment — when the agent's bulk assign fires `dataMutated`, each card's
 * `count` is compared to the previous value and only the cards that *moved*
 * pulse a primary ring (see usePulseOnChange).
 */
import { CheckCircle2, ClipboardCheck, AlertTriangle } from 'lucide-react';
import { usePulseOnChange } from '@/lib/usePulseOnChange';
import type { MissStatus, MissesSummary } from '@/shared/types';

export function KpiCards({ summary }: { summary: MissesSummary[] }) {
  const byStatus = new Map<MissStatus, MissesSummary>();
  for (const s of summary) byStatus.set(s.status, s);
  const open = byStatus.get('open');
  const assigned = byStatus.get('action assigned');
  const resolved = byStatus.get('resolved');
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      <Card
        label="Open"
        count={open?.n ?? 0}
        units={open?.total_units ?? 0}
        icon={<AlertTriangle className="size-4" />}
        tone="danger"
      />
      <Card
        label="Action assigned"
        count={assigned?.n ?? 0}
        units={assigned?.total_units ?? 0}
        icon={<ClipboardCheck className="size-4" />}
        tone="info"
      />
      <Card
        label="Resolved"
        count={resolved?.n ?? 0}
        units={resolved?.total_units ?? 0}
        icon={<CheckCircle2 className="size-4" />}
        tone="success"
      />
    </div>
  );
}

function Card({
  label,
  count,
  units,
  icon,
  tone,
}: {
  label: string;
  count: number;
  units: number;
  icon: React.ReactNode;
  tone: 'info' | 'success' | 'danger';
}) {
  const pulse = usePulseOnChange(count);
  const toneClass =
    tone === 'success'
      ? 'text-[var(--success-subtle-foreground)]'
      : tone === 'danger'
        ? 'text-destructive'
        : 'text-foreground';
  const compactUnits = new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(units);
  const fullUnits = units.toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
  return (
    <div
      className={`rounded-xl border border-border bg-card p-3 sm:p-5 transition-shadow ${
        pulse ? 'animate-pulse-ring' : ''
      }`}
    >
      <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs font-semibold uppercase tracking-[0.12em] sm:tracking-[0.15em] text-muted-foreground">
        <span className={toneClass}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 sm:mt-2 flex flex-col sm:flex-row sm:items-baseline gap-0 sm:gap-2">
        <div className="display text-2xl sm:text-3xl font-semibold text-foreground">
          {count.toLocaleString()}
        </div>
        <div className="text-xs sm:text-sm text-muted-foreground">
          <span className="sm:hidden">{compactUnits} units</span>
          <span className="hidden sm:inline">· {fullUnits} units</span>
        </div>
      </div>
    </div>
  );
}

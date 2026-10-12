/**
 * The filterable miss backlog table. Status filter chips + search + plant /
 * reason chips + sort. Click a row → opens the detail drawer. Rows whose
 * status changed between dataMutated refetches pulse a soft primary highlight
 * (1.5s) so the user's eye lands on what the agent just flipped
 * (open → action assigned).
 */
import { useState } from 'react';
import { Search, Tags } from 'lucide-react';
import { usePulseOnChange } from '@/lib/usePulseOnChange';
import type { MissRow, MissStatus } from '@/shared/types';
import { StatusBadge, ReasonBadge } from '@/shared/badges';
import { ReasonCodeManager } from './ReasonCodeManager';

const STATUS_TABS: { value: MissStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'action assigned', label: 'Action assigned' },
  { value: 'resolved', label: 'Resolved' },
];

function SortHeader({
  label,
  active,
  onClick,
  align = 'left',
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  align?: 'left' | 'right';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 ${
        align === 'right' ? 'flex-row-reverse' : ''
      } ${
        active
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      } transition-colors cursor-pointer`}
    >
      {label}
      <span className="text-[10px]" aria-hidden>
        {active ? '↓' : '↕'}
      </span>
    </button>
  );
}

type SortKey = 'units' | 'recent';

type Props = {
  rows: MissRow[];
  loading: boolean;
  error: string | null;
  statusFilter: MissStatus | 'all';
  onStatusFilter: (s: MissStatus | 'all') => void;
  search: string;
  onSearch: (s: string) => void;
  plantFilter: string;
  onPlantFilter: (p: string) => void;
  reasonFilter: string | null;
  onReasonFilter: (r: string | null) => void;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  onSelect: (id: string) => void;
};

export function MissTable({
  rows,
  loading,
  error,
  statusFilter,
  onStatusFilter,
  search,
  onSearch,
  plantFilter,
  onPlantFilter,
  reasonFilter,
  onReasonFilter,
  sort,
  onSortChange,
  onSelect,
}: Props) {
  const [codesOpen, setCodesOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Status filter"
          className="relative inline-flex rounded-full border border-border bg-card p-0.5 text-sm"
        >
          {STATUS_TABS.map((s) => {
            const active = statusFilter === s.value;
            return (
              <button
                key={s.value}
                onClick={() => onStatusFilter(s.value)}
                aria-pressed={active}
                className={`relative z-10 rounded-full px-3 py-1 transition-colors duration-200 ${
                  active
                    ? 'text-background'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {active && (
                  <span
                    className="absolute inset-0 rounded-full bg-foreground transition-all"
                    aria-hidden
                  />
                )}
                <span className="relative">{s.label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm flex-1 sm:flex-initial min-w-[180px]">
          <Search className="size-3.5 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search plant, SKU, line, PO, reason…"
            className="bg-transparent outline-none w-full sm:w-60 placeholder:text-muted-foreground"
          />
        </div>
        {plantFilter && (
          <button
            onClick={() => onPlantFilter('')}
            className="text-xs rounded-full px-2 py-1 bg-muted text-foreground"
          >
            Plant: {plantFilter} ✕
          </button>
        )}
        {reasonFilter && (
          <button
            onClick={() => onReasonFilter(null)}
            className="text-xs rounded-full px-2 py-1 bg-muted text-foreground"
          >
            Reason: {reasonFilter} ✕
          </button>
        )}
        <button
          onClick={() => setCodesOpen(true)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          <Tags className="size-3.5" />
          Manage codes
        </button>
      </div>

      <ReasonCodeManager open={codesOpen} onOpenChange={setCodesOpen} />

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="relative rounded-xl border border-border bg-card overflow-hidden">
        {loading && (
          <div
            className="absolute inset-x-0 top-0 h-0.5 z-10 overflow-hidden"
            aria-hidden
          >
            <div
              className="h-full w-1/3 rounded-full"
              style={{
                background: 'var(--primary)',
                animation: 'loadingBar 1.1s ease-in-out infinite',
              }}
            />
          </div>
        )}
        {/* Phone: card list */}
        <ul
          className={`sm:hidden divide-y divide-border transition-opacity duration-150 ${
            loading && rows.length > 0 ? 'opacity-70' : 'opacity-100'
          }`}
        >
          {loading && rows.length === 0 && (
            <li className="px-4 py-6 text-center text-muted-foreground text-sm">
              Loading…
            </li>
          )}
          {!loading && rows.length === 0 && (
            <li className="px-4 py-8 text-center text-muted-foreground text-sm">
              No misses match the current filters.
            </li>
          )}
          {rows.map((r) => (
            <MobileCard
              key={r.id}
              row={r}
              onSelect={onSelect}
              onPlantFilter={onPlantFilter}
            />
          ))}
        </ul>

        {/* Tablet + desktop: full table */}
        <div
          className={`hidden sm:block transition-opacity duration-150 overflow-x-auto ${
            loading && rows.length > 0 ? 'opacity-70' : 'opacity-100'
          }`}
        >
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Plant</th>
                <th className="text-left px-4 py-2 font-semibold">SKU</th>
                <th className="text-left px-4 py-2 font-semibold">Line / PO</th>
                <th className="text-left px-4 py-2 font-semibold">Reason</th>
                <th className="text-right px-4 py-2 font-semibold">
                  <SortHeader
                    label="Miss units"
                    align="right"
                    active={sort === 'units'}
                    onClick={() =>
                      onSortChange(sort === 'units' ? 'recent' : 'units')
                    }
                  />
                </th>
                <th className="text-left px-4 py-2 font-semibold">Owner</th>
                <th className="text-left px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No misses match the current filters.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <Row
                  key={r.id}
                  row={r}
                  onSelect={onSelect}
                  onPlantFilter={onPlantFilter}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Row({
  row: r,
  onSelect,
  onPlantFilter,
}: {
  row: MissRow;
  onSelect: (id: string) => void;
  onPlantFilter: (p: string) => void;
}) {
  const statusPulse = usePulseOnChange(r.status);
  const resolved = r.status === 'resolved';
  return (
    <tr
      onClick={() => onSelect(r.id)}
      className={`cursor-pointer border-t border-border hover:bg-muted/50 transition-colors ${
        statusPulse ? 'animate-pulse-row' : ''
      } ${resolved ? 'opacity-60 hover:opacity-100' : ''}`}
    >
      <td className="px-4 py-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlantFilter(r.plantId ?? '');
          }}
          className="font-medium text-left hover:text-primary"
        >
          {r.plantName ?? '—'}
        </button>
        <div className="text-xs text-muted-foreground">
          {r.plantId ?? ''}
          {r.region ? ` · ${r.region}` : ''}
        </div>
      </td>
      <td className="px-4 py-2">
        <div className="font-medium">{r.skuName ?? '—'}</div>
        <div className="text-xs text-muted-foreground">{r.category ?? ''}</div>
      </td>
      <td className="px-4 py-2">
        <div className="whitespace-nowrap">{r.lineName ?? '—'}</div>
        <div className="text-xs text-muted-foreground font-mono">
          {r.productionOrder ?? ''}
        </div>
      </td>
      <td className="px-4 py-2">
        <ReasonBadge reason={r.reasonCode} />
      </td>
      <td className="px-4 py-2 text-right font-mono tabular-nums">
        {r.missUnits !== null ? r.missUnits.toLocaleString() : '—'}
      </td>
      <td className="px-4 py-2 text-muted-foreground text-xs">
        {r.correctiveActionOwner ?? '—'}
        {resolved && r.resolvedBy ? (
          <div className="text-[11px]">closed by {r.resolvedBy}</div>
        ) : r.correctiveActionImplDate ? (
          <div className="text-[11px]">{r.correctiveActionImplDate}</div>
        ) : null}
      </td>
      <td className="px-4 py-2">
        <StatusBadge status={r.status} />
      </td>
    </tr>
  );
}

function MobileCard({
  row: r,
  onSelect,
  onPlantFilter,
}: {
  row: MissRow;
  onSelect: (id: string) => void;
  onPlantFilter: (p: string) => void;
}) {
  const statusPulse = usePulseOnChange(r.status);
  return (
    <li
      onClick={() => onSelect(r.id)}
      className={`px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors ${
        statusPulse ? 'animate-pulse-row' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlantFilter(r.plantId ?? '');
            }}
            className="font-medium text-sm truncate text-left"
          >
            {r.plantName ?? '—'}
          </button>
          <div className="text-xs text-muted-foreground truncate">
            {r.skuName ?? ''} {r.category ? `· ${r.category}` : ''}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge status={r.status} />
          <span className="font-mono text-xs text-foreground tabular-nums">
            {r.missUnits !== null ? r.missUnits.toLocaleString() : '—'}
          </span>
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
        <ReasonBadge reason={r.reasonCode} />
        {r.lineName && <span>{r.lineName}</span>}
        {r.productionOrder && (
          <span className="font-mono">{r.productionOrder}</span>
        )}
        {r.correctiveActionOwner && <span>· {r.correctiveActionOwner}</span>}
      </div>
    </li>
  );
}

/**
 * The Operations page — the WRITE SURFACE for the use case.
 *
 * Renders the open-miss backlog queue from Lakebase (live, writable,
 * transactional) plus a US plant map. Stays in sync with the agent's actions
 * via the `dataMutated` pub/sub: when a chat turn completes (e.g. the agent's
 * bulk corrective-action assign), the queue + map + KPIs refetch, so you
 * literally WATCH the agent's writes land here.
 *
 *   KpiCards   — open / action assigned / resolved at a glance
 *   PlantMap   — open misses per plant (bubbles drop when assigned)
 *   MissTable  — filterable queue, click a row to open the drawer
 *   MissDrawer — slide-over with Miss + Activity tabs
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Sparkles, ArrowRight } from 'lucide-react';
import { fetchMisses, fetchMissesSummary } from '@/lib/returns';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import type {
  MissRow,
  MissStatus,
  MissesSummary,
  ReasonCode,
} from '@/shared/types';

import { PlantMap } from './PlantMap';
import { KpiCards } from './KpiCards';
import { MissTable } from './MissTable';
import { MissDrawer } from './MissDrawer';
import { IngestionFlow } from '@/architecture/IngestionFlow';

export function OperationsView() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [filter, setFilter] = useState<MissStatus | 'all'>('open');
  const [plantFilter, setPlantFilter] = useState(
    searchParams.get('plant') ?? '',
  );
  const [reasonFilter, setReasonFilter] = useState<string | null>(
    searchParams.get('reason') ?? null,
  );
  const [sort, setSort] = useState<'units' | 'recent'>(
    (searchParams.get('sort') as 'units' | 'recent') ?? 'recent',
  );
  const [search, setSearch] = useState('');

  // Sync queue filters → URL so deep links + back/forward work.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const setOrDelete = (key: string, value: string | null) => {
      if (value) next.set(key, value);
      else next.delete(key);
    };
    setOrDelete('plant', plantFilter || null);
    setOrDelete('reason', reasonFilter);
    setOrDelete('sort', sort === 'recent' ? null : sort);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantFilter, reasonFilter, sort]);

  useEffect(() => {
    const urlPlant = searchParams.get('plant') ?? '';
    if (urlPlant !== plantFilter) setPlantFilter(urlPlant);
    const urlReason = searchParams.get('reason');
    if (urlReason !== reasonFilter) setReasonFilter(urlReason);
    const urlSort = (searchParams.get('sort') as 'units' | null) ?? 'recent';
    if (urlSort !== sort) setSort(urlSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const [rows, setRows] = useState<MissRow[]>([]);
  const [summary, setSummary] = useState<MissesSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { config } = useSession();

  async function reload() {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        fetchMisses({
          status: filter === 'all' ? undefined : filter,
          plant: plantFilter || undefined,
          reason: (reasonFilter as ReasonCode | null) ?? undefined,
          sort,
        }),
        fetchMissesSummary(),
      ]);
      setRows(list);
      setSummary(sum);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, plantFilter, reasonFilter, sort]);

  useEffect(() => {
    return dataMutated.subscribe(() => {
      void reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, plantFilter, reasonFilter, sort]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.plantName ?? '').toLowerCase().includes(q) ||
        (r.skuName ?? '').toLowerCase().includes(q) ||
        (r.reasonCode ?? '').toLowerCase().includes(q) ||
        (r.category ?? '').toLowerCase().includes(q) ||
        (r.lineName ?? '').toLowerCase().includes(q) ||
        (r.productionOrder ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-6 sm:space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4 lg:items-end">
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
                Attainment — operations queue
              </div>
              <h1 className="display text-4xl font-semibold tracking-tight text-foreground mb-2">
                Work the open-miss backlog.
              </h1>
            </div>
            <p className="text-muted-foreground max-w-2xl">
              Each row is an attainment miss waiting on a corrective action.
              Correct the reason code, assign an owner and target date, or let
              the assistant draft actions for a whole plant at once.
            </p>
            {config?.assistantScript?.[0] && (
              <button
                onClick={() =>
                  dockController.openAndSend(config.assistantScript[0].prompt)
                }
                className="w-full text-left rounded-xl border border-border bg-card hover:border-foreground/30 hover:shadow-sm px-5 py-4 transition-all flex items-center gap-4 group"
              >
                <div
                  className="size-10 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: 'var(--primary)',
                    color: 'var(--primary-foreground)',
                  }}
                >
                  <Sparkles className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    Something feels off
                  </div>
                  <div className="text-sm font-medium text-foreground mt-0.5">
                    Ask the assistant why attainment dropped
                  </div>
                </div>
                <ArrowRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
              </button>
            )}
          </div>
          <IngestionFlow />
        </div>

        <KpiCards summary={summary} />

        <PlantMap />

        <MissTable
          rows={filteredRows}
          loading={loading}
          error={error}
          statusFilter={filter}
          onStatusFilter={setFilter}
          search={search}
          onSearch={setSearch}
          plantFilter={plantFilter}
          onPlantFilter={setPlantFilter}
          reasonFilter={reasonFilter}
          onReasonFilter={setReasonFilter}
          sort={sort}
          onSortChange={setSort}
          onSelect={setSelectedId}
        />
      </div>

      <MissDrawer
        id={selectedId}
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onMutated={() => {
          void reload();
        }}
      />
    </div>
  );
}

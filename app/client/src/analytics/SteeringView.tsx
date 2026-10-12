/**
 * Steering committee — the corrective-action tracker.
 *
 * The tracker table UNIONs the pre-seeded Delta history
 * (gold_corrective_actions) with the LIVE actions the agent + operators just
 * recorded in Lakebase (fetched via /api/corrective-actions, merged
 * server-side). When the agent's bulk assign fires `dataMutated`, this table
 * refetches and the new live rows appear at the top — the visible cascade.
 *
 * The YoY attainment chart (warehouse-backed) frames the committee's context.
 */
import { useEffect, useMemo, useState } from 'react';
import { LineChart } from '@databricks/appkit-ui/react';
import { fetchCorrectiveActions } from '@/lib/returns';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { BRAND_PALETTE } from '@/lib/brand';
import { dataMutated } from '@/lib/events';
import { RtPitch } from '@/architecture/RtPitch';
import { CaStatusBadge, ReasonBadge } from '@/shared/badges';
import type { CorrectiveActionRow } from '@/shared/types';
import { ChartCard, ChartData } from './chartData';

export function SteeringView() {
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [rows, setRows] = useState<CorrectiveActionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWarehouse().then(setWarehouse).catch(console.error);
  }, []);

  useEffect(() => {
    let cancelled = false;
    function reload() {
      fetchCorrectiveActions(500)
        .then((r) => {
          if (cancelled) return;
          setRows(r);
          setError(null);
        })
        .catch((e) => !cancelled && setError((e as Error).message))
        .finally(() => !cancelled && setLoading(false));
    }
    reload();
    const unsub = dataMutated.subscribe(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const liveCount = useMemo(
    () => rows.filter((r) => r.source === 'live').length,
    [rows],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-6 sm:space-y-10">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Steering committee
          </div>
          <h1 className="display text-4xl font-semibold tracking-tight text-foreground mb-2">
            What are we doing about it?
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            The corrective-action tracker merges the committee's history with
            the live actions the assistant just assigned. Approve a batch in the
            assistant and watch new rows land here.
          </p>
        </div>

        <RtPitch
          warehouse={
            warehouse?.name
              ? { name: warehouse.name, state: warehouse.state ?? null }
              : null
          }
          latencyMs={null}
        />

        <ChartCard title="Attainment — this year vs. prior year" scope="By ISO week">
          <ChartData chartKey="attainment_yoy" height={280}>
            {(chartRows) => (
              <LineChart
                data={chartRows.map((r) => ({
                  iso_week: r.iso_week,
                  attainment_pct: Number(r.attainment_pct) * 100,
                }))}
                xKey="iso_week"
                yKey="attainment_pct"
                colors={[BRAND_PALETTE[0]]}
                height={280}
                smooth
              />
            )}
          </ChartData>
        </ChartCard>

        <ChartCard
          title="Corrective-action tracker"
          scope={`${rows.length} actions · ${liveCount} live`}
          flush
        >
          {error && (
            <div className="px-4 py-3 text-sm text-destructive">{error}</div>
          )}
          {loading && rows.length === 0 && (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">
              Loading…
            </div>
          )}
          {!loading && rows.length === 0 && (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">
              No corrective actions yet.
            </div>
          )}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Plant</th>
                    <th className="text-left font-medium px-3 py-2">Reason</th>
                    <th className="text-left font-medium px-3 py-2">Action</th>
                    <th className="text-left font-medium px-3 py-2">Owner</th>
                    <th className="text-left font-medium px-3 py-2">Target</th>
                    <th className="text-left font-medium px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr
                      key={r.action_id}
                      className={`hover:bg-muted/40 ${
                        r.source === 'live' ? 'bg-primary/5' : ''
                      }`}
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="font-medium">{r.plant_name ?? '—'}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {r.plant_id ?? ''}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <ReasonBadge reason={r.reason_code} />
                      </td>
                      <td className="px-3 py-2 max-w-[22rem]">
                        <div className="truncate">{r.action_desc ?? '—'}</div>
                        {r.source === 'live' && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                            live
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {r.owner ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap tabular-nums">
                        {r.implementation_date ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        <CaStatusBadge status={r.ca_status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

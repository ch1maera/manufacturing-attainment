/**
 * Miss Pareto — where the production misses are coming from.
 *
 * Live warehouse queries: miss count by reason code (Pareto, Mechanical
 * Downtime #1 / Material Shortage #2), misses by plant, and the daily miss
 * trend showing the ~3x spike two weeks ago.
 */
import { useEffect, useState } from 'react';
import { BarChart, LineChart } from '@databricks/appkit-ui/react';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { BRAND_PALETTE } from '@/lib/brand';
import { RtPitch } from '@/architecture/RtPitch';
import { ChartCard, ChartData, useChartData } from './chartData';

export function ParetoView() {
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);

  useEffect(() => {
    fetchWarehouse().then(setWarehouse).catch(console.error);
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-6 sm:space-y-10">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Miss analysis
          </div>
          <h1 className="display text-4xl font-semibold tracking-tight text-foreground mb-2">
            What's driving the misses?
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Pareto of attainment misses by reason code, by plant, and over
            time. Mechanical Downtime is the tall bar; the daily trend shows the
            spike about two weeks ago.
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

        <ChartCard title="Miss Pareto by reason code" scope="Last 30 days" flush>
          <ParetoTable />
        </ChartCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Misses by plant" scope="Last 14 days">
            <ChartData chartKey="misses_by_plant" height={280}>
              {(rows) => (
                <BarChart
                  data={rows.map((r) => ({
                    plant_name: r.plant_name,
                    miss_count: Number(r.miss_count),
                  }))}
                  xKey="plant_name"
                  yKey="miss_count"
                  colors={[BRAND_PALETTE[4]]}
                  height={280}
                />
              )}
            </ChartData>
          </ChartCard>

          <ChartCard title="Daily miss count" scope="Last 60 days">
            <ChartData chartKey="miss_trend" height={280}>
              {(rows) => (
                <LineChart
                  data={rows.map((r) => ({
                    miss_date: r.miss_date,
                    miss_count: Number(r.miss_count),
                  }))}
                  xKey="miss_date"
                  yKey="miss_count"
                  colors={[BRAND_PALETTE[0]]}
                  height={280}
                  smooth
                />
              )}
            </ChartData>
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

type ParetoRow = {
  reason_code: string;
  miss_count: number;
  miss_units: number;
  cumulative_pct: number;
};

function ParetoTable() {
  const { data, error, isLoading } = useChartData<ParetoRow>('miss_pareto');
  if (error)
    return <div className="px-4 py-3 text-sm text-destructive">{error}</div>;
  if (isLoading || !data)
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground text-center">
        Loading…
      </div>
    );
  if (data.length === 0)
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground text-center">
        No data.
      </div>
    );
  const max = Math.max(1, ...data.map((r) => Number(r.miss_count)));
  return (
    <div className="divide-y divide-border">
      {data.map((row) => {
        const count = Number(row.miss_count);
        const pct = (count / max) * 100;
        return (
          <div key={row.reason_code} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{row.reason_code}</span>
              <span className="text-muted-foreground tabular-nums">
                {count.toLocaleString()} misses ·{' '}
                {Number(row.miss_units).toLocaleString()} units ·{' '}
                {Number(row.cumulative_pct).toFixed(0)}% cum.
              </span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, background: 'var(--primary)' }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

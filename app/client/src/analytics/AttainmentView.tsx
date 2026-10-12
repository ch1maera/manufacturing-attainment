/**
 * Attainment — warehouse-backed trend + breakdowns.
 *
 * Live SQL-warehouse queries against Delta gold. Company attainment trend
 * (the ~2-week dip is visible), attainment by plant (Plano/Tulsa/Fresno at
 * the bottom), and attainment by SKU category.
 */
import { useEffect, useState } from 'react';
import { BarChart, LineChart } from '@databricks/appkit-ui/react';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { BRAND_PALETTE } from '@/lib/brand';
import { RtPitch } from '@/architecture/RtPitch';
import { ChartCard, ChartData, useChartData } from './chartData';

export function AttainmentView() {
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);

  useEffect(() => {
    fetchWarehouse().then(setWarehouse).catch(console.error);
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-6 sm:space-y-10">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Plant attainment
          </div>
          <h1 className="display text-4xl font-semibold tracking-tight text-foreground mb-2">
            Are we making what we planned?
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Live queries against the SQL warehouse — the same numbers the
            assistant reasons about. Attainment = actual units ÷ planned units.
            Watch the company trend dip about two weeks ago.
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

        <ChartCard title="Company attainment %" scope="Last 90 days">
          <ChartData chartKey="company_attainment_trend" height={280}>
            {(rows) => (
              <LineChart
                data={rows.map((r) => ({
                  plan_date: r.plan_date,
                  attainment_pct: Number(r.attainment_pct) * 100,
                }))}
                xKey="plan_date"
                yKey="attainment_pct"
                colors={[BRAND_PALETTE[0]]}
                height={280}
                smooth
              />
            )}
          </ChartData>
        </ChartCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Attainment by plant" scope="Last 14 days" flush>
            <PlantAttainmentTable />
          </ChartCard>

          <ChartCard title="Attainment by SKU category" scope="Last 30 days">
            <ChartData chartKey="attainment_by_sku_category" height={280}>
              {(rows) => (
                <BarChart
                  data={rows.map((r) => ({
                    category: r.category,
                    attainment_pct: Number(r.attainment_pct) * 100,
                  }))}
                  xKey="category"
                  yKey="attainment_pct"
                  colors={[BRAND_PALETTE[1]]}
                  height={280}
                />
              )}
            </ChartData>
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

type PlantAttainmentRow = {
  plant_name: string;
  plant_id: string;
  region: string | null;
  attainment_pct: number;
};

function PlantAttainmentTable() {
  const { data, error, isLoading } =
    useChartData<PlantAttainmentRow>('attainment_by_plant');
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
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
          <tr className="border-b border-border">
            <th className="text-left font-medium px-3 py-2">Plant</th>
            <th className="text-left font-medium px-3 py-2">Region</th>
            <th className="text-right font-medium px-3 py-2">Attainment</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.map((row) => {
            const pct = Number(row.attainment_pct) * 100;
            const tone =
              pct < 88
                ? 'text-[var(--severity-danger)]'
                : pct < 95
                  ? 'text-[var(--severity-warning)]'
                  : 'text-foreground';
            return (
              <tr key={row.plant_id} className="hover:bg-muted/40">
                <td className="px-3 py-2">
                  {row.plant_name}
                  <span className="text-muted-foreground font-mono text-xs">
                    {' '}
                    · {row.plant_id}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {row.region ?? '—'}
                </td>
                <td className={`px-3 py-2 text-right font-semibold ${tone}`}>
                  {pct.toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

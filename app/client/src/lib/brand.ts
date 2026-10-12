/**
 * Brand palette — TS mirror of the 5 brand stops defined in index.css
 * (--brand-1 .. --brand-5).
 *
 * Used where consumers (third-party charting libs like ECharts/appkit
 * BarChart, Recharts) need actual hex strings — they can't resolve
 * CSS variables. Anywhere CSS works, prefer `var(--brand-N)` directly.
 *
 * Keep in sync with index.css. There is no single source of truth that
 * both sides can read; this is the seam. If you change one, change the
 * other.
 */
export const BRAND_PALETTE = [
  '#0033A0', // brand-1 — primary navy
  '#2A5CD7', // brand-2 — mid blue
  '#8FB4F5', // brand-3 — sky blue
  '#FFC72C', // brand-4 — accent gold
  '#E31837', // brand-5 — accent red
] as const;

/**
 * Non-palette hexes that the same third-party-library constraint applies to.
 * `--brand-ink` is the body/heading colour and `--destructive` the danger fill;
 * both are needed by Leaflet's `pathOptions` and chart label configs, which
 * take plain strings.
 */
export const BRAND_INK = '#0B1B3A';
export const BRAND_DANGER = '#D64545';

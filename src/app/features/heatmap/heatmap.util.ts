import { HeatmapBucketId, HeatmapCompany, HeatmapSortMode, HeatmapTableCol, HeatmapTrendId } from './heatmap.models';

export function sortTiles(rows: HeatmapCompany[], mode: HeatmapSortMode): HeatmapCompany[] {
  const copy = [...rows];
  if (mode === 'gains') {
    copy.sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity) || a.mcapRank - b.mcapRank);
  } else {
    copy.sort((a, b) => a.mcapRank - b.mcapRank || a.symbol.localeCompare(b.symbol));
  }
  return copy;
}

export function filterTiles(
  rows: HeatmapCompany[],
  bucket: HeatmapBucketId | null,
  trend: HeatmapTrendId | null,
): HeatmapCompany[] {
  return rows.filter((row) => {
    if (bucket && row.bucket !== bucket) return false;
    if (trend && row.trend !== trend) return false;
    return true;
  });
}

export function sortTable(
  rows: HeatmapCompany[],
  col: HeatmapTableCol,
  dir: 'asc' | 'desc',
): HeatmapCompany[] {
  const sign = dir === 'asc' ? 1 : -1;
  const copy = [...rows];
  copy.sort((a, b) => {
    const av = valueFor(a, col);
    const bv = valueFor(b, col);
    if (typeof av === 'string' || typeof bv === 'string') {
      return sign * String(av).localeCompare(String(bv));
    }
    const an = av as number;
    const bn = bv as number;
    if (!Number.isFinite(an) && !Number.isFinite(bn)) return 0;
    if (!Number.isFinite(an)) return 1;
    if (!Number.isFinite(bn)) return -1;
    return sign * (an - bn);
  });
  return copy;
}

function valueFor(row: HeatmapCompany, col: HeatmapTableCol): string | number {
  if (col === 'symbol') return row.symbol;
  if (col === 'trend') return row.trend;
  if (col === 'ltp') return row.ltp ?? Number.NaN;
  if (col === 'changePct') return row.changePct ?? Number.NaN;
  if (col === 'high52') return row.high52 ?? Number.NaN;
  return row.low52 ?? Number.NaN;
}

export function strongTrends(rows: HeatmapCompany[]): { up: HeatmapCompany[]; down: HeatmapCompany[] } {
  return {
    up: rows.filter((r) => r.trend === 'strong-up').sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    down: rows.filter((r) => r.trend === 'strong-down').sort((a, b) => (a.score ?? 0) - (b.score ?? 0)),
  };
}

export function formatIstTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

export function formatPx(n: number | null | undefined): string {
  if (!Number.isFinite(n as number)) return '—';
  return (n as number).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPct(n: number | null | undefined, signed = true): string {
  if (!Number.isFinite(n as number)) return '—';
  const v = n as number;
  const body = Math.abs(v).toFixed(2);
  if (!signed) return `${body}%`;
  if (v > 0) return `+${body}%`;
  if (v < 0) return `-${body}%`;
  return `${body}%`;
}

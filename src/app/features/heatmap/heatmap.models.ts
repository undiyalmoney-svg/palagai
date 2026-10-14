export type HeatmapBucketId = 'above-3' | '3-to-1' | '1-to--1' | '-1-to--3' | 'below--3';
export type HeatmapTrendId = 'strong-up' | 'up' | 'sideways' | 'down' | 'strong-down' | 'reading';
export type HeatmapSortMode = 'mcap' | 'gains';
export type HeatmapTableCol = 'symbol' | 'ltp' | 'changePct' | 'high52' | 'low52' | 'trend';

export interface HeatmapBucket {
  id: HeatmapBucketId;
  label: string;
  tone: string;
}

export interface HeatmapTrendMeta {
  id: HeatmapTrendId;
  label: string;
}

export interface HeatmapCompany {
  symbol: string;
  name: string;
  sector: string;
  mcapRank: number;
  ltp: number | null;
  change: number | null;
  changePct: number | null;
  high52: number | null;
  low52: number | null;
  ema20: number | null;
  ema50: number | null;
  adx: number | null;
  trend: HeatmapTrendId;
  trendLabel: string;
  score: number;
  bucket: HeatmapBucketId;
}

export interface HeatmapIndex {
  id: string;
  name: string;
  ltp: number | null;
  change: number | null;
  changePct: number | null;
}

export interface HeatmapIndexOption {
  id: string;
  name: string;
}

export interface HeatmapSnapshot {
  status?: string;
  public: boolean;
  indices?: HeatmapIndexOption[];
  index: HeatmapIndex;
  session: { ok: boolean; dailiesReady?: boolean; source?: string; message?: string };
  buckets: HeatmapBucket[];
  trends: HeatmapTrendMeta[];
  advances: number;
  declines: number;
  unchanged: number;
  trendCounts: Record<string, number>;
  companies: HeatmapCompany[];
  warning?: string | null;
  lastUpdatedAt: string;
}

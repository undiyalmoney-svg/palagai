export interface CrudeLiveContract {
  tradingSymbol: string;
  instrumentToken: number;
  expiry: string | null;
  lotSize: number;
  tickSize: number;
  rolled?: boolean;
  expiryDay?: boolean;
}

export interface CrudeLiveFill {
  instrument: string;
  side: 'L' | 'S' | string;
  qty: number;
  entry: number | null;
  stop: number | null;
  target: number | null;
  signalT?: string | null;
  confirmT?: string | null;
}

export interface CrudeLiveDna {
  profileId: string;
  entryStart: string;
  entryEnd: string;
  flatten: string;
  stopPts: number;
  targetPts: number;
  dayLockPts: number;
  dayLossPts: number;
  maxTrades: number;
  weekLockPts: number;
  rupeesPerPoint: number;
  chargeRs: number;
  qty: number;
}

export interface CrudeLiveMoney {
  enabled: boolean;
  liveOrders: boolean;
  date: string;
  weekMonday?: string;
  weekNetPts: number;
  dayNetPts: number;
  tradesToday: number;
  pending?: { dir: number; signalT: string } | null;
  contract: CrudeLiveContract | null;
  fills: CrudeLiveFill[];
  lastTick: string | null;
  lastError: string | null;
  lastMessage: string | null;
  sessionOk: boolean;
  dropletWatching?: boolean;
  dropletPlacing?: boolean;
  guaranteed: boolean;
}

export interface CrudeLiveResponse {
  status: string;
  liveOrders: boolean;
  engineVersion?: string;
  dna?: CrudeLiveDna;
  money: CrudeLiveMoney;
  message?: string;
}

export interface SlBuddyRule {
  book: string;
  label: string;
  offset: number;
  rule: string;
}

export interface SlBuddyPending {
  orderId: string | null;
  instrument: string;
  exchange: string | null;
  book: string;
  bookLabel: string;
  product: string;
  qty: number;
  price: number | null;
  status: string;
}

export interface SlBuddyLive {
  instrument: string;
  exchange: string | null;
  book: string;
  bookLabel: string;
  product: string;
  qty: number;
  entry: number | null;
  stop: number | null;
  slQty: number;
  uncoveredQty: number;
}

export interface SlBuddyStop {
  orderId: string | null;
  instrument: string;
  exchange: string | null;
  book: string;
  bookLabel: string;
  product: string;
  qty: number;
  trigger: number | null;
  status: string;
  tag: string | null;
  orderType: string;
}

export interface SlBuddyView {
  watching: boolean;
  date?: string;
  lastTick?: string | null;
  lastError?: string | null;
  lastMessage?: string | null;
  sessionOk?: boolean;
  pending: SlBuddyPending[];
  live: SlBuddyLive[];
  sl: SlBuddyStop[];
}

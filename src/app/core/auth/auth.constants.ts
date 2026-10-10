export type SiteModule =
  | 'trade'
  | 'crude'
  | 'auto'
  | 'momentum'
  | 'research'
  | 'token'
  | 'test'
  | 'strat'
  | 'pnl'
  | 'vault';

export interface SiteUser {
  id: string;
  username: string;
  /** Present on admin user list only (for edit/display) */
  password?: string;
  role: 'owner' | 'friend' | string;
  modules: SiteModule[];
  blocked?: boolean;
  kiteApiKey?: string;
  note?: string;
  /** Admin → user notice (empty if none / dismissed) */
  adminMessage?: string;
  adminMessageAt?: string | null;
  paymentStatus?: 'paid' | 'unpaid' | 'pending' | string;
  paymentNote?: string;
  paymentUpdatedAt?: string | null;
}

export const AUTH_SESSION_KEY = 'palagai_auth_session';
export const AUTH_TOKEN_KEY = 'palagai_site_token';
export const AUTH_USER_KEY = 'palagai_site_user';
export const ADMIN_TOKEN_KEY = 'palagai_admin_token';

/** @deprecated client-side check removed — login is server/Mongo now */
export const AUTH_CREDENTIALS = {
  username: 'Devil',
  password: '',
} as const;

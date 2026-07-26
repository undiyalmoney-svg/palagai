/**
 * App release identity — bump on every main push the user must verify in UI.
 * Shown in dashboard header / Trade Desk so a stale browser build is obvious.
 */
export const APP_VERSION = '1.3.0';
/** Short build tag for this fix train (option P&L + version badge). */
export const APP_BUILD = '2026.07.26-pnl-v3';
export const APP_BUILD_LABEL = `v${APP_VERSION} · ${APP_BUILD}`;

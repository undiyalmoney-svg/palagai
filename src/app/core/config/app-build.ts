/**
 * App release identity — bump on every main push the user must verify in UI.
 * Shown in Trade Desk “What the app trades on” card and Autobot hero.
 * Autobot also prefers Order-API /live appBuild when the server reports it.
 */
export const APP_VERSION = '1.3.153';
/** Short build tag — weekly-bank Crude Mini: scratch 8, TP 30, week lock 40. */
export const APP_BUILD = '2026.10.31-weekly-bank';
export const APP_BUILD_LABEL = `v${APP_VERSION} · ${APP_BUILD}`;

/**
 * App release identity — bump on every main push the user must verify in UI.
 * Shown in Trade Desk “What the app trades on” card and Autobot hero.
 * Autobot also prefers Order-API /live appBuild when the server reports it.
 */
export const APP_VERSION = '1.3.141';
/** Short build tag — Live today 1R lock on Kite cash. */
export const APP_BUILD = '2026.10.29-live-lock';
export const APP_BUILD_LABEL = `v${APP_VERSION} · ${APP_BUILD}`;

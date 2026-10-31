/**
 * App release identity — bump on every main push the user must verify in UI.
 * Shown in Trade Desk “What the app trades on” card and Autobot hero.
 * Autobot also prefers Order-API /live appBuild when the server reports it.
 */
export const APP_VERSION = '1.3.162';
/** Short build tag — reverse-engineered losers, no live flip. */
export const APP_BUILD = '2026.10.31-reverse-fail';
export const APP_BUILD_LABEL = `v${APP_VERSION} · ${APP_BUILD}`;

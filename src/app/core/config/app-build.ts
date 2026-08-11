/**
 * App release identity — bump on every main push the user must verify in UI.
 * Shown in Trade Desk “What the app trades on” card and Autobot hero.
 * Autobot also prefers Order-API /live appBuild when the server reports it.
 */
export const APP_VERSION = '1.3.120';
/** Short build tag — matches Order-API Crude Mini qty=1 lot fix. */
export const APP_BUILD = '2026.08.11-crude-qty-1lot';
export const APP_BUILD_LABEL = `v${APP_VERSION} · ${APP_BUILD}`;

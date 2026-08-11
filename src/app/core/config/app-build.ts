/**
 * App release identity — bump on every main push the user must verify in UI.
 * Shown in Trade Desk “What the app trades on” card and Autobot hero.
 * Autobot also prefers Order-API /live appBuild when the server reports it.
 */
export const APP_VERSION = '1.3.118';
/** Short build tag for this fix train — matches Order-API All3 UI books deploy. */
export const APP_BUILD = '2026.08.11-all3-ui-books';
export const APP_BUILD_LABEL = `v${APP_VERSION} · ${APP_BUILD}`;

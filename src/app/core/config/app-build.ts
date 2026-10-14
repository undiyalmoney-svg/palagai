/**
 * App release identity — bump on every main push the user must verify in UI.
 * Shown in Trade Desk “What the app trades on” card and Autobot hero.
 * Autobot also prefers Order-API /live appBuild when the server reports it.
 */
export const APP_VERSION = '1.3.128';
/** Short build tag — Charts heat board white / green / red. */
export const APP_BUILD = '2026.10.14-heat-board-white';
export const APP_BUILD_LABEL = `v${APP_VERSION} · ${APP_BUILD}`;

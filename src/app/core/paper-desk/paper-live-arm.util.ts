/**
 * Live Kite radio + book checks. Stored separately from the blotter so a
 * refresh or tab close does not disarm Live.
 */
import { PaperLiveBooks, emptyPaperLiveBooks, paperLiveArmed } from './paper-live-order.util';

export const PAPER_LIVE_ARM_KEY = 'palagai_paper_live_arm_v1';

export type PaperLiveArm = { live: boolean; books: PaperLiveBooks };

export function emptyPaperLiveArm(): PaperLiveArm {
  return { live: false, books: emptyPaperLiveBooks() };
}

export function readPaperLiveArm(): PaperLiveArm {
  try {
    if (typeof localStorage === 'undefined') return emptyPaperLiveArm();
    const raw = localStorage.getItem(PAPER_LIVE_ARM_KEY);
    if (!raw) return emptyPaperLiveArm();
    const parsed = JSON.parse(raw) as Partial<PaperLiveArm>;
    const books = { ...emptyPaperLiveBooks(), ...(parsed.books || {}) };
    return { live: parsed.live === true, books };
  } catch {
    return emptyPaperLiveArm();
  }
}

export function writePaperLiveArm(arm: PaperLiveArm): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      PAPER_LIVE_ARM_KEY,
      JSON.stringify({ live: !!arm.live, books: { ...emptyPaperLiveBooks(), ...arm.books } }),
    );
  } catch {
    /* ignore quota */
  }
}

export function paperLiveArmArmed(arm: PaperLiveArm): boolean {
  return paperLiveArmed(arm.live, arm.books);
}

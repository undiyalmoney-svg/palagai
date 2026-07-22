import { Injectable, inject } from '@angular/core';
import {
  RulerArm,
  RulerMorningFeatures,
  RULER_LOSS_STREAK_BREAKER,
  RULER_RAMPAGE_UNTIL_INR,
  clipRulerDayInr,
  pickRulerArm,
} from '../engines/ruler-morning.util';
import {
  RulerMonthStateService,
  RulerRiskScope,
} from './ruler-month-state.service';

export type RulerArmPick = {
  arm: RulerArm;
  /** True only when morning features were available and the day arm is final. */
  locked: boolean;
  /** True when loss-streak breaker is forcing edge witch. */
  breakerActive?: boolean;
  witch?: 'beast' | 'hunter_uw' | 'trail_wide' | 'breaker_edge';
};

/**
 * Research-faithful shared daily arm: one witch pick per calendar day,
 * applied to both Nifty and Bank (see ruler-profit-boost comb()).
 *
 * Zero-red profit-boost:
 * - Beast only while 0 ≤ MTD < ₹3k (never while month is already red)
 * - MTD < 0 → hunter recover witch
 * - MTD ≥ ₹3k → trail on wide mornings (else 2R/swing)
 * - After 2 consecutive clipped red days *anytime* → edge for rest of month
 * - Day-cap ₹500
 *
 * IMPORTANT: do NOT lock STAND while morning features are still null
 * (pre-OR bars). Research picks the arm once at OR 09:45.
 */
@Injectable({ providedIn: 'root' })
export class RulerDayPlanService {
  private readonly monthState = inject(RulerMonthStateService);

  private scope: RulerRiskScope = 'live';
  private readonly liveArms = new Map<string, RulerArm>();
  private readonly testingArms = new Map<string, RulerArm>();

  setScope(scope: RulerRiskScope): void {
    this.scope = scope;
  }

  clearTesting(): void {
    this.testingArms.clear();
  }

  clearLive(): void {
    this.liveArms.clear();
  }

  /** Locked arm for the day, if any. */
  getArm(date: string): RulerArm | null {
    return this.active().get(date) ?? null;
  }

  /**
   * Return existing day arm, or lock a new pick once morning features exist.
   * Pre-OR (`features == null`) returns provisional STAND without locking.
   */
  getOrLockArm(
    date: string,
    features: RulerMorningFeatures | null,
    monthMtdInr: number,
  ): RulerArmPick {
    const map = this.active();
    const existing = map.get(date);
    const breakerActive = this.isBreakerActive(date);
    const witch = breakerActive
      ? 'breaker_edge'
      : monthMtdInr < 0
        ? 'hunter_uw'
        : monthMtdInr < RULER_RAMPAGE_UNTIL_INR
          ? 'beast'
          : 'trail_wide';
    if (existing != null) {
      return { arm: existing, locked: true, breakerActive, witch };
    }
    // Wait for OR/morning features — never permanently lock STAND from null.
    if (features == null) {
      return { arm: 'STAND', locked: false, breakerActive, witch };
    }
    const arm = pickRulerArm(features, monthMtdInr, { breakerActive });
    map.set(date, arm);
    return { arm, locked: true, breakerActive, witch };
  }

  /**
   * Replay prior days in the month (from locked arms / month trades) to see if
   * the 2-loss breaker has tripped before `asOfDate` (trips anytime, including rampage).
   */
  isBreakerActive(asOfDate: string): boolean {
    const ym = asOfDate.slice(0, 7);
    const prior = [...this.active().keys()]
      .filter((d) => d.startsWith(ym) && d < asOfDate)
      .sort();
    // Also include trade-only days that may not be locked yet on bank pass —
    // prefer union with month trade dates.
    const tradeDates = this.monthState
      .priorTradeDates(ym, asOfDate)
      .filter((d) => !prior.includes(d));
    const days = [...prior, ...tradeDates].sort();
    let mtd = 0;
    let streak = 0;
    let broken = false;
    for (const d of days) {
      const raw = this.monthState.dayInr(d);
      const clipped = clipRulerDayInr(raw, mtd);
      if (clipped < 0) {
        streak += 1;
        if (streak >= RULER_LOSS_STREAK_BREAKER && !broken) {
          broken = true;
        }
      } else if (clipped > 0) {
        streak = 0;
      }
      mtd += clipped;
    }
    return broken;
  }

  private active(): Map<string, RulerArm> {
    return this.scope === 'testing' ? this.testingArms : this.liveArms;
  }
}

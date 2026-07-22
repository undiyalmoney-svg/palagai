import { Injectable } from '@angular/core';
import {
  RulerArm,
  RulerMorningFeatures,
  pickRulerArm,
} from '../engines/ruler-morning.util';
import { RulerRiskScope } from './ruler-month-state.service';

export type RulerArmPick = {
  arm: RulerArm;
  /** True only when morning features were available and the day arm is final. */
  locked: boolean;
};

/**
 * Research-faithful shared daily arm: one witch pick per calendar day,
 * applied to both Nifty and Bank (see ruler-profit-boost comb()).
 *
 * IMPORTANT: do NOT lock STAND while morning features are still null
 * (pre-OR bars). Research picks the arm once at OR 09:45. Locking STAND on
 * the first 09:15 bar permanently killed the day → bogus −₹1,500 clipped totals.
 */
@Injectable({ providedIn: 'root' })
export class RulerDayPlanService {
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
    if (existing != null) {
      return { arm: existing, locked: true };
    }
    // Wait for OR/morning features — never permanently lock STAND from null.
    if (features == null) {
      return { arm: 'STAND', locked: false };
    }
    const arm = pickRulerArm(features, monthMtdInr);
    map.set(date, arm);
    return { arm, locked: true };
  }

  private active(): Map<string, RulerArm> {
    return this.scope === 'testing' ? this.testingArms : this.liveArms;
  }
}

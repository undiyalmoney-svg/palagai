import { Injectable } from '@angular/core';
import {
  RulerArm,
  RulerMorningFeatures,
  pickRulerArm,
} from '../engines/ruler-morning.util';
import { RulerRiskScope } from './ruler-month-state.service';

/**
 * Research-faithful shared daily arm: one witch pick per calendar day,
 * applied to both Nifty and Bank (see ruler-profit-boost comb()).
 *
 * Desk always processes Nifty before Bank when both are enabled, so the first
 * lock uses Nifty morning features — matching research `morning_feat(nifty)`.
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
   * Return existing day arm, or lock a new pick from `features` + MTD.
   * Subsequent calls the same day (other index) reuse the locked arm.
   */
  getOrLockArm(
    date: string,
    features: RulerMorningFeatures | null,
    monthMtdInr: number,
  ): RulerArm {
    const map = this.active();
    const existing = map.get(date);
    if (existing != null) {
      return existing;
    }
    const arm = pickRulerArm(features, monthMtdInr);
    map.set(date, arm);
    return arm;
  }

  private active(): Map<string, RulerArm> {
    return this.scope === 'testing' ? this.testingArms : this.liveArms;
  }
}

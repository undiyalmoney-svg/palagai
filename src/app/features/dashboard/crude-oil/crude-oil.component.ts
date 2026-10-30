import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  GUARD_BOOK_LABEL,
  OWNER_CAPITAL_RS,
  expiryRule,
  guardCapital,
} from '../../../core/paper-desk/capital-guard.util';
import { CRUDE_DAILY_GREEN } from '../../../core/strategy-engine/strategies/crude-daily-green/crude-daily-green.dna';
import { CrudeOilApiService } from './crude-oil-api.service';
import { CrudeLiveDna, CrudeLiveMoney } from './crude-oil.models';

@Component({
  selector: 'app-crude-oil',
  standalone: true,
  imports: [FormsModule, DecimalPipe, RouterLink],
  templateUrl: './crude-oil.component.html',
  styleUrl: './crude-oil.component.css',
})
export class CrudeOilComponent implements OnInit, OnDestroy {
  private readonly api = inject(CrudeOilApiService);
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  protected liveConfirm = false;
  protected readonly liveMoney = signal<CrudeLiveMoney | null>(null);
  protected readonly dna = signal<CrudeLiveDna | null>(null);
  protected readonly engineVersion = signal('');
  protected readonly liveMoneyBusy = signal(false);
  protected readonly error = signal('');
  protected readonly locked = CRUDE_DAILY_GREEN;
  protected readonly capital = guardCapital(OWNER_CAPITAL_RS);
  protected readonly bookLabel = GUARD_BOOK_LABEL;
  protected readonly expiryLines = (['nifty', 'bank', 'sensex', 'crude'] as const).map((book) => ({
    book,
    rule: expiryRule(book),
  }));

  ngOnInit(): void {
    this.poll();
  }

  ngOnDestroy(): void {
    this.clearPoll();
  }

  protected liveConfirmOk(): boolean {
    return this.liveConfirm === true;
  }

  protected async startLiveMoney(): Promise<void> {
    this.error.set('');
    this.liveMoneyBusy.set(true);
    try {
      const res = await this.api.startLiveMoney();
      this.apply(res);
      this.poll();
    } catch (err) {
      this.error.set(this.fmtErr(err));
    } finally {
      this.liveMoneyBusy.set(false);
    }
  }

  protected async stopLiveMoney(): Promise<void> {
    this.error.set('');
    this.liveMoneyBusy.set(true);
    try {
      const res = await this.api.stopLiveMoney();
      this.apply(res);
    } catch (err) {
      this.error.set(this.fmtErr(err));
    } finally {
      this.liveMoneyBusy.set(false);
    }
  }

  private poll(): void {
    this.clearPoll();
    void this.refresh();
    this.pollTimer = setTimeout(() => this.poll(), 3000);
  }

  private async refresh(): Promise<void> {
    try {
      const res = await this.api.status();
      this.apply(res);
    } catch {
      /* droplet status is optional until Start */
    }
  }

  private apply(res: { money?: CrudeLiveMoney; dna?: CrudeLiveDna; engineVersion?: string }): void {
    if (res.money) this.liveMoney.set(res.money);
    if (res.dna) this.dna.set(res.dna);
    if (res.engineVersion) this.engineVersion.set(res.engineVersion);
  }

  private clearPoll(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private fmtErr(err: unknown): string {
    const raw = err as { error?: { message?: string }; message?: string };
    return raw?.error?.message || raw?.message || 'Could not reach Crude Mini live money.';
  }
}

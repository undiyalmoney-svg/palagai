import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { SlBuddyApiService } from './sl-buddy-api.service';
import { SlBuddyRule, SlBuddyView } from './sl-buddy.models';

@Component({
  selector: 'app-sl-buddy-page',
  standalone: true,
  imports: [DecimalPipe, RouterLink],
  templateUrl: './sl-buddy-page.component.html',
})
export class SlBuddyPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(SlBuddyApiService);
  private readonly kite = inject(KiteSessionService);
  private timer: ReturnType<typeof setInterval> | null = null;

  protected readonly buddy = signal<SlBuddyView | null>(null);
  protected readonly rules = signal<SlBuddyRule[]>([]);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly busy = signal(false);

  ngOnInit(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 5_000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  protected tokenReady(): boolean {
    return Boolean(this.kite.getAuthorizationHeader());
  }

  protected async watch(): Promise<void> {
    if (!this.tokenReady()) {
      this.error.set('Open Get Token and connect Kite, then press Watch my orders.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      const out = await this.api.setWatching(true);
      this.apply(out);
      this.notice.set(out.buddy.lastMessage || 'Watching your orders.');
    } catch (err) {
      this.error.set(this.messageOf(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async stop(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      const out = await this.api.setWatching(false);
      this.apply(out);
      this.notice.set(out.buddy.lastMessage || 'SL Buddy stopped.');
    } catch (err) {
      this.error.set(this.messageOf(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async refresh(): Promise<void> {
    try {
      this.apply(await this.api.get());
      this.error.set('');
    } catch (err) {
      this.error.set(this.messageOf(err));
    }
  }

  private apply(out: { buddy: SlBuddyView; rules: SlBuddyRule[] }): void {
    this.buddy.set(out.buddy);
    this.rules.set(out.rules || []);
  }

  private messageOf(err: unknown): string {
    const body = (err as { error?: { message?: string } })?.error;
    return body?.message || 'SL Buddy did not respond.';
  }
}

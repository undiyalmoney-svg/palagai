import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { SiteUser } from '../../core/auth/auth.constants';

type PayStatus = 'paid' | 'unpaid' | 'pending';

@Component({
  selector: 'app-admin-payments-page',
  standalone: true,
  imports: [FormsModule, DatePipe],
  templateUrl: './admin-payments-page.component.html',
  styleUrl: './admin-payments-page.component.css',
})
export class AdminPaymentsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  protected readonly users = signal<SiteUser[]>([]);
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly messageIsError = signal(false);
  protected readonly statusDraft = signal<Record<string, PayStatus>>({});
  protected readonly noteDraft = signal<Record<string, string>>({});
  protected searchQuery = '';
  protected statusFilter: 'all' | PayStatus = 'all';
  protected readonly filterTick = signal(0);

  protected readonly filteredUsers = computed(() => {
    this.filterTick();
    const q = this.searchQuery.trim().toLowerCase();
    const st = this.statusFilter;
    return this.users().filter((u) => {
      const pay = this.statusFor(u);
      if (st !== 'all' && pay !== st) return false;
      if (!q) return true;
      return [u.username, u.paymentNote, pay].join(' ').toLowerCase().includes(q);
    });
  });

  protected readonly counts = computed(() => {
    const rows = this.users();
    let paid = 0;
    let unpaid = 0;
    let pending = 0;
    for (const u of rows) {
      const s = this.statusFor(u);
      if (s === 'paid') paid += 1;
      else if (s === 'pending') pending += 1;
      else unpaid += 1;
    }
    return { paid, unpaid, pending, total: rows.length };
  });

  ngOnInit(): void {
    void this.reload();
  }

  protected onFilterChange(): void {
    this.filterTick.update((n) => n + 1);
  }

  protected roleLabel(u: SiteUser): string {
    return u.role === 'owner' ? 'Devil' : 'Customer';
  }

  protected statusFor(u: SiteUser): PayStatus {
    const d = this.statusDraft()[u.id];
    if (d) return d;
    const s = String(u.paymentStatus || '').toLowerCase();
    if (s === 'paid' || s === 'pending' || s === 'unpaid') return s;
    return u.role === 'owner' ? 'paid' : 'unpaid';
  }

  protected noteFor(u: SiteUser): string {
    const d = this.noteDraft()[u.id];
    return d != null ? d : String(u.paymentNote || '');
  }

  protected setStatus(u: SiteUser, value: string): void {
    const s = value as PayStatus;
    this.statusDraft.update((cur) => ({ ...cur, [u.id]: s }));
  }

  protected setNote(u: SiteUser, value: string): void {
    this.noteDraft.update((cur) => ({ ...cur, [u.id]: value }));
  }

  private flash(text: string, isError = false): void {
    this.message.set(text);
    this.messageIsError.set(isError);
  }

  protected async reload(keepMessage?: string): Promise<void> {
    this.busy.set(true);
    if (!keepMessage) {
      this.message.set('');
      this.messageIsError.set(false);
    }
    try {
      const res = await firstValueFrom(
        this.http.get<{ users: SiteUser[] }>('/api/auth/admin/users'),
      );
      const list = res.users || [];
      this.users.set(list);
      const st: Record<string, PayStatus> = {};
      const notes: Record<string, string> = {};
      for (const u of list) {
        const s = String(u.paymentStatus || '').toLowerCase();
        st[u.id] =
          s === 'paid' || s === 'pending' || s === 'unpaid'
            ? s
            : u.role === 'owner'
              ? 'paid'
              : 'unpaid';
        notes[u.id] = String(u.paymentNote || '');
      }
      this.statusDraft.set(st);
      this.noteDraft.set(notes);
      this.onFilterChange();
      if (keepMessage) this.flash(keepMessage, false);
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      this.flash(
        status === 401 || status === 403
          ? 'Admin session expired — sign in again'
          : 'Failed to load payments',
        true,
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected async savePayment(u: SiteUser): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.http.patch(`/api/auth/admin/users/${u.id}`, {
          paymentStatus: this.statusFor(u),
          paymentNote: this.noteFor(u),
        }),
      );
      await this.reload(`Payment updated for ${u.username}`);
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      this.flash(e?.error?.message || 'Save payment failed', true);
    } finally {
      this.busy.set(false);
    }
  }
}

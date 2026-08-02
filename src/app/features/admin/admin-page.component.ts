import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { SiteModule, SiteUser } from '../../core/auth/auth.constants';
import { UiDialogService } from '../../shared/ui/dialog/ui-dialog.service';

const CUSTOMER_MODS: SiteModule[] = ['trade', 'crude', 'auto', 'token', 'test', 'strat'];

@Component({
  selector: 'app-admin-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './admin-page.component.html',
  styleUrl: './admin-page.component.css',
})
export class AdminPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly uiDialog = inject(UiDialogService);

  protected readonly customerMods = CUSTOMER_MODS;
  protected readonly users = signal<SiteUser[]>([]);
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly messageIsError = signal(false);
  protected readonly showCreate = signal(false);
  protected readonly filterTick = signal(0);

  protected searchQuery = '';
  protected roleFilter: 'all' | 'owner' | 'customer' = 'all';
  protected statusFilter: 'all' | 'active' | 'blocked' = 'all';

  protected newUsername = '';
  protected newPassword = '';
  protected newKiteKey = '';
  protected newNote = '';
  protected newMods: SiteModule[] = ['trade', 'crude', 'token', 'test'];

  /** UI-only list filter — does not touch APIs. */
  protected readonly filteredUsers = computed(() => {
    this.filterTick();
    const q = this.searchQuery.trim().toLowerCase();
    const role = this.roleFilter;
    const status = this.statusFilter;
    return this.users().filter((u) => {
      if (role === 'owner' && u.role !== 'owner') return false;
      if (role === 'customer' && u.role === 'owner') return false;
      if (status === 'active' && u.blocked) return false;
      if (status === 'blocked' && !u.blocked) return false;
      if (!q) return true;
      const hay = [u.username, u.note, u.kiteApiKey, u.role].join(' ').toLowerCase();
      return hay.includes(q);
    });
  });

  ngOnInit(): void {
    void this.reload();
  }

  protected onFilterChange(): void {
    this.filterTick.update((n) => n + 1);
  }

  protected modLabel(m: SiteModule): string {
    const map: Record<SiteModule, string> = {
      trade: 'Trade',
      crude: 'Crude',
      auto: 'Auto',
      token: 'Token',
      test: 'Test',
      strat: 'Strategy',
      pnl: 'P/L',
      vault: 'Vault',
    };
    return map[m] || m;
  }

  protected roleLabel(u: SiteUser): string {
    return u.role === 'owner' ? 'Devil' : 'Customer';
  }

  protected toggleNew(m: SiteModule, ev: Event): void {
    const on = (ev.target as HTMLInputElement).checked;
    if (on) this.newMods = [...new Set([...this.newMods, m])];
    else this.newMods = this.newMods.filter((x) => x !== m);
  }

  protected toggleUser(u: SiteUser, m: SiteModule, ev: Event): void {
    const on = (ev.target as HTMLInputElement).checked;
    const modules = on
      ? [...new Set([...(u.modules || []), m])]
      : (u.modules || []).filter((x) => x !== m);
    u.modules = modules;
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
      this.users.set(res.users || []);
      this.onFilterChange();
      if (keepMessage) {
        this.flash(keepMessage, false);
      }
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      this.flash(
        status === 401 || status === 403
          ? 'Admin session expired — sign in again'
          : 'Failed to load users — check Order-API /auth is running',
        true,
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected async create(): Promise<void> {
    this.busy.set(true);
    this.message.set('');
    this.messageIsError.set(false);
    if (!String(this.newKiteKey || '').trim()) {
      this.flash('Kite API key required for customers', true);
      this.busy.set(false);
      return;
    }
    try {
      await firstValueFrom(
        this.http.post('/api/auth/admin/users', {
          username: this.newUsername,
          password: this.newPassword,
          modules: this.newMods,
          kiteApiKey: this.newKiteKey,
          note: this.newNote,
        }),
      );
      this.newUsername = '';
      this.newPassword = '';
      this.newKiteKey = '';
      this.newNote = '';
      this.showCreate.set(false);
      await this.reload('User created');
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      this.flash(e?.error?.message || 'Create failed', true);
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveUser(u: SiteUser): Promise<void> {
    if (u.role !== 'owner' && !String(u.kiteApiKey || '').trim()) {
      this.flash('Kite API key required for customers', true);
      return;
    }
    if (!String(u.password || '').trim() || String(u.password).trim().length < 6) {
      this.flash('Password min 6 chars', true);
      return;
    }
    const name = u.username;
    this.busy.set(true);
    try {
      const body: Record<string, unknown> = {
        username: u.username,
        password: u.password,
        modules: u.modules,
        note: u.note,
        kiteApiKey: String(u.kiteApiKey || '').trim(),
      };
      await firstValueFrom(this.http.patch(`/api/auth/admin/users/${u.id}`, body));
      await this.reload(`Saved ${name}`);
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      this.flash(e?.error?.message || 'Save failed', true);
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggleBlock(u: SiteUser): Promise<void> {
    this.busy.set(true);
    const name = u.username;
    const nextBlocked = !u.blocked;
    try {
      await firstValueFrom(
        this.http.patch(`/api/auth/admin/users/${u.id}`, {
          blocked: nextBlocked,
        }),
      );
      await this.reload(nextBlocked ? `Blocked ${name}` : `Unblocked ${name}`);
    } catch {
      this.flash('Block update failed', true);
    } finally {
      this.busy.set(false);
    }
  }

  protected async deleteUser(u: SiteUser): Promise<void> {
    if (u.role === 'owner') {
      this.flash('Cannot delete Devil', true);
      return;
    }
    const ok = await this.uiDialog.confirm({
      title: 'Delete customer?',
      message: `Delete customer “${u.username}”? This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) {
      return;
    }
    const name = u.username;
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.delete(`/api/auth/admin/users/${u.id}`));
      await this.reload(`Deleted ${name}`);
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      this.flash(e?.error?.message || 'Delete failed', true);
    } finally {
      this.busy.set(false);
    }
  }
}

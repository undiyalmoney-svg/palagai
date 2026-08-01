import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';
import { SiteModule, SiteUser } from '../../core/auth/auth.constants';
import { UiDialogService } from '../../shared/ui/dialog/ui-dialog.service';

const CUSTOMER_MODS: SiteModule[] = ['trade', 'crude', 'auto', 'token', 'test', 'strat'];

@Component({
  selector: 'app-admin-page',
  standalone: true,
  imports: [FormsModule, MatButtonModule],
  template: `
    <section class="admin">
      <header>
        <div>
          <h1>Users</h1>
          <p>
            Create customer users, edit username/password, set modules, block or delete customers.
            Kite API key is required for customers — not for Devil (owner).
          </p>
        </div>
      </header>

      @if (message()) {
        <p class="msg" [class.err]="messageIsError()" role="status">{{ message() }}</p>
      }

      <article class="card">
        <h2>New customer user</h2>
        <div class="row">
          <label>Username <input [(ngModel)]="newUsername" autocomplete="off" /></label>
          <label
            >Password <input [(ngModel)]="newPassword" type="text" autocomplete="off"
          /></label>
          <label class="wide"
            >Kite API key (required for customers)
            <input [(ngModel)]="newKiteKey" autocomplete="off"
          /></label>
          <label class="wide">Note <input [(ngModel)]="newNote" /></label>
        </div>
        <div class="mods">
          @for (m of customerMods; track m) {
            <label>
              <input type="checkbox" [checked]="newMods.includes(m)" (change)="toggleNew(m, $event)" />
              {{ modLabel(m) }}
            </label>
          }
        </div>
        <button mat-flat-button color="primary" type="button" (click)="create()" [disabled]="busy()">
          Create customer
        </button>
      </article>

      <article class="card table-card">
        <div class="table-head">
          <h2>All users</h2>
          <span class="count">{{ users().length }} total</span>
        </div>
        <div class="table-wrap">
          <table class="users-table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Username</th>
                <th>Password</th>
                <th>Modules</th>
                <th>Kite API key</th>
                <th>Note</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (u of users(); track u.id) {
                <tr [class.blocked]="u.blocked">
                  <td>
                    <span class="role-pill" [class.devil]="u.role === 'owner'">{{ roleLabel(u) }}</span>
                  </td>
                  <td>
                    <input class="cell-input" [(ngModel)]="u.username" [disabled]="busy()" autocomplete="off" />
                  </td>
                  <td>
                    <input
                      class="cell-input"
                      [(ngModel)]="u.password"
                      type="text"
                      [disabled]="busy()"
                      autocomplete="off"
                    />
                  </td>
                  <td>
                    <div class="mods compact">
                      @for (m of customerMods; track m) {
                        <label>
                          <input
                            type="checkbox"
                            [checked]="u.modules.includes(m)"
                            [disabled]="u.role === 'owner' || busy()"
                            (change)="toggleUser(u, m, $event)"
                          />
                          {{ modLabel(m) }}
                        </label>
                      }
                    </div>
                  </td>
                  <td>
                    @if (u.role === 'owner') {
                      <span class="muted">Local Get Token</span>
                    } @else {
                      <input
                        class="cell-input mono"
                        [(ngModel)]="u.kiteApiKey"
                        [disabled]="busy()"
                        autocomplete="off"
                      />
                    }
                  </td>
                  <td>
                    <input class="cell-input" [(ngModel)]="u.note" [disabled]="busy()" />
                  </td>
                  <td>
                    @if (u.blocked) {
                      <span class="status blocked">Blocked</span>
                    } @else {
                      <span class="status ok">Active</span>
                    }
                  </td>
                  <td>
                    <div class="actions">
                      <button
                        mat-flat-button
                        color="primary"
                        type="button"
                        (click)="saveUser(u)"
                        [disabled]="busy()"
                      >
                        Save
                      </button>
                      @if (u.role !== 'owner') {
                        <button mat-stroked-button type="button" (click)="toggleBlock(u)" [disabled]="busy()">
                          {{ u.blocked ? 'Unblock' : 'Block' }}
                        </button>
                        <button class="btn-delete" type="button" (click)="deleteUser(u)" [disabled]="busy()">
                          Delete
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="8" class="empty">No users yet — create a customer above.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `,
  styles: `
    .admin {
      max-width: none;
      margin: 0;
      padding: 0;
      color: var(--pg-ink);
      box-sizing: border-box;
    }
    header {
      margin-bottom: 1.25rem;
    }
    h1 {
      margin: 0;
      font-size: 1.5rem;
      letter-spacing: -0.03em;
    }
    header p {
      margin: 0.4rem 0 0;
      color: var(--pg-muted);
      max-width: 48rem;
    }
    h2 {
      margin: 0 0 1rem;
      font-size: 1.05rem;
    }
    .card {
      background: #fff;
      border: 1px solid var(--pg-line);
      border-radius: 20px;
      padding: 1.5rem 1.65rem;
      margin-bottom: 1rem;
      box-shadow: var(--pg-shadow-soft);
    }
    .table-card {
      padding: 1.15rem 1.15rem 1.25rem;
    }
    .table-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 0.85rem;
      padding: 0 0.35rem;
    }
    .table-head h2 {
      margin: 0;
    }
    .count {
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--pg-muted);
    }
    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
    }
    .wide {
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.85rem;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.85rem;
    }
    input {
      padding: 0.65rem 0.85rem;
      border: 1px solid var(--pg-line);
      border-radius: 12px;
      color: var(--pg-ink);
      background: #fff;
      min-height: 42px;
      font: inherit;
    }
    input:focus {
      outline: none;
      border-color: var(--pg-bull);
      box-shadow: 0 0 0 3px var(--pg-bull-glow);
    }
    .mods {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin: 0.75rem 0;
    }
    .mods label {
      flex-direction: row;
      align-items: center;
      gap: 0.35rem;
      white-space: nowrap;
    }
    .mods.compact {
      margin: 0;
      gap: 0.35rem 0.55rem;
      max-width: 16rem;
    }
    .mods.compact label {
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--pg-muted);
    }
    .table-wrap {
      overflow: auto;
      border: 1px solid var(--pg-line);
      border-radius: 16px;
      background: #fff;
    }
    .users-table {
      width: 100%;
      border-collapse: collapse;
      min-width: 1100px;
      font-size: 0.85rem;
    }
    .users-table thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--pg-bg-muted);
      color: var(--pg-muted);
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      text-align: left;
      padding: 0.85rem 0.75rem;
      border-bottom: 1px solid var(--pg-line);
      white-space: nowrap;
    }
    .users-table tbody td {
      padding: 0.75rem;
      border-bottom: 1px solid var(--pg-line);
      vertical-align: top;
    }
    .users-table tbody tr:last-child td {
      border-bottom: none;
    }
    .users-table tbody tr:hover {
      background: #f8fafb;
    }
    .users-table tbody tr.blocked {
      background: #fff6f6;
    }
    .cell-input {
      width: 100%;
      min-width: 7.5rem;
      min-height: 36px;
      padding: 0.4rem 0.55rem;
      border-radius: 10px;
      font-size: 0.82rem;
    }
    .cell-input.mono {
      font-family: var(--pg-font-mono);
      font-size: 0.75rem;
      min-width: 10rem;
    }
    .role-pill {
      display: inline-flex;
      padding: 0.28rem 0.55rem;
      border-radius: 999px;
      background: var(--pg-bg-muted);
      border: 1px solid var(--pg-line);
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--pg-muted);
      white-space: nowrap;
    }
    .role-pill.devil {
      background: var(--pg-bull-soft);
      border-color: #b7ebd0;
      color: var(--pg-bull-deep);
    }
    .status {
      display: inline-flex;
      padding: 0.28rem 0.55rem;
      border-radius: 999px;
      font-size: 0.7rem;
      font-weight: 700;
      white-space: nowrap;
    }
    .status.ok {
      background: var(--pg-bull-soft);
      color: var(--pg-bull-deep);
    }
    .status.blocked {
      background: var(--pg-bear-soft);
      color: var(--pg-bear-deep);
    }
    .muted {
      color: var(--pg-muted);
      font-size: 0.78rem;
    }
    .empty {
      text-align: center;
      color: var(--pg-muted);
      padding: 1.5rem !important;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      align-items: center;
      min-width: 12rem;
    }
    .btn-delete {
      appearance: none;
      border: 1px solid #b91c1c;
      background: #dc2626;
      color: #fff;
      font-weight: 700;
      font-size: 0.8rem;
      padding: 0.45rem 0.75rem;
      border-radius: 8px;
      cursor: pointer;
    }
    .btn-delete:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn-delete:hover:not(:disabled) {
      background: #b91c1c;
    }
    .msg {
      position: sticky;
      top: 0.5rem;
      z-index: 5;
      color: #0b6b3a;
      font-weight: 600;
      margin-bottom: 0.75rem;
      padding: 0.75rem 1rem;
      background: #dcfce7;
      border: 1px solid #86efac;
      border-radius: 10px;
    }
    .msg.err {
      color: #b42318;
      background: #fee2e2;
      border-color: #fecaca;
    }
    @media (max-width: 720px) {
      .row {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class AdminPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly uiDialog = inject(UiDialogService);

  protected readonly customerMods = CUSTOMER_MODS;
  protected readonly users = signal<SiteUser[]>([]);
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly messageIsError = signal(false);

  protected newUsername = '';
  protected newPassword = '';
  protected newKiteKey = '';
  protected newNote = '';
  protected newMods: SiteModule[] = ['trade', 'crude', 'token', 'test'];

  ngOnInit(): void {
    void this.reload();
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
      if (keepMessage) {
        this.flash(keepMessage, false);
      } else if (!(res.users || []).length) {
        this.flash('No users yet — create one below.');
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
      };
      if (u.role !== 'owner') {
        body['kiteApiKey'] = u.kiteApiKey;
      }
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

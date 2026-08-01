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

      <article class="card">
        <h2>All users</h2>
        @for (u of users(); track u.id) {
          <div class="user" [class.blocked]="u.blocked">
            <div class="user-head">
              <span class="role">{{ roleLabel(u) }}</span>
              @if (u.blocked) {
                <em>BLOCKED</em>
              }
            </div>
            <div class="row">
              <label
                >Username
                <input [(ngModel)]="u.username" [disabled]="busy()" autocomplete="off"
              /></label>
              <label
                >Password
                <input [(ngModel)]="u.password" type="text" [disabled]="busy()" autocomplete="off"
              /></label>
            </div>
            <div class="mods">
              @for (m of customerMods; track m) {
                <label>
                  <input
                    type="checkbox"
                    [checked]="u.modules.includes(m)"
                    [disabled]="u.role === 'owner'"
                    (change)="toggleUser(u, m, $event)"
                  />
                  {{ modLabel(m) }}
                </label>
              }
            </div>
            @if (u.role === 'owner') {
              <p class="hint">Devil uses local Get Token credentials — no API key stored here.</p>
            } @else {
              <label class="wide"
                >Kite API key
                <input [(ngModel)]="u.kiteApiKey" [disabled]="busy()" autocomplete="off"
              /></label>
              @if (u.kiteApiKey) {
                <p class="saved-key">Saved key: <code>{{ u.kiteApiKey }}</code></p>
              }
            }
            <label class="wide">Note <input [(ngModel)]="u.note" [disabled]="busy()" /></label>
            <div class="actions">
              <button mat-flat-button color="primary" type="button" (click)="saveUser(u)" [disabled]="busy()">
                Save
              </button>
              @if (u.role !== 'owner') {
                <button mat-stroked-button type="button" (click)="toggleBlock(u)" [disabled]="busy()">
                  {{ u.blocked ? 'Unblock' : 'Block' }}
                </button>
                <button class="btn-delete" type="button" (click)="deleteUser(u)" [disabled]="busy()">
                  Delete customer
                </button>
              } @else {
                <span class="hint">Devil cannot be deleted</span>
              }
            </div>
          </div>
        }
      </article>
    </section>
  `,
  styles: `
    .admin {
      max-width: 960px;
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
      color: var(--pg-ink);
    }
    header p {
      margin: 0.4rem 0 0;
      color: var(--pg-muted);
    }
    h2,
    p,
    label,
    strong,
    span,
    em {
      color: inherit;
    }
    .card {
      background: #fff;
      border: 1px solid var(--pg-line);
      border-radius: 20px;
      padding: 1.5rem 1.65rem;
      margin-bottom: 1rem;
      box-shadow: var(--pg-shadow-soft);
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
      color: var(--pg-ink);
    }
    input {
      padding: 0.65rem 0.85rem;
      border: 1px solid var(--pg-line);
      border-radius: 12px;
      color: var(--pg-ink);
      background: #fff;
      min-height: 42px;
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
    }
    .user {
      border-top: 1px solid #eee;
      padding: 0.85rem 0;
    }
    .user.blocked {
      opacity: 0.7;
      background: #fff6f6;
    }
    .user-head {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    .role {
      font-weight: 700;
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.04em;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.5rem;
      align-items: center;
    }
    .btn-delete {
      appearance: none;
      border: 1px solid #b91c1c;
      background: #dc2626;
      color: #fff;
      font-weight: 700;
      font-size: 0.9rem;
      padding: 0.55rem 1rem;
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
    .hint {
      margin: 0.5rem 0 0;
      font-size: 0.85rem;
      color: #5a6f66;
    }
    .saved-key {
      margin: 0.35rem 0 0;
      font-size: 0.85rem;
      color: #0c1f17;
    }
    .saved-key code {
      font-family: ui-monospace, monospace;
      background: #e8f5ef;
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      word-break: break-all;
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

import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { SiteModule, SiteUser } from '../../core/auth/auth.constants';

const FRIEND_MODS: SiteModule[] = ['trade', 'crude', 'auto', 'token'];

@Component({
  selector: 'app-admin-page',
  standalone: true,
  imports: [FormsModule, MatButtonModule],
  template: `
    <section class="admin">
      <header>
        <div>
          <h1>Admin · Users</h1>
          <p>Create friends, set modules, block access. Kite API key required for friends only — not for Devil.</p>
        </div>
        <button mat-stroked-button type="button" (click)="logout()">Admin logout</button>
      </header>

      @if (message()) {
        <p class="msg">{{ message() }}</p>
      }

      <article class="card">
        <h2>New user</h2>
        <div class="row">
          <label>Username <input [(ngModel)]="newUsername" /></label>
          <label>Password <input [(ngModel)]="newPassword" type="text" autocomplete="off" /></label>
          <label class="wide"
            >Kite API key (required for friends)
            <input [(ngModel)]="newKiteKey" autocomplete="off"
          /></label>
          <label class="wide">Note <input [(ngModel)]="newNote" /></label>
        </div>
        <div class="mods">
          @for (m of friendMods; track m) {
            <label>
              <input type="checkbox" [checked]="newMods.includes(m)" (change)="toggleNew(m, $event)" />
              {{ m }}
            </label>
          }
        </div>
        <button mat-flat-button color="primary" type="button" (click)="create()" [disabled]="busy()">
          Create user
        </button>
      </article>

      <article class="card">
        <h2>Users</h2>
        @for (u of users(); track u.id) {
          <div class="user" [class.blocked]="u.blocked">
            <div class="user-head">
              <strong>{{ u.username }}</strong>
              <span>{{ u.role }}</span>
              @if (u.blocked) {
                <em>BLOCKED</em>
              }
            </div>
            <div class="mods">
              @for (m of friendMods; track m) {
                <label>
                  <input
                    type="checkbox"
                    [checked]="u.modules.includes(m)"
                    [disabled]="u.role === 'owner'"
                    (change)="toggleUser(u, m, $event)"
                  />
                  {{ m }}
                </label>
              }
            </div>
            @if (u.role === 'owner') {
              <p class="hint">Devil uses local Get Token credentials — no API key stored here.</p>
            } @else {
              <label class="wide"
                >Kite API key
                <input [(ngModel)]="u.kiteApiKey" (change)="saveUser(u)" [disabled]="busy()" autocomplete="off"
              /></label>
            }
            <div class="actions">
              <button mat-stroked-button type="button" (click)="saveUser(u)" [disabled]="busy()">
                Save
              </button>
              @if (u.role !== 'owner') {
                <button mat-stroked-button type="button" (click)="toggleBlock(u)" [disabled]="busy()">
                  {{ u.blocked ? 'Unblock' : 'Block' }}
                </button>
              }
            </div>
          </div>
        }
      </article>
    </section>
  `,
  styles: `
    .admin {
      max-width: 900px;
      margin: 0 auto;
      padding: 1.25rem;
      color: #0c1f17;
      background: #f4faf7;
      min-height: 100dvh;
      box-sizing: border-box;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      align-items: flex-start;
      margin-bottom: 1rem;
    }
    h1, h2, p, label, strong, span, em {
      color: #0c1f17;
    }
    .card {
      background: #fff;
      border: 1px solid #dfeae4;
      border-radius: 12px;
      padding: 1rem;
      margin-bottom: 1rem;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
    }
    .wide {
      grid-column: 1 / -1;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.85rem;
    }
    input {
      padding: 0.45rem 0.55rem;
      border: 1px solid #ccc;
      border-radius: 6px;
      color: #0c1f17;
      background: #fff;
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
    }
    .actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }
    .msg {
      color: #0b6b3a;
      font-weight: 600;
      margin-bottom: 0.75rem;
    }
    .hint {
      margin: 0.5rem 0 0;
      font-size: 0.85rem;
      color: #5a6f66;
    }
  `,
})
export class AdminPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly friendMods = FRIEND_MODS;
  protected readonly users = signal<SiteUser[]>([]);
  protected readonly busy = signal(false);
  protected readonly message = signal('');

  protected newUsername = '';
  protected newPassword = '';
  protected newKiteKey = '';
  protected newNote = '';
  protected newMods: SiteModule[] = ['trade', 'crude', 'token'];

  ngOnInit(): void {
    void this.reload();
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

  protected async reload(): Promise<void> {
    this.busy.set(true);
    this.message.set('');
    try {
      const res = await firstValueFrom(
        this.http.get<{ users: SiteUser[] }>('/api/auth/admin/users'),
      );
      this.users.set(res.users || []);
      if (!(res.users || []).length) {
        this.message.set('No users yet — create one below.');
      }
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      this.message.set(
        status === 401 || status === 403
          ? 'Admin session expired — sign in again'
          : 'Failed to load users — check Order-API /auth is running',
      );
      if (status === 401 || status === 403) {
        this.auth.adminLogout();
        await this.router.navigateByUrl('/admin/login');
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async create(): Promise<void> {
    this.busy.set(true);
    this.message.set('');
    if (!String(this.newKiteKey || '').trim()) {
      this.message.set('Kite API key required for friends');
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
      this.message.set('User created');
      await this.reload();
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      this.message.set(e?.error?.message || 'Create failed');
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveUser(u: SiteUser): Promise<void> {
    if (u.role === 'owner') {
      this.message.set('Devil has no stored API key');
      return;
    }
    if (!String(u.kiteApiKey || '').trim()) {
      this.message.set('Kite API key required for friends');
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.http.patch(`/api/auth/admin/users/${u.id}`, {
          modules: u.modules,
          kiteApiKey: u.kiteApiKey,
          note: u.note,
        }),
      );
      this.message.set(`Saved ${u.username}`);
      await this.reload();
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      this.message.set(e?.error?.message || 'Save failed');
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggleBlock(u: SiteUser): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.http.patch(`/api/auth/admin/users/${u.id}`, {
          blocked: !u.blocked,
        }),
      );
      this.message.set(u.blocked ? `Unblocked ${u.username}` : `Blocked ${u.username}`);
      await this.reload();
    } catch {
      this.message.set('Block update failed');
    } finally {
      this.busy.set(false);
    }
  }

  protected logout(): void {
    this.auth.adminLogout();
    void this.router.navigateByUrl('/admin/login');
  }
}

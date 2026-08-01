import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';

interface VaultSecret {
  id: string;
  key: string;
  value: string;
  updatedAt?: string;
}

@Component({
  selector: 'app-vault-page',
  standalone: true,
  imports: [FormsModule, MatButtonModule],
  template: `
    <section class="vault">
      <h1>Vault</h1>
      <p>Owner only. Unlock with vault password (not stored in Mongo). Secrets are encrypted in Mongo.</p>

      <label
        >Vault password
        <input type="password" [(ngModel)]="vaultPassword" autocomplete="off"
      /></label>
      <div class="actions">
        <button mat-flat-button color="primary" type="button" (click)="unlock()" [disabled]="busy()">
          Unlock
        </button>
        <button mat-stroked-button type="button" (click)="seed()" [disabled]="busy() || !unlocked()">
          Seed defaults
        </button>
      </div>

      @if (message()) {
        <p class="msg">{{ message() }}</p>
      }

      @if (unlocked()) {
        <article class="card">
          <h2>Secrets</h2>
          @for (s of secrets(); track s.key) {
            <div class="row">
              <code>{{ s.key }}</code>
              <input [(ngModel)]="s.value" />
              <button mat-stroked-button type="button" (click)="save(s)">Save</button>
              <button mat-stroked-button type="button" (click)="remove(s.key)">Delete</button>
            </div>
          }
          <div class="row new">
            <input placeholder="KEY" [(ngModel)]="newKey" />
            <input placeholder="value" [(ngModel)]="newValue" />
            <button mat-flat-button color="primary" type="button" (click)="add()">Add</button>
          </div>
        </article>
      }
    </section>
  `,
  styles: `
    .vault {
      max-width: 900px;
      margin: 0 auto;
      padding: 1.25rem;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      max-width: 360px;
      margin-bottom: 0.75rem;
    }
    input {
      padding: 0.45rem 0.55rem;
      border: 1px solid #ccc;
      border-radius: 6px;
    }
    .actions {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .card {
      border: 1px solid #ddd;
      border-radius: 12px;
      padding: 1rem;
      background: #fff;
    }
    .row {
      display: grid;
      grid-template-columns: 160px 1fr auto auto;
      gap: 0.5rem;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    .row.new {
      margin-top: 1rem;
      grid-template-columns: 160px 1fr auto;
    }
    .msg {
      color: #0b6b3a;
    }
  `,
})
export class VaultPageComponent {
  private readonly http = inject(HttpClient);

  protected vaultPassword = '';
  protected newKey = '';
  protected newValue = '';
  protected readonly unlocked = signal(false);
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly secrets = signal<VaultSecret[]>([]);

  protected async unlock(): Promise<void> {
    this.busy.set(true);
    this.message.set('');
    try {
      const res = await firstValueFrom(
        this.http.post<{ secrets: VaultSecret[] }>('/api/auth/vault/list', {
          password: this.vaultPassword,
        }),
      );
      this.secrets.set(res.secrets || []);
      this.unlocked.set(true);
      this.message.set('Vault unlocked');
    } catch {
      this.unlocked.set(false);
      this.message.set('Wrong vault password or unreachable API');
    } finally {
      this.busy.set(false);
    }
  }

  protected async seed(): Promise<void> {
    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<{ secrets: VaultSecret[] }>('/api/auth/vault/seed', {
          password: this.vaultPassword,
        }),
      );
      this.secrets.set(res.secrets || []);
      this.message.set('Defaults seeded (missing keys only)');
    } catch {
      this.message.set('Seed failed');
    } finally {
      this.busy.set(false);
    }
  }

  protected async save(s: VaultSecret): Promise<void> {
    await firstValueFrom(
      this.http.put('/api/auth/vault', {
        password: this.vaultPassword,
        key: s.key,
        value: s.value,
      }),
    );
    this.message.set(`Saved ${s.key}`);
  }

  protected async add(): Promise<void> {
    if (!this.newKey.trim()) return;
    await firstValueFrom(
      this.http.put('/api/auth/vault', {
        password: this.vaultPassword,
        key: this.newKey.trim(),
        value: this.newValue,
      }),
    );
    this.newKey = '';
    this.newValue = '';
    await this.unlock();
  }

  protected async remove(key: string): Promise<void> {
    await firstValueFrom(
      this.http.delete(`/api/auth/vault/${encodeURIComponent(key)}`, {
        headers: { 'X-Vault-Password': this.vaultPassword },
      }),
    );
    await this.unlock();
  }
}

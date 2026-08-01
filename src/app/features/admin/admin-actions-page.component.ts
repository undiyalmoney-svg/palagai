import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { SiteUser } from '../../core/auth/auth.constants';
import { UiDialogService } from '../../shared/ui/dialog/ui-dialog.service';

@Component({
  selector: 'app-admin-actions-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './admin-actions-page.component.html',
  styleUrl: './admin-actions-page.component.css',
})
export class AdminActionsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly uiDialog = inject(UiDialogService);

  protected readonly users = signal<SiteUser[]>([]);
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly messageIsError = signal(false);
  protected readonly drafts = signal<Record<string, string>>({});
  protected searchQuery = '';
  protected readonly filterTick = signal(0);

  protected readonly filteredUsers = computed(() => {
    this.filterTick();
    const q = this.searchQuery.trim().toLowerCase();
    return this.users().filter((u) => {
      if (!q) return true;
      return [u.username, u.adminMessage, u.note, u.role].join(' ').toLowerCase().includes(q);
    });
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

  protected draftFor(u: SiteUser): string {
    const d = this.drafts();
    return d[u.id] != null ? d[u.id]! : String(u.adminMessage || '');
  }

  protected setDraft(u: SiteUser, value: string): void {
    this.drafts.update((cur) => ({ ...cur, [u.id]: value }));
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
      const next: Record<string, string> = {};
      for (const u of list) next[u.id] = String(u.adminMessage || '');
      this.drafts.set(next);
      this.onFilterChange();
      if (keepMessage) this.flash(keepMessage, false);
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      this.flash(
        status === 401 || status === 403
          ? 'Admin session expired — sign in again'
          : 'Failed to load users',
        true,
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveMessage(u: SiteUser): Promise<void> {
    this.busy.set(true);
    const wanted = this.draftFor(u).trim();
    try {
      const res = await firstValueFrom(
        this.http.patch<{ user?: SiteUser }>(`/api/auth/admin/users/${u.id}`, {
          adminMessage: wanted,
        }),
      );
      const saved = String(res?.user?.adminMessage || '').trim();
      if (wanted && saved !== wanted) {
        this.flash(
          'Message NOT stored — Order-API on the droplet is outdated. SSH in, git pull, then pm2 restart trading-backend.',
          true,
        );
        return;
      }
      await this.reload(
        wanted
          ? `Message saved for ${u.username} — customer will see it after refresh / re-login`
          : `Message cleared for ${u.username}`,
      );
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      this.flash(e?.error?.message || 'Save message failed', true);
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggleBlock(u: SiteUser): Promise<void> {
    if (u.role === 'owner') {
      this.flash('Cannot block Devil', true);
      return;
    }
    this.busy.set(true);
    const nextBlocked = !u.blocked;
    try {
      await firstValueFrom(
        this.http.patch(`/api/auth/admin/users/${u.id}`, {
          blocked: nextBlocked,
          // Keep current draft as the notice when blocking/unblocking.
          adminMessage: this.draftFor(u),
        }),
      );
      await this.reload(
        nextBlocked ? `Blocked ${u.username}` : `Unblocked ${u.username}`,
      );
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
    if (!ok) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.delete(`/api/auth/admin/users/${u.id}`));
      await this.reload(`Deleted ${u.username}`);
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      this.flash(e?.error?.message || 'Delete failed', true);
    } finally {
      this.busy.set(false);
    }
  }
}

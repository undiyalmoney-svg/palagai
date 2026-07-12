import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { BoardService } from '../board.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.css'],
})
export class SettingsComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly boardService = inject(BoardService);

  /** Stored at RTDB `richman/secret` */
  secret = '';
  /** Stored at RTDB `richman/key` */
  key = '';

  statusMessage = '';
  statusType: 'success' | 'error' | 'info' | '' = '';
  saving = false;
  deleting = false;
  hasConfig = false;

  /** True after user edits either field — do not overwrite from a late Firebase read */
  private dirty = false;

  ngOnInit(): void {
    if (typeof window === 'undefined') return;

    const unlocked = localStorage.getItem('palagai_settings_unlocked') === 'true';
    if (!unlocked) {
      this.router.navigate(['/admin/login'], { queryParams: { returnUrl: '/settings' } });
      return;
    }

    void this.loadConfig();
  }

  onFieldChange(): void {
    this.dirty = true;
  }

  /**
   * Non-blocking: form is always visible (no full-page / card spinner).
   * Fetches RTDB in the background; empty inputs if missing or on timeout/error.
   */
  async loadConfig(): Promise<void> {
    this.statusMessage = '';
    this.hasConfig = false;

    const timeoutMs = 8000;
    try {
      const data = await Promise.race([
        this.boardService.getRichmanConfig(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);

      if (this.dirty) {
        return;
      }

      if (!data) {
        this.secret = '';
        this.key = '';
        this.hasConfig = false;
        this.setStatus('Config not set', 'info');
        return;
      }

      this.secret = data.secret;
      this.key = data.key;
      this.hasConfig = !!(data.secret.trim() && data.key.trim());
      this.setStatus(this.hasConfig ? 'Config Active' : 'Config incomplete', 'info');
    } catch (err) {
      if (this.dirty) {
        return;
      }
      this.hasConfig = false;
      this.secret = '';
      this.key = '';
      const anyErr = err as { message?: string };
      const msg = anyErr?.message ? anyErr.message : 'Error connecting to Firebase';
      this.setStatus(msg, 'error');
    }
  }

  save(): void {
    if (!this.secret.trim() || !this.key.trim()) {
      this.setStatus('Both Secret and Key are required', 'error');
      return;
    }

    this.saving = true;
    const secret = this.secret.trim();
    const key = this.key.trim();

    void (async () => {
      try {
        await this.boardService.setRichmanConfig(secret, key);
        this.hasConfig = true;
        this.secret = secret;
        this.key = key;
        this.dirty = false;
        this.setStatus('Configuration saved successfully', 'success');
      } catch (err) {
        this.hasConfig = false;
        const anyErr = err as { message?: string };
        const msg = anyErr?.message ? anyErr.message : 'Error connecting to Firebase';
        this.setStatus(msg, 'error');
      } finally {
        this.saving = false;
      }
    })();
  }

  delete(): void {
    if (this.deleting) return;
    this.deleting = true;

    void (async () => {
      try {
        await this.boardService.deleteRichmanConfig();
        this.hasConfig = false;
        this.secret = '';
        this.key = '';
        this.dirty = false;
        this.setStatus('Configuration deleted', 'success');
      } catch (err) {
        const anyErr = err as { message?: string };
        const msg = anyErr?.message ? anyErr.message : 'Error connecting to Firebase';
        this.setStatus(msg, 'error');
      } finally {
        this.deleting = false;
      }
    })();
  }

  private setStatus(message: string, type: 'success' | 'error' | 'info'): void {
    this.statusMessage = message;
    this.statusType = type;
  }
}

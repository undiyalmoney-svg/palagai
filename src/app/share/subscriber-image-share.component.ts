import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

/** Public page: /share/image?src=<encoded-https-url>&title=...&file=optional-name.png */
@Component({
  selector: 'app-subscriber-image-share',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  templateUrl: './subscriber-image-share.component.html',
  styleUrl: './subscriber-image-share.component.css',
})
export class SubscriberImageShareComponent implements OnInit {
  imageUrl: string | null = null;
  pageTitle = 'Shared image';
  /** Suggested filename for Save / download */
  downloadFilename = 'image';
  error = '';
  imageLoaded = false;
  imageBroken = false;
  downloading = false;

  constructor(
    private route: ActivatedRoute,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const raw = params.get('src')?.trim();
      const title = params.get('title')?.trim();
      const file = params.get('file')?.trim();

      this.imageLoaded = false;
      this.imageBroken = false;
      this.error = '';

      if (title) {
        this.pageTitle = title;
      }

      if (!raw) {
        this.imageUrl = null;
        this.error =
          'No image link was provided. Ask for the full share link (it should include ?src=…).';
        return;
      }

      const parsed = this.parseAllowedImageUrl(raw);
      if (!parsed.ok) {
        this.imageUrl = null;
        this.error = parsed.message;
        return;
      }

      this.imageUrl = parsed.url;
      this.downloadFilename =
        this.sanitizeFilename(file) || this.filenameFromUrl(parsed.url) || 'image';

      if (typeof document !== 'undefined') {
        document.title = this.pageTitle;
      }
    });
  }

  onImageLoad(): void {
    this.imageLoaded = true;
    this.imageBroken = false;
  }

  onImageError(): void {
    this.imageBroken = true;
    this.imageLoaded = false;
  }

  async download(): Promise<void> {
    if (!this.imageUrl || this.imageBroken) {
      return;
    }
    this.downloading = true;
    try {
      const res = await fetch(this.imageUrl, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) {
        throw new Error(String(res.status));
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = this.downloadFilename;
      a.rel = 'noopener';
      a.click();
      URL.revokeObjectURL(objectUrl);
      this.snackBar.open('Download started', 'OK', { duration: 2500 });
    } catch {
      this.snackBar.open(
        'Could not download automatically (often due to the host blocking cross-origin saves). Open the image in a new tab and use Save as.',
        'OK',
        { duration: 6000 }
      );
      window.open(this.imageUrl, '_blank', 'noopener,noreferrer');
    } finally {
      this.downloading = false;
    }
  }

  openInNewTab(): void {
    if (this.imageUrl) {
      window.open(this.imageUrl, '_blank', 'noopener,noreferrer');
    }
  }

  private parseAllowedImageUrl(raw: string): { ok: true; url: string } | { ok: false; message: string } {
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }

    let url: URL;
    try {
      url = new URL(decoded);
    } catch {
      return { ok: false, message: 'That image link is not a valid URL.' };
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { ok: false, message: 'Only http(s) image links are allowed.' };
    }

    if (url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      return { ok: false, message: 'For security, only https links are allowed (except localhost).' };
    }

    return { ok: true, url: url.toString() };
  }

  private filenameFromUrl(url: string): string {
    try {
      const path = new URL(url).pathname;
      const base = path.split('/').pop() || '';
      const cleaned = base.split('?')[0];
      return this.sanitizeFilename(cleaned) || '';
    } catch {
      return '';
    }
  }

  /** Keep a simple safe basename for the download attribute */
  private sanitizeFilename(name: string | undefined): string {
    if (!name) {
      return '';
    }
    const trimmed = name.replace(/[/\\]/g, '').slice(0, 120);
    if (!trimmed || trimmed === '.' || trimmed === '..') {
      return '';
    }
    return trimmed;
  }
}

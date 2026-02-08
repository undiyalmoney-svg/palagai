import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { LinkGeneratedDialogComponent } from './link-generated-dialog.component';

@Component({
  selector: 'app-create-balloon-secret',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSnackBarModule,
    MatDialogModule,
    MatCheckboxModule,
  ],
  templateUrl: './create-balloon-secret.component.html',
  styleUrls: ['./create-balloon-secret.component.css']
})
export class CreateBalloonSecretComponent implements OnInit, OnDestroy {
  secretForm!: FormGroup;
  generatedUrl: string = '';
  isGenerating: boolean = false;
  private adSenseScript: HTMLScriptElement | null = null;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {}

  selectedIcon: number = 1; // Default to icon 1

  ngOnInit(): void {
    this.secretForm = this.fb.group({
      punchCount: [5, [Validators.required, Validators.min(1), Validators.max(1000)]],
      message: ['', [Validators.required, Validators.minLength(1)]],
      icon: [1, [Validators.required]]
    });

    // Load Google AdSense script
    this.loadAdSenseScript();
  }

  ngOnDestroy(): void {
    // Clean up AdSense script if needed
    if (this.adSenseScript && this.adSenseScript.parentNode) {
      this.adSenseScript.parentNode.removeChild(this.adSenseScript);
    }
  }

  private loadAdSenseScript(): void {
    // Check if script already exists
    if (document.querySelector('script[src*="adsbygoogle.js"]')) {
      return;
    }

    // Create and load AdSense script
    this.adSenseScript = document.createElement('script');
    this.adSenseScript.async = true;
    this.adSenseScript.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2739882000561401';
    this.adSenseScript.crossOrigin = 'anonymous';
    document.head.appendChild(this.adSenseScript);
  }

  selectIcon(iconNumber: number): void {
    this.selectedIcon = iconNumber;
    this.secretForm.patchValue({ icon: iconNumber });
  }

  get selectedIconPath(): string {
    return `/assets/icon-${this.selectedIcon}.png`;
  }

  /**
   * Check if string contains emojis
   * Returns true if emojis are detected
   */
  private containsEmoji(str: string): boolean {
    // Emoji regex pattern - matches most emoji ranges
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{FE00}-\u{FE0F}]|[\u{200D}]|[\u{203C}-\u{3299}]/u;
    return emojiRegex.test(str);
  }

  /**
   * Unicode-safe Base64 encoding
   * Uses encodeURIComponent to handle Unicode characters (emojis, etc.)
   */
  private encodeUnicodeBase64(str: string): string {
    // First encode to URI component to handle Unicode properly
    const uriEncoded = encodeURIComponent(str);
    // Then base64 encode the URI-encoded string
    return btoa(uriEncoded)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  onSubmit(): void {
    if (this.secretForm.invalid || this.isGenerating) {
      return;
    }

    const formValue = this.secretForm.value;
    const message = formValue.message.trim();

    // Check for emojis
    if (this.containsEmoji(message)) {
      this.snackBar.open('Only string and numbers are allowed', 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar']
      });
      return;
    }

    this.isGenerating = true;

    try {
      // Create payload
      const payload = {
        punchCount: formValue.punchCount,
        message: formValue.message.trim(),
        icon: formValue.icon || this.selectedIcon
      };

      // Encode as URL-safe Base64 with Unicode support
      const jsonString = JSON.stringify(payload);
      const base64String = this.encodeUnicodeBase64(jsonString);

      // Generate shareable URL
      const baseUrl = typeof window !== 'undefined' 
        ? window.location.origin 
        : '';
      this.generatedUrl = `${baseUrl}/punch/${base64String}`;

      this.isGenerating = false;

      // Open dialog to show the generated link
      this.openLinkDialog();
    } catch (error) {
      console.error('Error generating URL:', error);
      this.snackBar.open('Error generating link. Please try again.', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar']
      });
      this.isGenerating = false;
    }
  }

  private openLinkDialog(): void {
    const dialogRef = this.dialog.open(LinkGeneratedDialogComponent, {
      width: '95vw',
      maxWidth: '500px',
      minWidth: '280px',
      maxHeight: '95vh',
      disableClose: false,
      autoFocus: true,
      panelClass: 'link-generated-dialog-panel',
      data: {
        url: this.generatedUrl
      }
    });

    dialogRef.afterClosed().subscribe(() => {
      // Dialog closed
    });
  }

  get punchCount() {
    return this.secretForm.get('punchCount');
  }

  get message() {
    return this.secretForm.get('message');
  }
}


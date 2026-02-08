import { Component, OnInit } from '@angular/core';
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
export class CreateBalloonSecretComponent implements OnInit {
  secretForm!: FormGroup;
  generatedUrl: string = '';
  isGenerating: boolean = false;

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
  }

  selectIcon(iconNumber: number): void {
    this.selectedIcon = iconNumber;
    this.secretForm.patchValue({ icon: iconNumber });
  }

  get selectedIconPath(): string {
    return `/assets/icon-${this.selectedIcon}.png`;
  }

  onSubmit(): void {
    if (this.secretForm.invalid || this.isGenerating) {
      return;
    }

    this.isGenerating = true;
    const formValue = this.secretForm.value;

    try {
      // Create payload
      const payload = {
        punchCount: formValue.punchCount,
        message: formValue.message.trim(),
        icon: formValue.icon || this.selectedIcon
      };

      // Encode as URL-safe Base64
      const jsonString = JSON.stringify(payload);
      const base64String = btoa(jsonString)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

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


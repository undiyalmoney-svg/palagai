import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormControl } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { CustomEditorComponent } from '../mainboard/custom-editor/custom-editor.component';
import { BoardService } from '../board.service';
import { AlertService } from '../shared/alert.service';
import { KavithaiRulesDialogComponent } from './kavithai-rules-dialog.component';
import { KavithaiEmailDialogComponent } from './kavithai-email-dialog.component';

@Component({
  selector: 'app-kavithai-submit',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    CustomEditorComponent,
  ],
  templateUrl: './kavithai-submit.component.html',
  styleUrl: './kavithai-submit.component.css',
})
export class KavithaiSubmitComponent implements OnInit, OnDestroy {
  kavithaiForm: FormGroup;
  submitting = false;
  submitted = false;
  characterCount = 0;
  maxCharacters = 500;

  @ViewChild('editor') editorRef!: CustomEditorComponent;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private boards: BoardService,
    private snackBar: MatSnackBar,
    private alertService: AlertService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) {
    this.kavithaiForm = this.fb.group({
      content: ['', [Validators.required]],
    });
  }

  ngOnInit(): void {
    // Ensure body overflow is enabled for scrolling on this page
    if (typeof window !== 'undefined') {
      document.body.style.overflow = 'auto';
      document.body.style.margin = '';
      document.body.style.padding = '';
      document.documentElement.style.overflow = 'auto';
    }

    // Auto-open rules dialog on page load
    setTimeout(() => {
      this.openRulesDialog();
    }, 300);

    // Subscribe to content changes for character count
    this.contentControl.valueChanges.subscribe(() => {
      this.updateCharacterCount();
    });
  }

  ngOnDestroy(): void {
    // Clean up - body overflow will be managed by other components
    // No need to reset here as other components will set it as needed
  }

  get contentControl(): FormControl<string | null> {
    return this.kavithaiForm.get('content') as FormControl<string | null>;
  }

  updateCharacterCount(): void {
    const content = this.contentControl.value || '';
    // Remove HTML tags for character count
    const textContent = content.replace(/<[^>]*>/g, '');
    this.characterCount = textContent.length;
    this.cdr.markForCheck();
  }

  openRulesDialog(): void {
    this.dialog.open(KavithaiRulesDialogComponent, {
      width: '600px',
      maxWidth: '90vw',
      disableClose: false,
      data: {},
    });
  }

  async onSubmit(): Promise<void> {
    // Validate content first
    if (this.kavithaiForm.invalid) {
      if (this.contentControl.invalid) {
        this.snackBar.open('Please enter your kavithai content', 'OK', {
          duration: 3000,
          panelClass: ['error-snackbar'],
        });
      }
      return;
    }

    const content = this.contentControl.value || '';
    const textContent = content.replace(/<[^>]*>/g, '');

    // Check character limit
    if (textContent.length > this.maxCharacters) {
      this.snackBar.open(
        `Content exceeds ${this.maxCharacters} characters. Current: ${textContent.length} characters.`,
        'OK',
        {
          duration: 4000,
          panelClass: ['error-snackbar'],
        }
      );
      return;
    }

    if (textContent.trim().length === 0) {
      this.snackBar.open('Please enter your kavithai content', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }

    // Open email dialog
    const dialogRef = this.dialog.open(KavithaiEmailDialogComponent, {
      width: '500px',
      maxWidth: '90vw',
      disableClose: true,
      data: {},
    });

    dialogRef.afterClosed().subscribe(async (email: string | undefined) => {
      if (!email) {
        // User cancelled
        return;
      }

      // Submit with email
      await this.submitKavithai(email, content);
    });
  }

  private async submitKavithai(email: string, content: string): Promise<void> {
    this.submitting = true;

    try {
      const kavithaiId = await this.boards.submitKavithai(email, content);

      // Mark as submitted and disable button
      this.submitted = true;
      this.submitting = false;
      this.cdr.detectChanges();

      // Show success alert using AlertService (same as other pages)
      this.alertService.success('Your kavithai has been submitted successfully!', 'Submission Successful');

      // Reset form
      this.kavithaiForm.reset();
      this.characterCount = 0;
      this.submitted = false; // Reset submitted state so user can submit more
    } catch (error: any) {
      console.error('Error submitting kavithai:', error);
      this.submitting = false;
      this.submitted = false;
      this.cdr.detectChanges();
      this.snackBar.open(
        error?.message || 'Failed to submit kavithai. Please try again.',
        'OK',
        {
          duration: 4000,
          panelClass: ['error-snackbar'],
        }
      );
    }
  }
}


import { Component, OnInit, ChangeDetectorRef, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';
import { Board, BoardService } from '../board.service';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { LinkDialogComponent } from './link-dialog.component';
import { EmailDialogComponent } from './email-dialog.component';
import { SaveConfirmationDialogComponent } from './save-confirmation-dialog.component';
import { CustomEditorComponent } from './custom-editor/custom-editor.component';

@Component({
  selector: 'app-mainboard',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    CustomEditorComponent,
    MatToolbarModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatCardModule,
    MatCheckboxModule,
    MatIconModule,
    MatSnackBarModule,
    MatDialogModule,
  ],
  templateUrl: './mainboard.html',
  styleUrl: './mainboard.css',
})
export class Mainboard implements OnInit, AfterViewInit {
  loading = false;
  saving = false;
  clearing = false;
  message = '';
  board: Board | null = null;
  boardSize: 'min' | 'normal' | 'max' = 'normal'; // Board size control
  private savedContent = ''; // Track saved content for unsaved changes detection

  form: FormGroup;
  emailControl = new FormControl<string | null>('', [Validators.email]);
  addingEmail = false;

  constructor(
    private readonly router: Router,
    public readonly auth: AuthService,
    private readonly boards: BoardService,
    private readonly fb: FormBuilder,
    private readonly snackBar: MatSnackBar,
    private readonly dialog: MatDialog,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.form = this.fb.group({
      content: [''],
      boardProtection: [false],
      emails: this.fb.array<FormControl<string | null>>([]),
    });
  }

  get contentControl(): FormControl<string | null> {
    return this.form.get('content') as FormControl<string | null>;
  }

  get boardProtectionControl(): FormControl<boolean | null> {
    return this.form.get('boardProtection') as FormControl<boolean | null>;
  }


  get emails(): FormArray<FormControl<string | null>> {
    return this.form.get('emails') as FormArray<FormControl<string | null>>;
  }

  get lastUpdated(): number | null {
    return this.board?.message?.updatedAt ?? null;
  }

  get shareableLink(): string {
    if (!this.auth.user?.boardKey) {
      return '';
    }
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    // Size will be loaded from DB in subboard, so we don't need to pass it in URL
    return `${baseUrl}/board/${this.auth.user.boardKey}`;
  }

  private updateFormControlsDisabledState() {
    if (this.loading) {
      this.boardProtectionControl.disable({ emitEvent: false });
    } else {
      this.boardProtectionControl.enable({ emitEvent: false });
    }
  }

  copyBoardId() {
    const boardId = this.auth.user?.boardKey;
    if (!boardId) {
      this.snackBar.open('Board ID not available', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }

    if (typeof window !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(boardId).then(() => {
        this.snackBar.open('Board ID copied to clipboard!', 'OK', {
          duration: 3000,
          panelClass: ['success-snackbar'],
        });
      }).catch(() => {
        // Fallback for older browsers
        this.fallbackCopyToClipboard(boardId);
      });
    } else {
      // Fallback for older browsers
      this.fallbackCopyToClipboard(boardId);
    }
  }

  copyLinkToClipboard() {
    if (!this.shareableLink) {
      this.snackBar.open('Board ID not available', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }

    if (typeof window !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(this.shareableLink).then(() => {
        this.snackBar.open('Link copied to clipboard!', 'OK', {
          duration: 3000,
          panelClass: ['success-snackbar'],
        });
      }).catch(() => {
        // Fallback for older browsers
        this.fallbackCopyToClipboard(this.shareableLink);
      });
    } else {
      // Fallback for older browsers
      this.fallbackCopyToClipboard(this.shareableLink);
    }
  }

  async openPreview() {
    // Check for unsaved changes
    if (this.hasUnsavedChanges()) {
      const result = await this.showSaveConfirmation('You have unsaved changes. Would you like to save before previewing?');
      if (result === 'save') {
        await this.saveEditorContent();
      } else if (result === 'cancel') {
        return; // User cancelled
      }
      // If 'discard', continue with preview
    }

    const content = this.contentControl.value;
    if (!content) {
      this.snackBar.open('No content to preview', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }

    // Encode the HTML content and navigate to preview
    const encodedContent = encodeURIComponent(content);
    const queryParams: any = { 
      preview: 'true',
      content: encodedContent,
      size: this.boardSize // Pass board size to preview (from DB)
    };
    
    // Add boardKey if available so preview can save size to RTDB
    if (this.auth.user?.boardKey) {
      queryParams.boardKey = this.auth.user.boardKey;
    }
    
    this.router.navigate(['/preview'], { queryParams });
  }

  hasUnsavedChanges(): boolean {
    const currentContent = this.contentControl.value || '';
    return currentContent !== this.savedContent;
  }

  async showSaveConfirmation(message: string): Promise<'save' | 'discard' | 'cancel'> {
    return new Promise((resolve) => {
      const dialogRef = this.dialog.open(SaveConfirmationDialogComponent, {
        width: '90%',
        maxWidth: '450px',
        disableClose: true,
        data: { message }
      });

      dialogRef.afterClosed().subscribe(result => {
        resolve(result || 'cancel');
      });
    });
  }

  async handleBackNavigation() {
    // Check for unsaved changes
    if (this.hasUnsavedChanges()) {
      const result = await this.showSaveConfirmation('You have unsaved changes. Would you like to save before leaving?');
      if (result === 'save') {
        await this.saveEditorContent();
        this.router.navigate(['/']);
      } else if (result === 'discard') {
        this.router.navigate(['/']);
      }
      // If 'cancel', stay on page
    } else {
      this.router.navigate(['/']);
    }
  }


  async setBoardSize(size: 'min' | 'normal' | 'max') {
    this.boardSize = size;
    // Save to database if user is authenticated and has a board
    if (this.auth.user?.boardKey) {
      try {
        await this.boards.updateBoardSize(this.auth.user.boardKey, size);
        if (this.board) {
          this.board.boardSize = size;
        }
      } catch (e: any) {
        console.error('Failed to save board size:', e);
        // Don't show error to user, just log it
      }
    }
  }

  openLinkDialog() {
    // SSR-safe: Check for browser environment
    if (typeof window === 'undefined') {
      return;
    }

    if (!this.shareableLink) {
      this.snackBar.open('Board ID not available', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }

    const boardId = this.auth.user?.boardKey || '';
    this.dialog.open(LinkDialogComponent, {
      width: '90%',
      maxWidth: '500px',
      data: { link: this.shareableLink, boardId: boardId }
    });
  }

  openEmailDialog() {
    // SSR-safe: Check for browser environment
    if (typeof window === 'undefined') {
      return;
    }

    if (!this.auth.user?.boardKey) {
      this.snackBar.open('User not authenticated', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }

    if (!this.boardProtectionControl.value) {
      this.snackBar.open('Board protection must be enabled', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }

    const currentEmails = (this.emails.value as string[]) || [];
    this.dialog.open(EmailDialogComponent, {
      width: '90%',
      maxWidth: '600px',
      data: {
        emails: [...currentEmails],
        onAddEmail: async (email: string) => {
          await this.addEmailToDialog(email);
        },
        onRemoveEmail: async (email: string) => {
          await this.removeEmailFromDialog(email);
        }
      }
    }).afterClosed().subscribe(() => {
      // Refresh email list after dialog closes
      this.refreshEmailList();
    });
  }

  private async refreshEmailList() {
    if (!this.auth.user?.boardKey || !this.board) {
      return;
    }

    try {
      const updatedBoard = await this.boards.getBoard(this.auth.user.boardKey);
      if (updatedBoard) {
        this.board = updatedBoard;
        this.emails.clear();
        (updatedBoard.authorizedMailList || []).forEach((email) => {
          this.emails.push(new FormControl<string | null>(email));
        });
        this.cdr.detectChanges();
      }
    } catch (e) {
      console.error('Error refreshing email list:', e);
    }
  }

  private async addEmailToDialog(email: string) {
    if (!this.auth.user?.boardKey) {
      throw new Error('User not authenticated');
    }

    const currentList = (this.emails.value as string[]) || [];
    if (currentList.length >= 50) {
      throw new Error('Maximum 50 emails allowed');
    }

    if (currentList.includes(email)) {
      throw new Error('Email already exists');
    }

    await this.boards.addEmailToAuthorizedList(this.auth.user.boardKey, email);
    this.emails.push(new FormControl<string | null>(email));
    if (this.board) {
      this.board.authorizedMailList = this.emails.value as string[];
    }
  }

  private async removeEmailFromDialog(email: string) {
    if (!this.auth.user?.boardKey) {
      throw new Error('User not authenticated');
    }

    const emailList = this.emails.value as string[];
    const index = emailList.findIndex((e: string) => e === email);
    if (index === -1) {
      throw new Error('Email not found');
    }

    await this.boards.removeEmailFromAuthorizedList(this.auth.user.boardKey, email);
    this.emails.removeAt(index);
    if (this.board) {
      this.board.authorizedMailList = this.emails.value as string[];
    }
  }

  private fallbackCopyToClipboard(text: string) {
    if (typeof window === 'undefined') {
      return;
    }
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      this.snackBar.open('Link copied to clipboard!', 'OK', {
        duration: 3000,
        panelClass: ['success-snackbar'],
      });
    } catch (err) {
      this.snackBar.open('Failed to copy link', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
    } finally {
      document.body.removeChild(textArea);
    }
  }

  async ngOnInit() {
    // Ensure loading and saving are false initially
    this.loading = false;
    this.updateFormControlsDisabledState();
    this.saving = false;
    // Board size will be loaded from board data below
    this.cdr.detectChanges();
    
    const user = this.auth.user;
    if (!user) {
      await this.router.navigate(['/login']);
      this.loading = false;
      this.updateFormControlsDisabledState();
      this.cdr.detectChanges();
      return;
    }

    this.loading = true;
    this.updateFormControlsDisabledState();
    this.message = '';
    this.emailControl.disable();
    this.cdr.detectChanges();

    try {
      // Check local storage for board content by email
      let localContent = '';
      if (typeof window !== 'undefined' && user.email) {
        try {
          const stored = localStorage.getItem(`palagai_board_${user.email}`);
          if (stored) {
            localContent = stored;
          }
        } catch (e) {
          console.error('Error reading from local storage:', e);
        }
      }

      // User should already have a board from login flow
      // But handle edge case where board might not exist
      let boardKey = user.boardKey ?? undefined;
      if (!boardKey) {
        // Edge case: user exists but board not created (shouldn't happen after login fix)
        try {
          const created = await this.boards.createBoardForUser(user.uid);
          boardKey = created.boardKey;
          this.auth.updateBoardKey(boardKey);
          this.board = created.board;
          // Store boardKey in sessionStorage for subboard access
          if (typeof window !== 'undefined') {
            sessionStorage.setItem('palagai_session_board_id', boardKey);
          }
        } catch (e: any) {
          throw new Error(`Failed to create board: ${e?.message || 'Unknown error'}`);
        }
      } else {
        // User has boardKey - load the board
        try {
          const existing = await this.boards.getBoard(boardKey);
          if (existing) {
            this.board = existing;
            // Store boardKey in sessionStorage for subboard access
            if (typeof window !== 'undefined') {
              sessionStorage.setItem('palagai_session_board_id', boardKey);
            }
          } else {
            // Board key exists but board not found - create new board
            const created = await this.boards.createBoardForUser(user.uid);
            boardKey = created.boardKey;
            this.auth.updateBoardKey(boardKey);
            this.board = created.board;
            // Store boardKey in sessionStorage for subboard access
            if (typeof window !== 'undefined') {
              sessionStorage.setItem('palagai_session_board_id', boardKey);
            }
          }
        } catch (e: any) {
          throw new Error(`Failed to load board: ${e?.message || 'Unknown error'}`);
        }
      }

      // Prioritize RTDB content over localStorage
      const dbContent = this.board?.message?.html || '';
      const content = dbContent || localContent || '';
      const protection = this.board?.boardProtection ?? false;
      // Check if board is blocked
      if (this.board?.isBlocked) {
        this.snackBar.open('Your board has been blocked. Please contact the ADMIN for retrieving your account.', 'OK', {
          duration: 5000,
          panelClass: ['error-snackbar'],
        });
      }
      const list = this.board?.authorizedMailList ?? [];
      const boardSize = this.board?.boardSize ?? 'normal';

      this.contentControl.setValue(content);
      this.savedContent = content; // Track saved content
      this.boardProtectionControl.setValue(protection);
      this.boardSize = boardSize;
      this.emails.clear();
      list.forEach((email) => {
        this.emails.push(new FormControl<string | null>(email));
      });
    } catch (e: any) {
      const errorMsg = e?.message || 'Error loading board';
      this.message = errorMsg;
      this.snackBar.open(errorMsg, 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    } finally {
      this.loading = false;
      this.updateFormControlsDisabledState();
      this.updateEmailControlState();
      this.cdr.detectChanges();
    }
  }

  ngAfterViewInit() {
    // Custom editor handles its own initialization
    // Check if returning from preview with updated board size
    if (typeof window !== 'undefined') {
      const previewSize = localStorage.getItem('palagai_preview_board_size') as 'min' | 'normal' | 'max' | null;
      if (previewSize && ['min', 'normal', 'max'].includes(previewSize) && previewSize !== this.boardSize) {
        this.boardSize = previewSize;
        // Save to DB immediately
        if (this.auth.user?.boardKey) {
          this.boards.updateBoardSize(this.auth.user.boardKey, previewSize).catch(e => {
            console.error('Failed to save board size:', e);
          });
          if (this.board) {
            this.board.boardSize = previewSize;
          }
        }
        // Clear the preview size from localStorage
        localStorage.removeItem('palagai_preview_board_size');
        this.cdr.detectChanges();
      }
    }
  }

  private updateEmailControlState() {
    const isBoardProtectionEnabled = this.boardProtectionControl.value ?? false;
    if (!isBoardProtectionEnabled || this.loading || this.addingEmail || this.emails.length >= 50) {
      this.emailControl.disable();
    } else {
      this.emailControl.enable();
    }
  }

  async saveEditorContent() {
    if (!this.auth.user?.boardKey) {
      this.snackBar.open('User not authenticated', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }
    
    // Get content and ensure alignment styles are preserved
    let content = this.contentControl.value || '';
    
    // Force normalization by triggering editor input one more time
    // This ensures all alignments are saved as inline styles
    this.contentControl.updateValueAndValidity({ emitEvent: false });
    
    // Get the final content after normalization
    content = this.contentControl.value || '';
    
    // Save board content
    await this.saveBoardContent(content);
  }

  private async saveBoardContent(content: string) {
    this.saving = true;
    this.message = '';
    this.updateEmailControlState();

    try {
      await this.boards.updateBoardMessage(this.auth.user!.boardKey!, content);
      // Save board size to database
      await this.boards.updateBoardSize(this.auth.user!.boardKey!, this.boardSize);
      this.savedContent = content; // Update saved content
      if (this.board) {
        this.board.message.updatedAt = Date.now();
        this.board.message.html = content;
        this.board.boardSize = this.boardSize;
      } else {
        // If board doesn't exist, create it
        this.board = {
          message: {
            html: content,
            updatedAt: Date.now(),
            status: 'active'
          },
          boardProtection: false,
          authorizedMailList: [],
          ownerUid: this.auth.user!.uid,
          userType: 'user',
          planType: 'free',
          createdAt: Date.now(),
          activeDate: new Date().toISOString()
        };
      }
      this.message = 'Board updated successfully';
      this.snackBar.open('Board updated successfully!', 'OK', {
        duration: 3000,
        panelClass: ['success-snackbar'],
      });
    } catch (e: any) {
      const errorMsg = e?.message || 'Error saving board';
      this.message = errorMsg;
      this.snackBar.open(errorMsg, 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    } finally {
      this.saving = false;
      this.updateEmailControlState();
      this.cdr.detectChanges();
    }
  }


  async clearBoard() {
    if (!this.auth.user?.boardKey) {
      this.snackBar.open('User not authenticated', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }
    
    this.clearing = true;
    this.message = '';

    try {
      await this.boards.clearBoardMessage(this.auth.user.boardKey);
      this.contentControl.setValue('');
      this.message = 'Board cleared successfully';
      this.snackBar.open('Board cleared successfully!', 'OK', {
        duration: 3000,
        panelClass: ['success-snackbar'],
      });
    } catch (e: any) {
      const errorMsg = e?.message || 'Error clearing board';
      this.message = errorMsg;
      this.snackBar.open(errorMsg, 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    } finally {
      this.clearing = false;
      this.cdr.detectChanges();
    }
  }

  async toggleBoardProtection(event?: any) {
    if (!this.auth.user?.boardKey) {
      this.snackBar.open('User not authenticated', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      // Revert checkbox if auth fails
      if (event) {
        this.boardProtectionControl.setValue(!event.checked, { emitEvent: false });
      }
      return;
    }
    
    // Get the new value from the event, or from the form control
    const newValue = event?.checked ?? this.boardProtectionControl.value ?? false;
    this.loading = true;
    this.updateFormControlsDisabledState();
    this.message = '';

    try {
      
      // If disabling protection, clear all emails
      if (!newValue && this.emails.length > 0) {
        // Clear emails from Firebase
        await this.boards.updateAuthorizedMailList(this.auth.user.boardKey, []);
        // Clear emails from form
        this.emails.clear();
        if (this.board) {
          this.board.authorizedMailList = [];
        }
      }
      
      await this.boards.updateBoardProtection(this.auth.user.boardKey, newValue);
      this.boardProtectionControl.setValue(newValue);
      if (this.board) {
        this.board.boardProtection = newValue;
      }
      const successMsg = `Board protection ${newValue ? 'enabled' : 'disabled'} successfully`;
      this.message = successMsg;
      this.snackBar.open(successMsg, 'OK', {
        duration: 3000,
        panelClass: ['success-snackbar'],
      });
      this.updateEmailControlState();
    } catch (e: any) {
      const errorMsg = e?.message || 'Error updating board protection';
      this.message = errorMsg;
      // Revert checkbox state on error
      const previousValue = !newValue;
      this.boardProtectionControl.setValue(previousValue, { emitEvent: false });
      if (this.board) {
        this.board.boardProtection = previousValue;
      }
      this.snackBar.open(errorMsg, 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    } finally {
      this.loading = false;
      this.updateFormControlsDisabledState();
      this.updateEmailControlState();
      this.cdr.detectChanges();
    }
  }



  async addEmail() {
    if (!this.auth.user?.boardKey) {
      this.snackBar.open('User not authenticated', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }
    
    const raw = this.emailControl.value?.trim();
    if (!raw) {
      this.snackBar.open('Please enter an email address', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }

    const currentList = (this.emails.value as string[]) || [];
    if (currentList.length >= 50) {
      const errorMsg = 'Maximum 50 emails allowed';
      this.message = errorMsg;
      this.snackBar.open(errorMsg, 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }

    this.addingEmail = true;
    this.message = '';
    this.updateEmailControlState();

    try {
      const email = raw.toLowerCase();
      if (currentList.includes(email)) {
        const errorMsg = 'Email already exists';
        this.message = errorMsg;
        this.addingEmail = false;
        this.updateEmailControlState();
        this.snackBar.open(errorMsg, 'OK', {
          duration: 3000,
          panelClass: ['error-snackbar'],
        });
        return;
      }

      await this.boards.addEmailToAuthorizedList(this.auth.user.boardKey, email);
      this.emails.push(new FormControl<string | null>(email));
      if (this.board) {
        this.board.authorizedMailList = this.emails.value as string[];
      }
      this.emailControl.setValue('');
      this.message = 'Email added successfully';
      this.snackBar.open('Email added successfully!', 'OK', {
        duration: 3000,
        panelClass: ['success-snackbar'],
      });
    } catch (e: any) {
      const errorMsg = e?.message || 'Error adding email';
      this.message = errorMsg;
      this.snackBar.open(errorMsg, 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    } finally {
      this.addingEmail = false;
      this.updateEmailControlState();
      this.cdr.detectChanges();
    }
  }

  async removeEmailAt(index: number) {
    if (!this.auth.user?.boardKey) {
      this.snackBar.open('User not authenticated', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }
    
    const email = this.emails.at(index)?.value;
    if (!email) {
      this.snackBar.open('Email not found', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }

    this.loading = true;
    this.updateFormControlsDisabledState();
    this.message = '';
    this.updateEmailControlState();

    try {
      await this.boards.removeEmailFromAuthorizedList(this.auth.user.boardKey, email);
      this.emails.removeAt(index);
      if (this.board) {
        this.board.authorizedMailList = this.emails.value as string[];
      }
      this.message = 'Email removed successfully';
      this.snackBar.open('Email removed successfully!', 'OK', {
        duration: 3000,
        panelClass: ['success-snackbar'],
      });
    } catch (e: any) {
      const errorMsg = e?.message || 'Error removing email';
      this.message = errorMsg;
      this.snackBar.open(errorMsg, 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    } finally {
      this.loading = false;
      this.updateFormControlsDisabledState();
      this.updateEmailControlState();
      this.cdr.detectChanges();
    }
  }
}

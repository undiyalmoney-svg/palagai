import { Component, OnInit, ChangeDetectorRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { QuillModule } from 'ngx-quill';
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
import { CompetitionDialogComponent } from './competition-dialog.component';

@Component({
  selector: 'app-mainboard',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    QuillModule,
    RouterLink,
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

  form: FormGroup;
  emailControl = new FormControl<string | null>('', [Validators.email]);
  addingEmail = false;

  quillModules = {
    toolbar: [
      [{ 'font': ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana'] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'header': [1, 2, 3, false] }],
      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
      [{ 'align': [] }],
      ['link'],
      ['clean']
    ],
  };

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
      isSubmittedForCompetition: [false],
      emails: this.fb.array<FormControl<string | null>>([]),
    });
    
    // Register Quill fonts in constructor to ensure they're available before editor init
    this.registerQuillFonts();
  }

  private registerQuillFonts() {
    if (typeof window !== 'undefined') {
      const register = () => {
        const Quill = (window as any).Quill;
        if (Quill && Quill.import) {
          try {
            const Font = Quill.import('formats/font');
            Font.whitelist = ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana'];
            Quill.register(Font, true);
          } catch (e) {
            // Font already registered or Quill not ready
          }
        }
      };
      
      // Try immediately
      register();
      // Also try after delays in case Quill loads asynchronously
      setTimeout(register, 0);
      setTimeout(register, 100);
    }
  }

  get contentControl(): FormControl<string | null> {
    return this.form.get('content') as FormControl<string | null>;
  }

  get boardProtectionControl(): FormControl<boolean | null> {
    return this.form.get('boardProtection') as FormControl<boolean | null>;
  }

  get competitionSubmissionControl(): FormControl<boolean | null> {
    return this.form.get('isSubmittedForCompetition') as FormControl<boolean | null>;
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
    return `${baseUrl}/?id=${this.auth.user.boardKey}`;
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

  openPreview() {
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
    this.router.navigate(['/preview'], { 
      queryParams: { 
        preview: 'true',
        content: encodedContent 
      } 
    });
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
    this.saving = false;
    this.cdr.detectChanges();
    
    const user = this.auth.user;
    if (!user) {
      await this.router.navigate(['/login']);
      this.loading = false;
      this.cdr.detectChanges();
      return;
    }

    this.loading = true;
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

      // Use local storage content if available, otherwise use board content
      const content = localContent || this.board?.message?.html || '';
      const protection = this.board?.boardProtection ?? false;
      const competitionSubmission = this.board?.isSubmittedForCompetition ?? false;
      const list = this.board?.authorizedMailList ?? [];

      this.contentControl.setValue(content);
      this.boardProtectionControl.setValue(protection);
      this.competitionSubmissionControl.setValue(competitionSubmission);
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
      this.updateEmailControlState();
      this.cdr.detectChanges();
    }
  }

  ngAfterViewInit() {
    // Ensure Quill fonts are registered after view init
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        const Quill = (window as any).Quill;
        if (Quill) {
          try {
            const Font = Quill.import('formats/font');
            Font.whitelist = ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana'];
            Quill.register(Font, true);
          } catch (e) {
            console.warn('Could not register Quill fonts:', e);
          }
        }
      }, 100);
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
    
    const content = this.contentControl.value || '';
    this.saving = true;
    this.message = '';
    this.updateEmailControlState();

    try {
      await this.boards.updateBoardMessage(this.auth.user.boardKey, content);
      if (this.board) {
        this.board.message.updatedAt = Date.now();
        this.board.message.html = content;
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
          ownerUid: this.auth.user.uid,
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
      this.updateEmailControlState();
      this.cdr.detectChanges();
    }
  }

  openCompetitionDialog() {
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

    this.dialog.open(CompetitionDialogComponent, {
      width: '90%',
      maxWidth: '500px',
      data: {
        onSubmit: async () => {
          await this.submitToCompetition();
        }
      }
    });
  }

  async submitToCompetition() {
    if (!this.auth.user?.boardKey) {
      throw new Error('User not authenticated');
    }

    this.loading = true;
    this.message = '';

    try {
      await this.boards.updateCompetitionSubmission(this.auth.user.boardKey, true);
      this.competitionSubmissionControl.setValue(true);
      if (this.board) {
        this.board.isSubmittedForCompetition = true;
      }
      const successMsg = 'Your Kavithai has been submitted for the competition!';
      this.message = successMsg;
      this.snackBar.open(successMsg, 'OK', {
        duration: 3000,
        panelClass: ['success-snackbar'],
      });
    } catch (e: any) {
      const errorMsg = e?.message || 'Error submitting to competition';
      this.message = errorMsg;
      this.snackBar.open(errorMsg, 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
      throw e; // Re-throw so dialog can handle it
    } finally {
      this.loading = false;
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
      this.updateEmailControlState();
      this.cdr.detectChanges();
    }
  }
}

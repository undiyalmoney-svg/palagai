import { Component, OnInit, ChangeDetectorRef, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
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
import { MatSelectModule } from '@angular/material/select';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { LinkDialogComponent } from './link-dialog.component';
import { EmailDialogComponent } from './email-dialog.component';
import { SaveConfirmationDialogComponent } from './save-confirmation-dialog.component';
import { CustomEditorComponent } from './custom-editor/custom-editor.component';
import { PollPaymentDialogComponent } from './poll-payment-dialog.component';
import { PollEditorComponent } from './poll-editor/poll-editor.component';
import { PollSaveDialogComponent, PollSaveDialogData, PollSaveDialogResult } from './poll-save-dialog.component';
import { PrimaryBoardInfoDialogComponent } from './primary-board-info-dialog.component';
import { AlertService } from '../shared/alert.service';
import { PollData } from '../board.service';

@Component({
  selector: 'app-mainboard',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    CustomEditorComponent,
    PollEditorComponent,
    MatToolbarModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatCardModule,
    MatCheckboxModule,
    MatIconModule,
    MatSnackBarModule,
    MatDialogModule,
    MatSelectModule,
    MatMenuModule,
    MatTooltipModule,
    MatDividerModule,
  ],
  templateUrl: './mainboard.html',
  styleUrl: './mainboard.css',
})
export class Mainboard implements OnInit, AfterViewInit {
  @ViewChild('pollEditor', { static: false }) pollEditor?: PollEditorComponent;
  
  loading = false;
  saving = false;
  clearing = false;
  board: Board | null = null;
  fabMenuOpen = false;
  boardSize: 'min' | 'normal' | 'max' = 'normal'; // Board size control
  private savedContent = ''; // Track saved content for unsaved changes detection
  boardType: 'standard' | 'poll' = 'standard'; // Board type
  pollData: PollData | null = null; // Current poll data

  form: FormGroup;
  emailControl = new FormControl<string | null>('', [Validators.email]);
  addingEmail = false;
  isPrimaryBoard = false; // Primary board option

  constructor(
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    public readonly auth: AuthService,
    private readonly boards: BoardService,
    private readonly fb: FormBuilder,
    private readonly snackBar: MatSnackBar,
    private readonly dialog: MatDialog,
    private readonly alertService: AlertService,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.form = this.fb.group({
      content: [''],
      boardProtection: [false],
      emails: this.fb.array<FormControl<string | null>>([]),
      isPrimaryBoard: [false],
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

  get isPrimaryBoardControl(): FormControl<boolean> {
    return this.form.get('isPrimaryBoard') as FormControl<boolean>;
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

  get isPollBoard(): boolean {
    return this.boardType === 'poll' || this.board?.boardType === 'poll';
  }

  get hasPollData(): boolean {
    return this.isPollBoard && this.pollData !== null;
  }

  toggleFabMenu(): void {
    this.fabMenuOpen = !this.fabMenuOpen;
  }

  openPrimaryBoardInfo(): void {
    this.dialog.open(PrimaryBoardInfoDialogComponent, {
      width: '90%',
      maxWidth: '450px',
    });
  }

  get canModifyPoll(): boolean {
    // Poll can only be modified if it hasn't been created yet (no pollCreatedAt)
    if (!this.board || !this.isPollBoard) {
      return true;
    }
    return !this.board.pollCreatedAt;
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
      this.alertService.error('Board ID not available');
      return;
    }

    if (typeof window !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(boardId).then(() => {
        this.alertService.success('Board ID copied to clipboard!');
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
      this.alertService.error('Board ID not available');
      return;
    }

    if (typeof window !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(this.shareableLink).then(() => {
        this.alertService.success('Link copied to clipboard!');
      }).catch(() => {
        // Fallback for older browsers
        this.fallbackCopyToClipboard(this.shareableLink);
      });
    } else {
      // Fallback for older browsers
      this.fallbackCopyToClipboard(this.shareableLink);
    }
  }

  goBack() {
    // Check if we came from dashboard (via query params)
    const queryParams = this.route.snapshot.queryParams;
    if (queryParams['boardKey']) {
      // Came from dashboard, go back to dashboard
      this.router.navigate(['/dashboard']);
    } else {
      // Check if user is logged in
      if (this.auth.user) {
        // User is logged in, go to dashboard
        this.router.navigate(['/dashboard']);
      } else {
        // Not logged in, go to home
        this.router.navigate(['/']);
      }
    }
  }

  async openPreview() {
    // For poll boards, check if poll data exists
    if (this.boardType === 'poll') {
      if (!this.pollEditor) {
        this.alertService.error('Please fill in the poll details first');
        return;
      }
      
      const pollForm = this.pollEditor.pollForm;
      if (!pollForm.valid) {
        this.alertService.error('Please complete the poll question and at least 2 options');
        return;
      }

      // Get poll data from editor
      const question = pollForm.get('question')?.value || '';
      const optionsArray = pollForm.get('options') as FormArray;
      const options = optionsArray.controls
        .map(control => control.value)
        .filter(text => text && text.trim());

      if (options.length < 2) {
        this.alertService.error('Poll must have at least 2 options');
        return;
      }

      // Create poll data for preview
      const previewPollData: PollData = {
        question: question,
        options: options.map((text, index) => ({ 
          id: `option-${index}-${Date.now()}`,
          text: text.trim(),
          voteCount: 0
        })),
        pollType: 'single', // Default for preview
        showResults: 'after-vote', // Default value
        allowVoteChange: false, // Default value
        totalVotes: 0,
        endDate: undefined,
        createdAt: Date.now()
      };

      // Navigate to preview with poll data
      // Don't manually encode - Angular Router will handle encoding
      const queryParams: any = {
        preview: 'true',
        pollPreview: 'true',
        pollData: JSON.stringify(previewPollData),
        returnTo: 'mainboard'
      };

      if (this.auth.user?.boardKey) {
        queryParams.boardKey = this.auth.user.boardKey;
      }

      this.router.navigate(['/preview'], { queryParams });
      return;
    }

    // For standard boards, check for unsaved changes
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
      this.alertService.error('No content to preview');
      return;
    }

    // Encode the HTML content and navigate to preview
    const encodedContent = encodeURIComponent(content);
    const queryParams: any = { 
      preview: 'true',
      content: encodedContent,
      size: this.boardSize, // Pass board size to preview (from DB)
      returnTo: 'mainboard' // Track that we came from mainboard for back navigation
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
      this.alertService.error('Board ID not available');
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
      this.alertService.error('User not authenticated');
      return;
    }

    if (!this.boardProtectionControl.value) {
      this.alertService.error('Board protection must be enabled');
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
      this.alertService.success('Link copied to clipboard!');
    } catch (err) {
      this.alertService.error('Failed to copy link');
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

      // Check for query params (boardKey and type from dashboard)
      const queryParams = this.route.snapshot.queryParams;
      const boardKeyFromQuery = queryParams['boardKey'] as string | undefined;
      const boardTypeFromQuery = queryParams['type'] as 'standard' | 'poll' | undefined;
      
      // User should already have a board from login flow
      // But handle edge case where board might not exist
      let boardKey = boardKeyFromQuery || (user.boardKey ?? undefined);
      
      // If editing a specific board from query params, load it first
      if (boardKeyFromQuery) {
        try {
          const targetBoard = await this.boards.getBoard(boardKeyFromQuery);
          if (!targetBoard) {
            this.alertService.error('Board not found');
            await this.router.navigate(['/dashboard']);
            this.loading = false;
            this.cdr.detectChanges();
            return;
          }
          
          if (targetBoard.ownerUid !== user.uid) {
            this.alertService.error('You do not have permission to edit this board');
            await this.router.navigate(['/dashboard']);
            this.loading = false;
            this.cdr.detectChanges();
            return;
          }
          
          // User owns this board, use it
          this.board = targetBoard;
          boardKey = boardKeyFromQuery;
          // Set board type - use query param if valid, otherwise use board's type, default to 'standard'
          if (boardTypeFromQuery === 'poll' || boardTypeFromQuery === 'standard') {
            this.boardType = boardTypeFromQuery;
          } else if (targetBoard.boardType === 'poll') {
            this.boardType = 'poll';
          } else {
            this.boardType = 'standard';
          }
          if (this.boardType === 'poll' && targetBoard.pollData) {
            this.pollData = targetBoard.pollData;
          } else {
            this.pollData = null;
          }
          
          // Store boardKey in sessionStorage for subboard access
          if (typeof window !== 'undefined') {
            sessionStorage.setItem('palagai_session_board_id', boardKey);
          }
          
          // Skip the rest of the board loading logic since we already have the board
          // Continue to form initialization below
        } catch (e: any) {
          this.alertService.error('Board not found');
          await this.router.navigate(['/dashboard']);
          this.loading = false;
          this.cdr.detectChanges();
          return;
        }
      }
      
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
      } else if (!this.board) {
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

      // Load board type and poll data (only if not already set from query params)
      if (!boardKeyFromQuery) {
        // Not editing a specific board - use default board type
        this.boardType = this.board?.boardType || 'standard';
        if (this.board?.boardType === 'poll' && this.board.pollData) {
          this.pollData = this.board.pollData;
        } else {
          this.pollData = null;
        }
      }
      // If boardKeyFromQuery exists, board type and poll data are already set above

      // Prioritize RTDB content over localStorage
      const dbContent = this.board?.message?.html || '';
      const content = dbContent || localContent || '';
      const protection = this.board?.boardProtection ?? false;
      // Check if board is blocked
      if (this.board?.isBlocked) {
        this.alertService.error('Your board has been blocked. Please contact the ADMIN for retrieving your account.');
      }
      const list = this.board?.authorizedMailList ?? [];
      const boardSize = this.board?.boardSize ?? 'normal';

      this.contentControl.setValue(content);
      this.savedContent = content; // Track saved content
      this.boardProtectionControl.setValue(protection);
      this.boardSize = boardSize;
      this.isPrimaryBoard = this.board?.isPrimaryBoard ?? false;
      this.isPrimaryBoardControl.setValue(this.isPrimaryBoard, { emitEvent: false });
      this.emails.clear();
      list.forEach((email) => {
        this.emails.push(new FormControl<string | null>(email));
      });
    } catch (e: any) {
      const errorMsg = e?.message || 'Error loading board';
      this.alertService.error(errorMsg);
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
      this.alertService.error('User not authenticated');
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
    this.updateEmailControlState();

    try {
      await this.boards.updateBoardMessage(this.auth.user!.boardKey!, content);
      // Save board size to database
      await this.boards.updateBoardSize(this.auth.user!.boardKey!, this.boardSize);
      // Save primary board status (only if changed)
      const isPrimary = this.isPrimaryBoardControl.value ?? false;
      if (isPrimary !== (this.board?.isPrimaryBoard ?? false)) {
        await this.boards.updatePrimaryBoardStatus(this.auth.user!.boardKey!, isPrimary);
      }
      this.savedContent = content; // Update saved content
      if (this.board) {
        this.board.message.updatedAt = Date.now();
        this.board.message.html = content;
        this.board.boardSize = this.boardSize;
        this.board.isPrimaryBoard = isPrimary;
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
          activeDate: new Date().toISOString(),
          isPrimaryBoard: isPrimary
        };
      }
      this.alertService.success('Board updated successfully!');
    } catch (e: any) {
      const errorMsg = e?.message || 'Error saving board';
      this.alertService.error(errorMsg);
    } finally {
      this.saving = false;
      this.updateEmailControlState();
      this.cdr.detectChanges();
    }
  }


  async clearBoard() {
    if (!this.auth.user?.boardKey) {
      this.alertService.error('User not authenticated');
      return;
    }
    
    this.clearing = true;

    try {
      if (this.isPollBoard) {
        // Clear poll
        await this.boards.convertPollToStandard(this.auth.user.boardKey);
        this.boardType = 'standard';
        this.pollData = null;
        if (this.board) {
          this.board.boardType = 'standard';
          this.board.pollData = undefined;
        }
      } else {
        // Clear standard board
        await this.boards.clearBoardMessage(this.auth.user.boardKey);
        this.contentControl.setValue('');
      }
      this.alertService.success('Board cleared successfully!');
    } catch (e: any) {
      const errorMsg = e?.message || 'Error clearing board';
      this.alertService.error(errorMsg);
    } finally {
      this.clearing = false;
      this.cdr.detectChanges();
    }
  }

  async savePoll(pollData: Partial<PollData>) {
    if (!this.auth.user?.boardKey) {
      this.alertService.error('User not authenticated');
      return;
    }

    // Check if poll already exists and can't be modified
    if (this.board?.pollCreatedAt) {
      this.alertService.error('Poll cannot be modified after creation. You can only delete it.');
      return;
    }

    // Validate that we have question and options
    if (!pollData.question || !pollData.options || pollData.options.length < 2) {
      this.alertService.error('Poll must have a question and at least 2 options');
      return;
    }

    // Show save dialog to get settings
    const dialogData: PollSaveDialogData = {
      question: pollData.question,
      options: pollData.options.map(opt => opt.text),
    };

    const dialogRef = this.dialog.open(PollSaveDialogComponent, {
      width: '90%',
      maxWidth: '500px',
      disableClose: true,
      data: dialogData,
    });

    dialogRef.afterClosed().subscribe(async (result: PollSaveDialogResult | null) => {
      if (!result) {
        // User cancelled
        return;
      }

      // Now save with settings
      this.saving = true;

      try {
        const completePollData: PollData = {
          question: pollData.question!,
          options: pollData.options!,
          pollType: result.allowMultiple ? 'multiple' : 'single',
          showResults: 'after-vote', // Default value
          allowVoteChange: false, // Default value
          totalVotes: 0,
          createdAt: pollData.createdAt || Date.now(),
          endDate: result.endDate.getTime(),
        };

        const boardKey = this.auth.user?.boardKey;
        if (!boardKey) {
          this.alertService.error('User not authenticated');
          this.saving = false;
          this.cdr.detectChanges();
          return;
        }

        await this.boards.createPoll(boardKey, completePollData);
        // Save primary board status for poll boards too (only if changed)
        const isPrimary = this.isPrimaryBoardControl.value ?? false;
        if (isPrimary !== (this.board?.isPrimaryBoard ?? false)) {
          await this.boards.updatePrimaryBoardStatus(boardKey, isPrimary);
        }
        this.pollData = completePollData;
        this.boardType = 'poll';
        if (this.board) {
          this.board.boardType = 'poll';
          this.board.pollData = completePollData;
          this.board.pollCreatedAt = Date.now();
          this.board.isPrimaryBoard = isPrimary;
        }
        this.alertService.success('Poll saved successfully! You cannot modify it after creation.');
      } catch (e: any) {
        const errorMsg = e?.message || 'Error saving poll';
        this.alertService.error(errorMsg);
      } finally {
        this.saving = false;
        this.cdr.detectChanges();
      }
    });
  }

  async deletePoll() {
    if (!this.auth.user?.boardKey) {
      return;
    }

    const confirmed = confirm('Are you sure you want to delete this poll? This action cannot be undone.');
    if (!confirmed) {
      return;
    }

    this.saving = true;
    try {
      await this.boards.deletePoll(this.auth.user.boardKey);
      this.pollData = null;
      this.boardType = 'standard';
      if (this.board) {
        this.board.boardType = 'standard';
        this.board.pollData = undefined;
        this.board.pollCreatedAt = undefined;
      }
      this.alertService.success('Poll deleted successfully');
    } catch (e: any) {
      this.alertService.error(e?.message || 'Failed to delete poll');
    } finally {
      this.saving = false;
      this.cdr.detectChanges();
    }
  }

  async handleBoardTypeChange(newType: 'standard' | 'poll') {
    // If switching from poll to standard, show payment dialog
    if (this.boardType === 'poll' && newType === 'standard' && this.board?.pollCreatedAt) {
      const dialogRef = this.dialog.open(PollPaymentDialogComponent, {
        width: '90%',
        maxWidth: '450px',
        disableClose: true,
        data: {
          onCancel: () => {
            // Revert to poll
            this.boardType = 'poll';
            this.cdr.detectChanges();
          },
          onContact: () => {
            // Open email client
            window.location.href = 'mailto:palagaiofficial@gmail.com?subject=Multiple Board Request';
          }
        }
      });

      dialogRef.afterClosed().subscribe((result) => {
        // If user didn't cancel, they can proceed (but we'll still show the message)
        // Actually, we should prevent the switch
        if (this.boardType === 'poll') {
          // User cancelled, keep poll
        }
      });
    } else {
      // Allow the switch
      this.boardType = newType;
      this.cdr.detectChanges();
    }
  }

  clearPoll() {
    this.pollData = null;
    this.cdr.detectChanges();
  }


  async saveFromHeader() {
    // Unified save method for poll and standard board
    if (this.boardType === 'poll') {
      // Save poll
      if (this.pollEditor && this.canModifyPoll) {
        this.pollEditor.savePollFromParent();
      } else if (!this.canModifyPoll) {
        this.alertService.info('Poll cannot be modified after creation');
      } else {
        this.alertService.info('Please fill in the poll details first');
      }
    } else {
      // Save standard board
      await this.saveEditorContent();
    }
  }

  async savePollFromFooter() {
    // Trigger save from poll editor component
    if (this.pollEditor && this.canModifyPoll) {
      this.pollEditor.savePollFromParent();
    } else if (!this.canModifyPoll) {
      this.alertService.info('Poll cannot be modified after creation');
    } else {
      this.alertService.info('Please fill in the poll details first');
    }
  }

  toggleBoardType() {
    if (this.boardType === 'standard') {
      this.boardType = 'poll';
    } else {
      this.boardType = 'standard';
    }
    this.cdr.detectChanges();
  }

  viewPollResults() {
    if (!this.auth.user?.boardKey) {
      return;
    }
    this.router.navigate(['/poll', this.auth.user.boardKey, 'results']);
  }

  toggleBoardProtectionManual() {
    const currentValue = this.boardProtectionControl.value;
    this.boardProtectionControl.setValue(!currentValue);
    this.toggleBoardProtection();
  }

  async toggleBoardProtection(event?: any) {
    if (!this.auth.user?.boardKey) {
      this.alertService.error('User not authenticated');
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
      this.alertService.success(successMsg);
      this.updateEmailControlState();
    } catch (e: any) {
      const errorMsg = e?.message || 'Error updating board protection';
      // Revert checkbox state on error
      const previousValue = !newValue;
      this.boardProtectionControl.setValue(previousValue, { emitEvent: false });
      if (this.board) {
        this.board.boardProtection = previousValue;
      }
      this.alertService.error(errorMsg);
    } finally {
      this.loading = false;
      this.updateFormControlsDisabledState();
      this.updateEmailControlState();
      this.cdr.detectChanges();
    }
  }



  async addEmail() {
    if (!this.auth.user?.boardKey) {
      this.alertService.error('User not authenticated');
      return;
    }
    
    const raw = this.emailControl.value?.trim();
    if (!raw) {
      this.alertService.error('Please enter an email address');
      return;
    }

    const currentList = (this.emails.value as string[]) || [];
    if (currentList.length >= 50) {
      const errorMsg = 'Maximum 50 emails allowed';
      this.alertService.error(errorMsg);
      return;
    }

    this.addingEmail = true;
    this.updateEmailControlState();

    try {
      const email = raw.toLowerCase();
      if (currentList.includes(email)) {
        const errorMsg = 'Email already exists';
        this.alertService.error(errorMsg);
        this.addingEmail = false;
        this.updateEmailControlState();
        return;
      }

      await this.boards.addEmailToAuthorizedList(this.auth.user.boardKey, email);
      this.emails.push(new FormControl<string | null>(email));
      if (this.board) {
        this.board.authorizedMailList = this.emails.value as string[];
      }
      this.emailControl.setValue('');
      this.alertService.success('Email added successfully!');
    } catch (e: any) {
      const errorMsg = e?.message || 'Error adding email';
      this.alertService.error(errorMsg);
    } finally {
      this.addingEmail = false;
      this.updateEmailControlState();
      this.cdr.detectChanges();
    }
  }

  async removeEmailAt(index: number) {
    if (!this.auth.user?.boardKey) {
      this.alertService.error('User not authenticated');
      return;
    }
    
    const email = this.emails.at(index)?.value;
    if (!email) {
      this.alertService.error('Email not found');
      return;
    }

    this.loading = true;
    this.updateFormControlsDisabledState();
    this.updateEmailControlState();

    try {
      await this.boards.removeEmailFromAuthorizedList(this.auth.user.boardKey, email);
      this.emails.removeAt(index);
      if (this.board) {
        this.board.authorizedMailList = this.emails.value as string[];
      }
      this.alertService.success('Email removed successfully!');
    } catch (e: any) {
      const errorMsg = e?.message || 'Error removing email';
      this.alertService.error(errorMsg);
    } finally {
      this.loading = false;
      this.updateFormControlsDisabledState();
      this.updateEmailControlState();
      this.cdr.detectChanges();
    }
  }

  async onPrimaryBoardChange(event: any) {
    const isChecked = (event?.target as any)?.checked ?? event?.checked ?? false;
    
    // If unchecking, just update the form value (no action needed)
    if (!isChecked) {
      return;
    }
    
    // If checking, check if user already has a primary board
    try {
      const user = this.auth.user;
      if (!user?.uid) {
        return;
      }
      
      // Get all user boards to check for existing primary board
      const userBoards = await this.boards.getUserBoards(user.uid);
      const existingPrimaryBoard = userBoards.find(
        item => item.board.isPrimaryBoard && 
                item.boardKey !== user.boardKey
      );
      
      if (existingPrimaryBoard) {
        // User already has a primary board
        const existingBoardType = existingPrimaryBoard.board.boardType === 'poll' ? 'poll board' : 'standard board';
        const currentBoardType = this.boardType === 'poll' ? 'poll board' : 'standard board';
        
        // Special message for poll board when standard board is primary
        if (this.boardType === 'poll' && existingPrimaryBoard.board.boardType === 'standard') {
          const confirmed = confirm(
            'You already have a standard board selected as primary. Are you sure you want to change the poll board as primary?'
          );
          
          if (!confirmed) {
            // Revert the checkbox
            this.isPrimaryBoardControl.setValue(false, { emitEvent: false });
            return;
          }
        } else {
          // General confirmation for other cases
          const confirmed = confirm(
            `You already have a ${existingBoardType} selected as primary. Are you sure you want to change this ${currentBoardType} as primary?`
          );
          
          if (!confirmed) {
            this.isPrimaryBoardControl.setValue(false, { emitEvent: false });
            return;
          }
        }
        
        // User confirmed - unset the other primary board
        await this.boards.updatePrimaryBoardStatus(existingPrimaryBoard.boardKey, false);
      }
    } catch (e: any) {
      console.error('Error checking primary board:', e);
      // Revert the checkbox on error
      const primaryControl = this.form.get('isPrimaryBoard');
      if (primaryControl) {
        (primaryControl as FormControl<boolean>).setValue(false, { emitEvent: false });
      }
      this.alertService.error('Error checking primary board status');
    }
  }
}

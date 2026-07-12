import { Component, OnInit, ChangeDetectorRef, AfterViewInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormControl } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs/operators';
import { Board, BoardService, PollData } from '../board.service';
import { AuthService } from '../auth.service';
import { AdminService } from '../admin.service';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { BoardIdDialogComponent, BoardIdDialogData } from './board-id-dialog.component';
import { SaveConfirmationDialogComponent } from '../mainboard/save-confirmation-dialog.component';
import { PollDisplayComponent } from './poll-display/poll-display.component';
import { AlertService } from '../shared/alert.service';
import { TermsConditionsDialogComponent } from './terms-conditions-dialog.component';
const SESSION_BOARD_KEY = 'palagai_session_board_id';

// Obfuscated localStorage keys (made to look like app preferences/analytics)
const VOTED_BOARDS_KEY = 'app_pref_cache_v2'; // Stores voted board IDs
const USER_ANALYTICS_ID = 'usr_analytics_id'; // Stores user session/analytics ID

// Initialize dummy localStorage keys to obfuscate voting data
function initializeDummyLocalStorage() {
  if (typeof window === 'undefined') return;
  
  try {
    // Add dummy keys that look like normal app preferences
    if (!localStorage.getItem('ui_theme_pref')) {
      localStorage.setItem('ui_theme_pref', 'light');
    }
    if (!localStorage.getItem('last_visit_ts')) {
      localStorage.setItem('last_visit_ts', Date.now().toString());
    }
    if (!localStorage.getItem('cache_ver')) {
      localStorage.setItem('cache_ver', '1.0');
    }
    if (!localStorage.getItem('lang_pref')) {
      localStorage.setItem('lang_pref', 'en');
    }
    if (!localStorage.getItem('app_metrics_enabled')) {
      localStorage.setItem('app_metrics_enabled', 'true');
    }
  } catch (e) {
    // Ignore localStorage errors
  }
}

@Component({
  selector: 'app-subboard',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatToolbarModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatCardModule,
    MatSnackBarModule,
    MatIconModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    PollDisplayComponent,
  ],
  templateUrl: './subboard.html',
  styleUrls: ['./subboard.css', './display-renderer.css'],
})
export class Subboard implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('kioskMessageContent', { static: false }) kioskMessageContent?: ElementRef<HTMLDivElement>;
  
  form!: FormGroup;
  loading = false;
  error = '';
  board: Board | null = null;
  isFullPage = false;
  isPreviewMode = false;
  showEmailInput = false; // Show email input only if board is protected
  showLandingPage = true; // Show landing page when no board is loaded
  boardSize: 'min' | 'normal' | 'max' = 'normal'; // Board size control
  savedBoardSize: 'min' | 'normal' | 'max' = 'normal'; // Track saved board size for unsaved changes
  private loadingFromQueryParam = false; // Track if board was loaded from query param
  private _lastUpdated: number | null = null;
  private autoScrollInterval?: number;
  private isScrolling = false;
  private scrollDirection: 'down' | 'up' = 'down';
  private boardUnsubscribe?: () => void; // Firebase listener unsubscribe function
  private queryParamsSubscription?: Subscription; // Query params subscription
  private lastLoadedBoardId: string | null = null; // Track last loaded board to prevent duplicates
  private hasShownLoadSuccess: boolean = false; // Track if success message already shown for current load
  currentBoardKey: string | null = null; // Store current board key for voting
  voteCount: number = 0;
  isVoting: boolean = false;
  userIP: string = '';
  isInCompetition: boolean = false; // Property instead of getter to avoid NG0100
  hasVotedInSession: boolean = false; // Track if user voted in current session
  cameFromCompetition: boolean = false; // Track if user came from competition page
  primaryBoards: Array<{ boardKey: string; board: Board; ownerEmail?: string }> = []; // Primary boards to display

  readonly defaultHtml = '<p>Enter a board ID and load a Palagai board.</p>';
  readonly backgroundImageUrl = '/doodle-background.png';

  constructor(
    private readonly boards: BoardService,
    private readonly snackBar: MatSnackBar,
    private readonly cdr: ChangeDetectorRef,
    private readonly fb: FormBuilder,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly sanitizer: DomSanitizer,
    private readonly dialog: MatDialog,
    private readonly alertService: AlertService,
    private readonly auth: AuthService,
    private readonly admin: AdminService,
  ) {
    // Initialize form - use try-catch for SSR safety
    // FormBuilder should always be available via DI, but add safety for edge cases
    try {
      // Check if FormBuilder is available and has the group method
      if (this.fb != null && this.fb != undefined && typeof (this.fb as any).group === 'function') {
        this.form = this.fb.group({
          boardId: ['', [Validators.required]],
          email: ['', [Validators.email]],
        });
      } else {
        // Fallback: create form using FormGroup/FormControl directly (for SSR)
        this.form = new FormGroup({
          boardId: new FormControl('', [Validators.required]),
          email: new FormControl('', [Validators.email]),
        });
      }
    } catch (e) {
      // Ultimate fallback for SSR - create form directly
      this.form = new FormGroup({
        boardId: new FormControl('', [Validators.required]),
        email: new FormControl('', [Validators.email]),
      });
    }
  }

  async ngOnInit() {
    // Initialize dummy localStorage keys asynchronously (non-blocking)
    if (typeof window !== 'undefined') {
      setTimeout(() => initializeDummyLocalStorage(), 0);
    }
    
    // Check query params synchronously first (before subscription) to prevent landing page flash
    const snapshotParams = this.route.snapshot.queryParams;
    const boardIdFromSnapshot = snapshotParams['id'];
    const fromCompetitionSnapshot = snapshotParams['from'] === 'competition';
    const isPreviewSnapshot = snapshotParams['preview'] === 'true';
    const previewContentSnapshot = snapshotParams['content'];
    const isPollPreviewSnapshot = snapshotParams['pollPreview'] === 'true';
    const previewPollDataSnapshot = snapshotParams['pollData'];
    
    // Handle preview mode synchronously (no landing page flash)
    if (isPreviewSnapshot && (previewContentSnapshot || (isPollPreviewSnapshot && previewPollDataSnapshot))) {
      this.showLandingPage = false;
      this.isPreviewMode = true;
      // Process preview immediately from snapshot params
      await this.processQueryParams(snapshotParams);
      return; // Early return since preview is handled
    }
    // If board ID exists in URL, redirect to new fullscreen route
    else if (boardIdFromSnapshot && typeof boardIdFromSnapshot === 'string' && boardIdFromSnapshot.trim()) {
      const trimmedId = boardIdFromSnapshot.trim();
      // Redirect to new fullscreen board route
      this.router.navigate(['/board', trimmedId]);
      return; // Early return to prevent subscription setup
    }
    
    // Process initial params immediately (no debounce) for faster page load
    // Only process if not already handled above (preview/redirect cases)
    if (!isPreviewSnapshot && !boardIdFromSnapshot) {
      await this.processQueryParams(snapshotParams);
    }
    
    // Check for preview mode first
    // Use debounce to prevent multiple rapid fires (only for subsequent changes)
    let isFirstEmission = true;
    this.queryParamsSubscription = this.route.queryParams.pipe(
      debounceTime(150),
      skip(1) // Skip first emission since we already processed snapshot params
    ).subscribe(async params => {
      // For subsequent changes, process normally
      await this.processQueryParams(params);
    });
  }

  private async processQueryParams(params: any) {
    const isPreview = params['preview'] === 'true';
    const isPollPreview = params['pollPreview'] === 'true';
    const previewContent = params['content'];
    const previewPollData = params['pollData'];
    
    if (isPreview && isPollPreview && previewPollData) {
      // Poll preview mode
      this.isPreviewMode = true;
      this.showLandingPage = false; // Hide landing page for preview
      try {
        // Angular Router automatically decodes query params once
        // Try parsing directly first (normal case - router decoded it)
        let decodedPollData: any;
        try {
          decodedPollData = JSON.parse(previewPollData);
        } catch (e) {
          // If direct parse fails, it might be double-encoded (legacy URLs)
          // Try decoding once more
          try {
            const decoded = decodeURIComponent(previewPollData);
            decodedPollData = JSON.parse(decoded);
          } catch (e2) {
            // Still failed - might be triple encoded or invalid
            throw new Error('Failed to decode poll data: ' + (e2 instanceof Error ? e2.message : 'Unknown error'));
          }
        }
        
        // Validate decoded poll data
        if (!decodedPollData || typeof decodedPollData !== 'object') {
          throw new Error('Invalid poll data structure');
        }
        if (!decodedPollData.question || typeof decodedPollData.question !== 'string') {
          throw new Error('Poll question is missing or invalid');
        }
        if (!decodedPollData.options || !Array.isArray(decodedPollData.options) || decodedPollData.options.length < 2) {
          throw new Error('Poll must have at least 2 options');
        }
        
        // Ensure all options have required fields
        decodedPollData.options = decodedPollData.options.map((opt: any, index: number) => ({
          id: opt.id || `option-${index}-${Date.now()}`,
          text: opt.text || '',
          voteCount: opt.voteCount || 0
        }));
        
        const now = Date.now();
        
        // For preview, use empty boardKey to prevent Firebase loading
        this.currentBoardKey = '';
        
        // Get board size from params or default to 'normal'
        const sizeParam = params['size'] as 'min' | 'normal' | 'max' | undefined;
        const boardSizeValue: 'min' | 'normal' | 'max' = sizeParam || 'normal';
        
        // Create poll data object with proper typing
        const pollData: PollData = {
          question: decodedPollData.question,
          options: decodedPollData.options,
          pollType: decodedPollData.pollType || 'single',
          showResults: decodedPollData.showResults || 'after-vote',
          allowVoteChange: decodedPollData.allowVoteChange || false,
          totalVotes: decodedPollData.totalVotes || 0,
          createdAt: decodedPollData.createdAt || now,
          endDate: decodedPollData.endDate
        };
        
        // Create board object for preview
        this.board = {
          message: {
            html: '',
            updatedAt: now,
            status: 'active'
          },
          boardProtection: false,
          authorizedMailList: [],
          ownerUid: 'preview',
          userType: 'preview',
          planType: 'free',
          createdAt: now,
          activeDate: new Date(now).toISOString(),
          boardSize: boardSizeValue,
          boardType: 'poll',
          isPollActive: true, // Ensure poll is active for preview
          pollData: pollData
        };
        this._lastUpdated = Date.now();
        this.boardSize = boardSizeValue;
        
        // Auto-enter full page mode for preview immediately
        this.isFullPage = true;
        if (typeof window !== 'undefined') {
          document.body.style.overflow = 'hidden';
          document.body.style.margin = '0';
          document.body.style.padding = '0';
          document.documentElement.style.overflow = 'hidden';
        }
        this.cdr.detectChanges();
        return;
      } catch (e) {
        console.error('Error parsing poll preview data:', e);
        this.alertService.error('Invalid poll preview data');
        return;
      }
    }
    
    if (isPreview && previewContent) {
      // Standard board preview mode - show content directly
      this.isPreviewMode = true;
      this.showLandingPage = false; // Hide landing page for preview
      // Handle double-encoding: try decoding once, if it still looks encoded, decode again
      // Note: Angular Router automatically decodes query params once, so previewContent might already be partially decoded
      let decodedContent = previewContent;
      try {
        // Angular Router decodes once, but content might still be encoded
        // Try decoding multiple times until no more % encoding remains
        let previousContent = '';
        let decodeAttempts = 0;
        while (decodedContent.includes('%') && decodeAttempts < 3 && decodedContent !== previousContent) {
          previousContent = decodedContent;
          decodedContent = decodeURIComponent(decodedContent);
          decodeAttempts++;
        }
        // If decoded content is empty or just whitespace, try using original
        if (!decodedContent || decodedContent.trim().length === 0) {
          console.warn('Decoded content is empty, using original');
          decodedContent = previewContent;
        }
        console.log('Preview content - original:', previewContent);
        console.log('Preview content - decoded:', decodedContent);
        console.log('Decode attempts:', decodeAttempts);
      } catch (e) {
        // If decoding fails, use original content
        console.warn('Error decoding preview content:', e);
        decodedContent = previewContent;
      }
      
      // Ensure we have content
      if (!decodedContent || decodedContent.trim().length === 0) {
        console.error('Preview content is empty after decoding!');
        this.alertService.error('Preview content is empty. Please check your content.');
        return;
      }
      const sizeFromQuery = params['size'] as 'min' | 'normal' | 'max' | undefined;
      const now = Date.now();
      this.board = {
        message: {
          html: decodedContent,
          updatedAt: now,
          status: 'active'
        },
        boardProtection: false,
        authorizedMailList: [],
        ownerUid: 'preview',
        userType: 'preview',
        planType: 'free',
        createdAt: now,
        activeDate: new Date(now).toISOString(),
        boardSize: (sizeFromQuery && ['min', 'normal', 'max'].includes(sizeFromQuery)) ? sizeFromQuery : 'normal',
        boardType: 'standard' // Explicitly set board type
      };
      this._lastUpdated = Date.now();
      // Set board size from query param or default to normal
      this.boardSize = this.board.boardSize || 'normal';
      this.savedBoardSize = this.boardSize; // Track saved board size
      
      // Store boardKey from query params for size updates
      const boardKeyFromQuery = params['boardKey'] as string | undefined;
      if (boardKeyFromQuery) {
        (this as any).previewBoardKey = boardKeyFromQuery;
      }
      
      // Auto-enter full page mode for preview immediately
      this.isFullPage = true;
      this.showLandingPage = false; // Ensure landing page is hidden
      if (typeof window !== 'undefined') {
        document.body.style.overflow = 'hidden';
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.documentElement.style.overflow = 'hidden';
      }
      console.log('Preview board set:', this.board);
      console.log('hasBoardMessage:', this.hasBoardMessage);
      console.log('isFullPage:', this.isFullPage);
      console.log('showLandingPage:', this.showLandingPage);
      console.log('isPollBoard:', this.isPollBoard);
      
      // Force change detection to ensure template updates
      this.cdr.detectChanges();
      
      // Use setTimeout to ensure DOM is ready
      setTimeout(() => {
        this.cdr.detectChanges();
        // Start auto-scroll after a brief delay
        this.startAutoScroll();
      }, 0);
      
      return;
    }

    // Normal mode - check for board ID
    const boardIdFromQuery = params['id'];
    const fromCompetition = params['from'] === 'competition';
    
    // Check if user came from competition page (via query param or referrer)
    if (typeof window !== 'undefined') {
      const referrer = document.referrer || '';
      this.cameFromCompetition = fromCompetition || referrer.includes('/competition');
    }
    
    if (boardIdFromQuery && typeof boardIdFromQuery === 'string' && boardIdFromQuery.trim()) {
      const trimmedId = boardIdFromQuery.trim();
      // Redirect to new fullscreen board route
      this.router.navigate(['/board', trimmedId]);
    } else {
      // No query param, show landing page
      this.loadingFromQueryParam = false;
      this.showLandingPage = true;
      this.boardSize = 'normal'; // Default size
      // Ensure body overflow is hidden when showing landing page
      if (typeof window !== 'undefined') {
        document.body.style.overflow = 'hidden';
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.documentElement.style.overflow = 'hidden';
      }
      this.initializeFromSessionStorage();
    }
  }

  private async loadBoardFromQuery(boardId: string) {
    // Prevent multiple simultaneous loads or loading the same board
    if (this.loading || (this.lastLoadedBoardId === boardId && this.board)) {
      return;
    }

    // Set loading state
    this.loading = true;
    this.lastLoadedBoardId = boardId; // Track loaded board
    this.hasShownLoadSuccess = false; // Reset success message flag
    this.error = '';
    this.board = null;
    this._lastUpdated = null;
    this.showEmailInput = false;
    
    // Disable form controls during loading
    this.boardIdControl.disable();
    this.emailControl.disable();

    try {
      // Try to resolve board ID (regular board key or golden slate ID)
      const resolved = await this.boards.resolveBoardId(boardId);
      
      if (!resolved) {
        const errorMsg = 'Board not found. Please check the board ID or golden slate ID and try again.';
        this.error = errorMsg;
        this.board = null;
        this._lastUpdated = null;
        this.showEmailInput = false;
        this.loading = false;
        // Re-enable form controls
        this.boardIdControl.enable();
        this.emailControl.enable();
        this.cdr.markForCheck();
        this.snackBar.open(errorMsg, 'OK', {
          duration: 4000,
          panelClass: ['error-snackbar'],
        });
        return;
      }

      const result = resolved.board;
      const actualBoardKey = resolved.actualBoardKey;

      // Check if board is protected - show email input if needed
      this.showEmailInput = result.boardProtection === true;

      // If board is protected, we need email - don't auto-load, just show the email input
      if (result.boardProtection) {
        this.loading = false;
        // Re-enable form controls
        this.boardIdControl.enable();
        this.emailControl.enable();
        this.cdr.markForCheck();
        // Show message that email is required
        this.snackBar.open('This board is protected. Please enter an authorized email address.', 'OK', {
          duration: 5000,
          panelClass: ['error-snackbar'],
        });
        return;
      }

      // Board is not protected - load it directly
      this.board = result;
      this.currentBoardKey = actualBoardKey; // Use actual board key
      this._lastUpdated = result.message?.updatedAt ?? null;
      // Load board size from database
      this.boardSize = result.boardSize || 'normal';
      this.savedBoardSize = this.boardSize; // Track saved board size
      this.saveToSessionStorage(actualBoardKey); // Save actual board key
      this.error = '';
      this.loading = false;
      this.showLandingPage = false; // Hide landing page when board is loaded
      
      // For poll boards, ensure pollData is loaded and isPollActive is set
      if (result.boardType === 'poll') {
        // Ensure isPollActive is set (default to true if not set)
        if (result.isPollActive === undefined) {
          result.isPollActive = true;
        }
        // If pollData is missing, try to load it
        if (!result.pollData && actualBoardKey) {
          try {
            const pollData = await this.boards.getPoll(actualBoardKey);
            if (pollData) {
              result.pollData = pollData;
              this.board.pollData = pollData;
            }
          } catch (e) {
            console.error('Error loading poll data:', e);
          }
        }
      }
      
      // Set competition status immediately
      this.isInCompetition = !!(result.isSubmittedForCompetition);
      if (this.isInCompetition) {
        // Initialize voting asynchronously (non-blocking)
        this.initializeVoting(boardId).catch(() => {
          // Ignore errors
        });
      }
      
      // Re-enable form controls
      this.boardIdControl.enable();
      this.emailControl.enable();
      this.cdr.markForCheck();
      
      // Set up real-time listener for board updates (non-blocking)
      this.setupRealtimeListener(actualBoardKey);
      
      // Auto-enter full page mode immediately when loading from query param
      this.isFullPage = true;
      if (typeof window !== 'undefined') {
        document.body.style.overflow = 'hidden';
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.documentElement.style.overflow = 'hidden';
      }
      this.cdr.detectChanges();
      
      // Start auto-scroll immediately
      this.startAutoScroll();

      // Only show success message once per board load
      if (!this.hasShownLoadSuccess) {
        this.hasShownLoadSuccess = true;
        this.snackBar.open('Board loaded successfully!', 'OK', {
          duration: 3000,
          panelClass: ['success-snackbar'],
        });
      }
    } catch (e: any) {
      const errorMsg = e?.message || 'Error loading board. Please check the board ID and try again.';
      this.error = errorMsg;
      this.board = null;
      this._lastUpdated = null;
      this.loading = false;
      this.hasShownLoadSuccess = false; // Reset on error
      // Re-enable form controls
      this.boardIdControl.enable();
      this.emailControl.enable();
      this.cdr.markForCheck();
      this.snackBar.open(errorMsg, 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    }
  }

  get boardIdControl() {
    return this.form.get('boardId')!;
  }

  get emailControl() {
    return this.form.get('email')!;
  }

  get boardMessageHtml(): SafeHtml {
    const html = this.board?.message?.html || '';
    // Use DomSanitizer to preserve style attributes and other formatting
    // bypassSecurityTrustHtml allows style attributes to be preserved
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  get hasBoardMessage(): boolean {
    return !!(this.board && this.board.message && this.board.message.html);
  }

  get isPollBoard(): boolean {
    return this.board?.boardType === 'poll' && (this.board.isPollActive !== false);
  }


  get canVoteOnPoll(): boolean {
    // Poll boards are open for everyone to vote - no restrictions
    if (!this.isPollBoard || !this.board) {
      return false;
    }
    // Always allow voting on poll boards (ignore boardProtection)
    return true;
  }

  get canViewPollResults(): boolean {
    // Only creator and admin can view results
    if (!this.isPollBoard || !this.board) {
      return false;
    }
    const currentUser = this.auth.user;
    if (!currentUser) {
      return false;
    }
    // Check if user is the board owner
    if (currentUser.uid === this.board.ownerUid) {
      return true;
    }
    // Check if user is admin
    if (this.admin.isAdminLoggedIn()) {
      return true;
    }
    return false;
  }

  get userEmailForPoll(): string | undefined {
    return this.emailControl?.value || undefined;
  }


  async initializeVoting(boardKey: string) {
    try {
      // Get or create user IP
      if (typeof window !== 'undefined') {
        this.userIP = localStorage.getItem(USER_ANALYTICS_ID) || '';
        if (!this.userIP) {
          this.userIP = await this.boards.getUserIP();
          localStorage.setItem(USER_ANALYTICS_ID, this.userIP);
        }
        
        // Check if user has voted (from localStorage)
        const votedBoards = localStorage.getItem(VOTED_BOARDS_KEY);
        if (votedBoards) {
          try {
            const votedBoardList = JSON.parse(votedBoards);
            this.hasVotedInSession = votedBoardList.includes(boardKey);
          } catch (e) {
            // Invalid data, reset it
            localStorage.removeItem(VOTED_BOARDS_KEY);
          }
        }
      } else {
        this.userIP = 'unknown';
      }

      // Get vote count from board
      if (this.board) {
        this.voteCount = this.board.voteCount || 0;
      } else {
        this.voteCount = await this.boards.getVoteCount(boardKey);
      }
      
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error initializing voting:', error);
    }
  }

  async voteForBoard() {
    if (!this.currentBoardKey || this.isVoting || this.hasVotedInSession) {
      return;
    }

    // Immediately mark as voted and save to localStorage (hide button instantly)
    if (typeof window !== 'undefined' && this.currentBoardKey) {
      try {
        const votedBoards = localStorage.getItem(VOTED_BOARDS_KEY);
        const votedBoardList = votedBoards ? JSON.parse(votedBoards) : [];
        if (!votedBoardList.includes(this.currentBoardKey)) {
          votedBoardList.push(this.currentBoardKey);
          localStorage.setItem(VOTED_BOARDS_KEY, JSON.stringify(votedBoardList));
        }
        this.hasVotedInSession = true;
        this.isVoting = false; // Reset isVoting so button hides immediately
        this.cdr.detectChanges(); // Trigger change detection to hide button
      } catch (e) {
        // If localStorage fails, just mark in memory
        this.hasVotedInSession = true;
        this.isVoting = false;
        this.cdr.detectChanges();
      }
    }

    // Now proceed with the actual vote (button is already hidden)
    try {
      await this.boards.addVote(this.currentBoardKey, this.userIP);
      
      // Update vote count from board after a short delay
      setTimeout(async () => {
        try {
          if (this.currentBoardKey && this.board) {
            // Refresh board to get updated vote count
            const updatedBoard = await this.boards.getBoard(this.currentBoardKey);
            if (updatedBoard) {
              this.board = updatedBoard;
              this.voteCount = updatedBoard.voteCount || 0;
              this.cdr.detectChanges();
            }
          }
        } catch (err) {
          console.error('Error refreshing vote count:', err);
        }
      }, 500);
      
      setTimeout(() => {
        this.snackBar.open('⭐ Thanks for your vote!', 'OK', {
          duration: 2000,
          panelClass: ['success-snackbar'],
        });
      }, 0);
      
    } catch (error: any) {
      console.error('Error voting:', error);
      // On error, remove from localStorage and reset state so user can try again
      if (typeof window !== 'undefined' && this.currentBoardKey) {
        try {
          const votedBoards = localStorage.getItem(VOTED_BOARDS_KEY);
          if (votedBoards) {
            const votedBoardList = JSON.parse(votedBoards);
            const index = votedBoardList.indexOf(this.currentBoardKey);
            if (index > -1) {
              votedBoardList.splice(index, 1);
              localStorage.setItem(VOTED_BOARDS_KEY, JSON.stringify(votedBoardList));
            }
          }
          this.hasVotedInSession = false;
          this.isVoting = false;
          this.cdr.detectChanges();
        } catch (e) {
          // If localStorage update fails, just reset in memory
          this.hasVotedInSession = false;
          this.isVoting = false;
          this.cdr.detectChanges();
        }
      }
      setTimeout(() => {
        this.snackBar.open(error?.message || 'Error submitting vote. Please try again.', 'OK', {
          duration: 4000,
          panelClass: ['error-snackbar'],
        });
      }, 0);
    }
  }

  async goToMainboard() {
    // Check for unsaved size changes
    if (this.isPreviewMode && this.hasUnsavedSizeChanges()) {
      const result = await this.showSaveConfirmation('You have unsaved board size changes. Would you like to save before leaving?');
      if (result === 'save') {
        await this.saveBoardSize();
        this.navigateBackFromPreview();
      } else if (result === 'discard') {
        this.navigateBackFromPreview();
      }
      // If 'cancel', stay on page
    } else {
      // Save board size to localStorage so mainboard can read it and save to RTDB
      if (this.isPreviewMode && typeof window !== 'undefined') {
        localStorage.setItem('palagai_preview_board_size', this.boardSize);
      }
      this.navigateBackFromPreview();
    }
  }

  navigateBackFromPreview() {
    // Check returnTo param from query string
    const queryParams = this.route.snapshot.queryParams;
    const returnTo = queryParams['returnTo'];
    const boardKey = queryParams['boardKey'];
    
    if (returnTo === 'mainboard') {
      // Came from mainboard, go back there with boardKey if available
      const navParams: any = {};
      if (boardKey) {
        navParams['boardKey'] = boardKey;
      }
      this.router.navigate(['/mainboard'], { queryParams: navParams });
      return;
    }
    
    // If user is logged in, go to dashboard, otherwise go to home
    if (typeof window !== 'undefined') {
      try {
        const authData = localStorage.getItem('palagai_auth');
        if (authData) {
          this.router.navigate(['/dashboard']);
          return;
        }
      } catch (e) {
        // Ignore errors
      }
    }
    // Not logged in, go to home
    this.router.navigate(['/']);
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

  async setBoardSize(size: 'min' | 'normal' | 'max') {
    this.boardSize = size;
    // Don't save immediately - user needs to click save button
    // Just update the local state
    this.cdr.detectChanges();
  }

  hasUnsavedSizeChanges(): boolean {
    return this.boardSize !== this.savedBoardSize;
  }

  async saveBoardSize() {
    // In preview mode, save to RTDB if we have boardKey
    if (this.isPreviewMode && typeof window !== 'undefined') {
      // Get boardKey from stored value or query params
      const boardKey = (this as any).previewBoardKey || new URLSearchParams(window.location.search).get('boardKey');
      
      if (boardKey) {
        try {
          await this.boards.updateBoardSize(boardKey, this.boardSize);
          this.savedBoardSize = this.boardSize; // Update saved size
          // Also save to localStorage as backup
          localStorage.setItem('palagai_preview_board_size', this.boardSize);
          this.snackBar.open('Board size saved successfully!', 'OK', {
            duration: 2000,
            panelClass: ['success-snackbar'],
          });
        } catch (e: any) {
          console.error('Failed to save board size to RTDB:', e);
          this.snackBar.open('Failed to save board size', 'OK', {
            duration: 3000,
            panelClass: ['error-snackbar'],
          });
        }
      } else {
        // No boardKey, just save to localStorage
        localStorage.setItem('palagai_preview_board_size', this.boardSize);
        this.savedBoardSize = this.boardSize;
        this.snackBar.open('Board size saved!', 'OK', {
          duration: 2000,
          panelClass: ['success-snackbar'],
        });
      }
    }
    this.cdr.detectChanges();
  }

  private initializeFromSessionStorage() {
    if (typeof window !== 'undefined') {
      try {
        // Load board ID from sessionStorage
        const boardId = sessionStorage.getItem(SESSION_BOARD_KEY);
        if (boardId) {
          this.form.patchValue({ boardId });
        }
      } catch (e) {
        console.error('Error loading from session storage:', e);
      }
    }
  }

  get lastUpdated(): number | null {
    return this._lastUpdated;
  }

  private saveToSessionStorage(boardId: string) {
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(SESSION_BOARD_KEY, boardId);
      } catch (e) {
        console.error('Error saving to session storage:', e);
      }
    }
  }

  private checkBoardAuthorization(board: Board, providedEmail: string): boolean {
    // If board is not protected, anyone can view it
    if (!board.boardProtection) {
      return true;
    }

    // If board is protected, email is required
    if (!providedEmail || !providedEmail.trim()) {
      return false;
    }

    // Check if provided email is in authorized list
    const authorizedList = board.authorizedMailList || [];
    const normalizedEmail = providedEmail.trim().toLowerCase();
    return authorizedList.some(email => email.trim().toLowerCase() === normalizedEmail);
  }


  async loadBoardDirectlyToFullView() {
    if (this.form.invalid) {
      if (this.boardIdControl.hasError('required')) {
        this.error = 'Please enter a board ID';
        this.snackBar.open('Please enter a board ID', 'OK', {
          duration: 3000,
          panelClass: ['error-snackbar'],
        });
      }
      return;
    }

    // Prevent multiple simultaneous loads
    if (this.loading) {
      return;
    }

    const trimmedId = this.boardIdControl.value?.trim() || '';
    const email = this.emailControl.value?.trim() || '';

    // Set loading state
    this.loading = true;
    this.error = '';
    this.board = null;
    this._lastUpdated = null;
    this.showEmailInput = false;
    this.showLandingPage = false; // Hide landing page immediately when loading

    try {
      const result = await this.boards.getBoard(trimmedId);

      if (!result) {
        const errorMsg = 'Board not found. Please check the board ID and try again.';
        this.error = errorMsg;
        this.board = null;
        this._lastUpdated = null;
        this.showEmailInput = false;
        this.loading = false;
        this.showLandingPage = true; // Show landing page again on error
        // Ensure body overflow is hidden when showing landing page
        if (typeof window !== 'undefined') {
          document.body.style.overflow = 'hidden';
          document.body.style.margin = '0';
          document.body.style.padding = '0';
          document.documentElement.style.overflow = 'hidden';
        }
        this.cdr.markForCheck();
        this.snackBar.open(errorMsg, 'OK', {
          duration: 4000,
          panelClass: ['error-snackbar'],
        });
        return;
      }

      // Check if board is protected - show email input if needed
      this.showEmailInput = result.boardProtection === true;

      // Check board authorization with provided email
      const isAuthorized = this.checkBoardAuthorization(result, email);
      if (!isAuthorized) {
        let errorMsg = 'Access denied.';
        if (result.boardProtection) {
          if (!email) {
            errorMsg = 'This board is protected. Please enter an authorized email address.';
          } else {
            errorMsg = 'Access denied. The provided email is not authorized to view this board.';
          }
        }
        this.error = errorMsg;
        this.board = null;
        this._lastUpdated = null;
        this.loading = false;
        this.showLandingPage = true; // Show landing page again on error
        // Ensure body overflow is hidden when showing landing page
        if (typeof window !== 'undefined') {
          document.body.style.overflow = 'hidden';
          document.body.style.margin = '0';
          document.body.style.padding = '0';
          document.documentElement.style.overflow = 'hidden';
        }
        this.cdr.markForCheck();
        this.snackBar.open(errorMsg, 'OK', {
          duration: 5000,
          panelClass: ['error-snackbar'],
        });
        return;
      }

      // Success - navigate to home page with board ID (home page will load the board)
      // (Protected boards with email are already authorized at this point)
      this.router.navigate(['/'], { queryParams: { id: trimmedId } });
    } catch (e: any) {
      const errorMsg = e?.message || 'Error loading board. Please check the board ID and try again.';
      this.error = errorMsg;
      this.board = null;
      this._lastUpdated = null;
      this.loading = false;
      this.hasShownLoadSuccess = false; // Reset on error
      this.showLandingPage = true; // Show landing page again on error
      // Ensure body overflow is hidden when showing landing page
      if (typeof window !== 'undefined') {
        document.body.style.overflow = 'hidden';
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.documentElement.style.overflow = 'hidden';
      }
      this.cdr.markForCheck();
      this.snackBar.open(errorMsg, 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    }
  }

  ngAfterViewInit() {
    // Ensure body overflow is hidden when landing page is shown
    if (this.showLandingPage && typeof window !== 'undefined') {
      document.body.style.overflow = 'hidden';
      document.body.style.margin = '0';
      document.body.style.padding = '0';
      document.documentElement.style.overflow = 'hidden';
    }
    // Start auto-scroll when view is initialized
    setTimeout(() => this.startAutoScroll(), 1000);
  }

  ngOnDestroy() {
    this.stopAutoScroll();
    // Clean up Firebase listener
    if (this.boardUnsubscribe) {
      this.boardUnsubscribe();
      this.boardUnsubscribe = undefined;
    }
    // Clean up query params subscription
    if (this.queryParamsSubscription) {
      this.queryParamsSubscription.unsubscribe();
      this.queryParamsSubscription = undefined;
    }
    // Reset tracking
    this.lastLoadedBoardId = null;
  }

  toggleFullPage() {
    if (this.isFullPage) {
      // Exit full page - go back to landing page
      this.isFullPage = false;
      this.showLandingPage = true;
      this.board = null; // Clear board to show landing page
      // Keep body overflow hidden when showing landing page to prevent scrollbar
      if (typeof window !== 'undefined') {
        document.body.style.overflow = 'hidden';
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.documentElement.style.overflow = 'hidden';
      }
      this.stopAutoScroll();
    } else {
      // Enter full page
      this.isFullPage = true;
      if (typeof window !== 'undefined') {
        document.body.style.overflow = 'hidden';
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.documentElement.style.overflow = 'hidden';
      }
      // Start auto-scroll when entering full page
      setTimeout(() => this.startAutoScroll(), 500);
    }
    this.cdr.detectChanges();
  }

  openBoardIdDialog() {
    const dialogRef = this.dialog.open(BoardIdDialogComponent, {
      width: '90%',
      maxWidth: '500px',
      disableClose: false,
      autoFocus: true,
      data: {
        boardId: this.boardIdControl?.value || '',
        email: this.emailControl?.value || ''
      } as BoardIdDialogData
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result && result.boardId) {
        const boardId = result.boardId.trim();
        if (boardId) {
          // Navigate directly to the board route
          this.router.navigate(['/board', boardId], {
            queryParams: result.email ? { email: result.email } : {}
          });
        }
      }
    });
  }

  createBoard() {
    // Navigate to login page to create a board
    this.router.navigate(['/login']);
  }


  private startAutoScroll() {
    if (typeof window === 'undefined' || !this.kioskMessageContent) {
      return;
    }

    const container = this.kioskMessageContent.nativeElement;
    if (!container) {
      return;
    }

    // Find the scrollable element (palagai-message-renderer)
    const element = container.querySelector('.palagai-message-renderer') as HTMLElement;
    if (!element) {
      return;
    }

    // Check if content is scrollable (content height > container height)
    const isScrollable = element.scrollHeight > element.clientHeight;
    
    if (!isScrollable) {
      return; // No need to scroll if content fits
    }

    this.stopAutoScroll(); // Clear any existing interval

    // Reset scroll position to top
    element.scrollTop = 0;
    this.scrollDirection = 'down';
    this.isScrolling = true;

    // Slow auto-scroll: 1 pixel every 50ms = 20px per second
    this.autoScrollInterval = window.setInterval(() => {
      if (!element) {
        this.stopAutoScroll();
        return;
      }

      const maxScroll = element.scrollHeight - element.clientHeight;
      
      if (this.scrollDirection === 'down') {
        if (element.scrollTop >= maxScroll - 1) {
          // Reached bottom, pause for 3 seconds then scroll up
          this.scrollDirection = 'up';
          setTimeout(() => {
            if (this.isScrolling) {
              // Scroll up slowly
              const scrollUpInterval = window.setInterval(() => {
                if (!element || element.scrollTop <= 0) {
                  clearInterval(scrollUpInterval);
                  this.scrollDirection = 'down';
                  element.scrollTop = 0;
                } else {
                  element.scrollTop -= 1;
                }
              }, 50); // Same speed going up
            }
          }, 3000); // Pause 3 seconds at bottom
        } else {
          element.scrollTop += 1;
        }
      }
    }, 50); // Scroll 1px every 50ms = slow smooth scroll
  }

  private stopAutoScroll() {
    if (this.autoScrollInterval) {
      clearInterval(this.autoScrollInterval);
      this.autoScrollInterval = undefined;
    }
    this.isScrolling = false;
  }

  /**
   * Set up real-time listener for board updates
   * This will automatically update the board when changes occur in Firebase
   */
  private setupRealtimeListener(boardId: string) {
    // Clean up any existing listener first
    if (this.boardUnsubscribe) {
      this.boardUnsubscribe();
      this.boardUnsubscribe = undefined;
    }

    try {
      // Subscribe to real-time updates
      this.boardUnsubscribe = this.boards.subscribeToBoardUpdates(
        boardId,
        (updatedBoard) => {
          if (updatedBoard) {
            // Check if this is a protected board and we have email authorization
            if (updatedBoard.boardProtection && this.showEmailInput) {
              const providedEmail = this.emailControl.value?.trim().toLowerCase();
              const isAuthorized = this.checkBoardAuthorization(updatedBoard, providedEmail || '');
              
              if (!isAuthorized) {
                // Board is protected and email not authorized - don't update
                return;
              }
            }

            // For poll boards, ensure pollData is loaded
            if (updatedBoard.boardType === 'poll') {
              // Ensure isPollActive is set
              if (updatedBoard.isPollActive === undefined) {
                updatedBoard.isPollActive = true;
              }
              // If pollData is missing, try to load it
              if (!updatedBoard.pollData && this.currentBoardKey) {
                this.boards.getPoll(this.currentBoardKey).then(pollData => {
                  if (pollData && this.board) {
                    updatedBoard.pollData = pollData;
                    this.board.pollData = pollData;
                    this.board = updatedBoard;
                    this.cdr.detectChanges();
                  }
                }).catch(e => console.error('Error loading poll data:', e));
              } else if (updatedBoard.pollData) {
                // Ensure pollData is set on the board
                updatedBoard.pollData = updatedBoard.pollData;
              }
            }

            // Prevent duplicate updates - only update if content actually changed
            const previousUpdatedAt = this._lastUpdated;
            const newUpdatedAt = updatedBoard.message?.updatedAt ?? null;
            
            // Skip update if it's the same data (prevent duplicate renders)
            if (previousUpdatedAt === newUpdatedAt && this.board && this.board.message?.html === updatedBoard.message?.html) {
              // Only update vote count if it changed
              if (this.isInCompetition && this.voteCount !== (updatedBoard.voteCount || 0)) {
                this.voteCount = updatedBoard.voteCount || 0;
                this.cdr.markForCheck();
              }
              return; // No need to update if content is the same
            }
            
            // Update board data
            this.board = updatedBoard;
            this._lastUpdated = newUpdatedAt;
            
            // Update competition status synchronously
            this.isInCompetition = !!(updatedBoard.isSubmittedForCompetition);
            
            // Update vote count from board
            if (this.isInCompetition) {
              this.voteCount = updatedBoard.voteCount || 0;
            }
            
            // Only show notification if this is a new update (not initial load)
            if (previousUpdatedAt !== null && this._lastUpdated !== null && this._lastUpdated > previousUpdatedAt) {
              // Silently update - no snackbar to avoid interrupting user experience
              // The board will automatically reflect the new content
            }
            
            this.cdr.markForCheck();
          } else {
            // Board was deleted or doesn't exist anymore
            this.board = null;
            this._lastUpdated = null;
            this.cdr.markForCheck();
          }
        }
      );
    } catch (error: any) {
      console.error('Error setting up real-time listener:', error);
      // Don't show error to user - just log it
      // The board will still work, just without real-time updates
    }
  }

  async loadPrimaryBoards() {
    try {
      this.primaryBoards = await this.boards.getPrimaryBoards();
      this.cdr.detectChanges();
    } catch (e: any) {
      console.error('Error loading primary boards:', e);
      // Don't show error to user, just log it
    }
  }

  viewPrimaryBoard(boardKey: string) {
    this.router.navigate(['/board', boardKey]);
  }

  goToHome() {
    // If in preview mode, check if we should return to previous page
    if (this.isPreviewMode) {
      const queryParams = this.route.snapshot.queryParams;
      const returnTo = queryParams['returnTo'];
      
      if (returnTo === 'mainboard') {
        // Navigate back to mainboard
        this.navigateBackFromPreview();
        return;
      }
    }
    // Otherwise, navigate to home
    this.router.navigate(['/']);
  }

  getBoardPreview(board: Board): string {
    if (board.boardType === 'poll' && board.pollData) {
      return board.pollData.question || 'Poll';
    }
    // Strip HTML tags and get first 100 characters
    const text = (board.message?.html || '').replace(/<[^>]*>/g, '').trim();
    return text.substring(0, 100) + (text.length > 100 ? '...' : '');
  }

  openTermsAndConditions(): void {
    this.dialog.open(TermsConditionsDialogComponent, {
      width: '90%',
      maxWidth: '800px',
      maxHeight: '90vh',
      panelClass: 'terms-dialog-panel',
      disableClose: false,
    });
  }
}

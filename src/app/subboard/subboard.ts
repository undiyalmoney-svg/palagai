import { Component, OnInit, ChangeDetectorRef, AfterViewInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormControl } from '@angular/forms';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { Board, BoardService } from '../board.service';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
const SESSION_BOARD_KEY = 'palagai_session_board_id';

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
  private loadingFromQueryParam = false; // Track if board was loaded from query param
  private _lastUpdated: number | null = null;
  private autoScrollInterval?: number;
  private isScrolling = false;
  private scrollDirection: 'down' | 'up' = 'down';
  private boardUnsubscribe?: () => void; // Firebase listener unsubscribe function

  readonly defaultHtml = '<p>Enter a board ID and load a Palagai board.</p>';
  readonly backgroundImageUrl = '/doodle-background.png';

  constructor(
    private readonly boards: BoardService,
    private readonly snackBar: MatSnackBar,
    private readonly cdr: ChangeDetectorRef,
    private readonly fb: FormBuilder,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
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

  ngOnInit() {
    // TEMPORARY: Add dummy data for testing
    const now = Date.now();
    this.board = {
      message: {
        html: '<p class="tamil-verse">முயற்சி திருவினை ஆக்கும்; முயற்றின்மை<br><br>இன்மை புகுத்தி விடும்.</p></p>',
        updatedAt: now,
        status: 'active'
      },
      boardProtection: false,
      authorizedMailList: [],
      ownerUid: 'test',
      userType: 'test',
      planType: 'free',
      createdAt: now,
      activeDate: new Date(now).toISOString()
    };
    this._lastUpdated = now;
    this.form.patchValue({ boardId: 'TEST-BOARD-ID' });
    
    // Check for preview mode first
    this.route.queryParams.subscribe(params => {
      const isPreview = params['preview'] === 'true';
      const previewContent = params['content'];
      
      if (isPreview && previewContent) {
        // Preview mode - show content directly
        this.isPreviewMode = true;
        const decodedContent = decodeURIComponent(previewContent);
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
          activeDate: new Date(now).toISOString()
        };
        this._lastUpdated = Date.now();
        // Auto-enter full page mode for preview
        setTimeout(() => {
          this.isFullPage = true;
          if (typeof window !== 'undefined') {
            document.body.style.overflow = 'hidden';
            document.body.style.margin = '0';
            document.body.style.padding = '0';
            document.documentElement.style.overflow = 'hidden';
          }
          this.cdr.detectChanges();
          setTimeout(() => this.startAutoScroll(), 500);
        }, 100);
        return;
      }

      // Normal mode - check for board ID
      const boardIdFromQuery = params['id'];
      if (boardIdFromQuery && typeof boardIdFromQuery === 'string' && boardIdFromQuery.trim()) {
        // Set the board ID in the form
        this.form.patchValue({ boardId: boardIdFromQuery.trim() });
        // Mark that we're loading from query param
        this.loadingFromQueryParam = true;
        // Auto-load the board
        this.loadBoardFromQuery(boardIdFromQuery.trim());
      } else {
        // No query param, initialize from sessionStorage
        this.loadingFromQueryParam = false;
        this.initializeFromSessionStorage();
      }
    });
  }

  private async loadBoardFromQuery(boardId: string) {
    // Prevent multiple simultaneous loads
    if (this.loading) {
      return;
    }

    // Set loading state
    this.loading = true;
    this.error = '';
    this.board = null;
    this._lastUpdated = null;
    this.showEmailInput = false;
    
    // Disable form controls during loading
    this.boardIdControl.disable();
    this.emailControl.disable();

    try {
      const result = await this.boards.getBoard(boardId);

      if (!result) {
        const errorMsg = 'Board not found. Please check the board ID and try again.';
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
      this._lastUpdated = result.message?.updatedAt ?? null;
      this.saveToSessionStorage(boardId);
      this.error = '';
      this.loading = false;
      // Re-enable form controls
      this.boardIdControl.enable();
      this.emailControl.enable();
      this.cdr.markForCheck();
      
      // Set up real-time listener for board updates
      this.setupRealtimeListener(boardId);
      
      // Auto-enter full page mode when loading from query param
      setTimeout(() => {
        this.isFullPage = true;
        if (typeof window !== 'undefined') {
          document.body.style.overflow = 'hidden';
          document.body.style.margin = '0';
          document.body.style.padding = '0';
          document.documentElement.style.overflow = 'hidden';
        }
        this.cdr.detectChanges();
        setTimeout(() => this.startAutoScroll(), 500);
      }, 100);

      this.snackBar.open('Board loaded successfully!', 'OK', {
        duration: 3000,
        panelClass: ['success-snackbar'],
      });
    } catch (e: any) {
      const errorMsg = e?.message || 'Error loading board. Please check the board ID and try again.';
      this.error = errorMsg;
      this.board = null;
      this._lastUpdated = null;
      this.loading = false;
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

  get boardMessageHtml(): string {
    return this.board?.message?.html || '';
  }

  get hasBoardMessage(): boolean {
    return !!(this.board && this.board.message && this.board.message.html);
  }

  goToMainboard() {
    this.router.navigate(['/mainboard']);
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


  async loadBoard() {
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
    this.showEmailInput = false; // Reset - will be set based on board protection status
    
    // Disable form controls during loading
    this.boardIdControl.disable();
    this.emailControl.disable();

    try {
      const result = await this.boards.getBoard(trimmedId);

      if (!result) {
        const errorMsg = 'Board not found. Please check the board ID and try again.';
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
        // Re-enable form controls
        this.boardIdControl.enable();
        this.emailControl.enable();
        this.cdr.markForCheck();
        this.snackBar.open(errorMsg, 'OK', {
          duration: 5000,
          panelClass: ['error-snackbar'],
        });
        return;
      }

      // Success - update state
      this.board = result;
      this._lastUpdated = result.message?.updatedAt ?? null;
      this.saveToSessionStorage(trimmedId);
      this.error = '';
      this.loading = false;
      // Re-enable form controls
      this.boardIdControl.enable();
      this.emailControl.enable();
      this.cdr.markForCheck();
      
      // Set up real-time listener for board updates
      this.setupRealtimeListener(trimmedId);
      
      // Auto-enter full page mode if loading from query param
      if (this.loadingFromQueryParam) {
        setTimeout(() => {
          this.isFullPage = true;
          if (typeof window !== 'undefined') {
            document.body.style.overflow = 'hidden';
            document.body.style.margin = '0';
            document.body.style.padding = '0';
            document.documentElement.style.overflow = 'hidden';
          }
          this.cdr.detectChanges();
          setTimeout(() => this.startAutoScroll(), 500);
        }, 100);
        // Reset flag after use
        this.loadingFromQueryParam = false;
      } else {
        // Restart auto-scroll after board loads if already in full page
        if (this.isFullPage) {
          setTimeout(() => this.startAutoScroll(), 500);
        }
      }

      this.snackBar.open('Board loaded successfully!', 'OK', {
        duration: 3000,
        panelClass: ['success-snackbar'],
      });
    } catch (e: any) {
      const errorMsg = e?.message || 'Error loading board. Please check the board ID and try again.';
      this.error = errorMsg;
      this.board = null;
      this._lastUpdated = null;
      this.loading = false;
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

  ngAfterViewInit() {
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
  }

  toggleFullPage() {
    this.isFullPage = !this.isFullPage;
    if (this.isFullPage) {
      document.body.style.overflow = 'hidden';
      document.body.style.margin = '0';
      document.body.style.padding = '0';
      document.documentElement.style.overflow = 'hidden';
      // Start auto-scroll when entering full page
      setTimeout(() => this.startAutoScroll(), 500);
    } else {
      document.body.style.overflow = '';
      document.body.style.margin = '';
      document.body.style.padding = '';
      document.documentElement.style.overflow = '';
      this.stopAutoScroll();
    }
    this.cdr.detectChanges();
  }

  private startAutoScroll() {
    if (typeof window === 'undefined' || !this.kioskMessageContent) {
      return;
    }

    const element = this.kioskMessageContent.nativeElement;
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

            // Update board data
            const previousUpdatedAt = this._lastUpdated;
            this.board = updatedBoard;
            this._lastUpdated = updatedBoard.message?.updatedAt ?? null;
            
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
}

import { Component, OnInit, ChangeDetectorRef, AfterViewInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Board, BoardService } from '../board.service';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { distinctUntilChanged, map, skip } from 'rxjs/operators';
import { PollDisplayComponent } from '../subboard/poll-display/poll-display.component';
import { AuthService } from '../auth.service';
import { AdminService } from '../admin.service';


@Component({
  selector: 'app-fullscreen-board',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatSnackBarModule,
    MatIconModule,
    MatProgressSpinnerModule,
    PollDisplayComponent
  ],
  templateUrl: './fullscreen-board.component.html',
  styleUrls: ['./fullscreen-board.component.css', '../subboard/display-renderer.css'],
})
export class FullScreenBoardComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('kioskMessageContent', { static: false }) kioskMessageContent?: ElementRef<HTMLDivElement>;
  
  loading = false;
  error = '';
  board: Board | null = null;
  boardSize: 'min' | 'normal' | 'max' = 'normal';
  private _lastUpdated: number | null = null;
  private autoScrollInterval?: number;
  private isScrolling = false;
  private scrollDirection: 'down' | 'up' = 'down';
  private boardUnsubscribe?: () => void; // Firebase listener unsubscribe function
  private routeParamsSubscription?: Subscription; // Route params subscription
  private lastLoadedBoardId: string | null = null; // Track last loaded board ID to prevent duplicates
  private isInitialLoad: boolean = true; // Track if this is the initial board load
  currentBoardKey: string | null = null; // Store current board key for voting
  private hasShownLoadSuccess: boolean = false; // Track if success message already shown
  private pendingTimeouts: number[] = [];

  constructor(
    private readonly boards: BoardService,
    private readonly snackBar: MatSnackBar,
    private readonly cdr: ChangeDetectorRef,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly sanitizer: DomSanitizer,
    private readonly auth: AuthService,
    private readonly admin: AdminService,
  ) {
    // Set body styles for full screen immediately
    if (typeof window !== 'undefined') {
      document.body.style.overflow = 'hidden';
      document.body.style.margin = '0';
      document.body.style.padding = '0';
      document.documentElement.style.overflow = 'hidden';
    }
  }

  ngOnInit() {

    // Load board immediately from snapshot (first load)
    const snapshotId = this.route.snapshot.params['id'];
    if (snapshotId && typeof snapshotId === 'string' && snapshotId.trim()) {
      const trimmedId = snapshotId.trim();
      this.lastLoadedBoardId = trimmedId;
      this.loadBoard(trimmedId);
    } else {
      // No board ID, redirect to home
      this.router.navigate(['/']);
      return;
    }

    // Subscribe to route param changes (for navigation to different boards)
    // Use skip(1) to skip the initial emission since we already loaded from snapshot
    this.routeParamsSubscription = this.route.params.pipe(
      map(params => params['id']),
      distinctUntilChanged(), // Only emit when board ID actually changes
      skip(1) // Skip the first emission (already handled by snapshot load above)
    ).subscribe(boardId => {
      if (!this.isDestroyed && boardId && typeof boardId === 'string' && boardId.trim()) {
        const trimmedId = boardId.trim();
        // Only load if it's a different board
        if (this.lastLoadedBoardId !== trimmedId) {
          this.lastLoadedBoardId = trimmedId;
          this.loadBoard(trimmedId);
        }
      }
    });
  }

  ngAfterViewInit() {
    // Start auto-scroll when view is initialized
    if (typeof window !== 'undefined') {
      const timeoutId = window.setTimeout(() => {
        if (!this.isDestroyed) {
          this.startAutoScroll();
        }
      }, 1000);
      this.pendingTimeouts.push(timeoutId);
    }
  }

  private isDestroyed = false;

  ngOnDestroy() {
    this.isDestroyed = true;
    this.stopAutoScroll();
    // Clean up Firebase listener
    if (this.boardUnsubscribe) {
      this.boardUnsubscribe();
      this.boardUnsubscribe = undefined;
    }
    // Clean up route params subscription
    if (this.routeParamsSubscription) {
      this.routeParamsSubscription.unsubscribe();
      this.routeParamsSubscription = undefined;
    }
    // Clear any pending timeouts
    if (this.pendingTimeouts) {
      this.pendingTimeouts.forEach(timeout => clearTimeout(timeout));
      this.pendingTimeouts = [];
    }
    // Reset body styles
    if (typeof window !== 'undefined') {
      document.body.style.overflow = '';
      document.body.style.margin = '';
      document.body.style.padding = '';
      document.documentElement.style.overflow = '';
    }
  }

  private async loadBoard(boardId: string) {
    // Prevent multiple simultaneous loads
    if (this.loading || this.isDestroyed) {
      return;
    }
    
    // Prevent loading the same board if it's already loaded (unless it's a fresh load)
    if (this.lastLoadedBoardId === boardId && this.board && !this.error) {
      return;
    }
    
    // Mark that we're loading this board (will update with actualBoardKey after resolution)

    // Set loading state
    this.loading = true;
    this.hasShownLoadSuccess = false; // Reset success message flag
    this.isInitialLoad = true; // Mark as initial load
    this.error = '';
    this.board = null;
    this._lastUpdated = null;

    try {
      // Try to resolve board ID (regular board key or golden slate ID)
      const resolved = await this.boards.resolveBoardId(boardId);

      if (!resolved) {
        const errorMsg = 'Board not found. Please check the board ID or golden slate ID and try again.';
        this.error = errorMsg;
        this.board = null;
        this._lastUpdated = null;
        this.loading = false;
        this.cdr.markForCheck();
        if (!this.isDestroyed) {
          this.snackBar.open(errorMsg, 'OK', {
            duration: 4000,
            panelClass: ['error-snackbar'],
          });
        }
        // Redirect to home after error
        if (typeof window !== 'undefined') {
          const timeoutId = window.setTimeout(() => {
            if (!this.isDestroyed) {
              this.router.navigate(['/']);
            }
          }, 2000);
          this.pendingTimeouts.push(timeoutId);
        }
        return;
      }

      const result = resolved.board;
      const actualBoardKey = resolved.actualBoardKey;

      // Check if board is protected - redirect to home with query param for email input
      if (result.boardProtection === true) {
        this.loading = false;
        this.cdr.markForCheck();
        if (!this.isDestroyed) {
          this.snackBar.open('This board is protected. Please access it from the home page with an authorized email.', 'OK', {
            duration: 5000,
            panelClass: ['error-snackbar'],
          });
        }
        // Redirect to home with board ID (subboard will handle email input)
        if (typeof window !== 'undefined') {
          const timeoutId = window.setTimeout(() => {
            if (!this.isDestroyed) {
              this.router.navigate(['/'], { queryParams: { id: boardId } });
            }
          }, 2000);
          this.pendingTimeouts.push(timeoutId);
        }
        return;
      }

      // Success - update state
      this.board = result;
      this.currentBoardKey = actualBoardKey;
      this.lastLoadedBoardId = actualBoardKey; // Update with actual board key
      this._lastUpdated = result.message?.updatedAt ?? null;
      // Load board size from database
      this.boardSize = result.boardSize || 'normal';
      this.error = '';
      this.loading = false;
      
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
      
      // Force change detection to ensure poll data is passed correctly
      this.cdr.markForCheck();
      this.cdr.detectChanges();
      
      // Set up real-time listener for board updates (with delay to prevent immediate duplicate fire)
      // Use setTimeout to ensure listener is set up after initial load completes
      if (typeof window !== 'undefined') {
        const timeoutId = window.setTimeout(() => {
          if (!this.isDestroyed) {
            this.setupRealtimeListener(actualBoardKey);
            this.isInitialLoad = false; // Mark initial load as complete
          }
        }, 100);
        this.pendingTimeouts.push(timeoutId);
      }
      
      // Start auto-scroll immediately
      this.startAutoScroll();

      // Only show success message once per board load
      if (!this.hasShownLoadSuccess && !this.isDestroyed) {
        this.hasShownLoadSuccess = true;
        // Dismiss any existing snackbars first
        this.snackBar.dismiss();
        // Small delay to ensure previous snackbar is dismissed
        if (typeof window !== 'undefined') {
          const timeoutId = window.setTimeout(() => {
            if (!this.isDestroyed) {
              this.snackBar.open('Board loaded successfully!', 'OK', {
                duration: 3000,
                panelClass: ['success-snackbar'],
              });
            }
          }, 50);
          this.pendingTimeouts.push(timeoutId);
        }
      }
    } catch (e: any) {
      const errorMsg = e?.message || 'Error loading board. Please check the board ID and try again.';
      this.error = errorMsg;
      this.board = null;
      this._lastUpdated = null;
      this.loading = false;
      this.hasShownLoadSuccess = false; // Reset on error
      this.cdr.markForCheck();
      if (!this.isDestroyed) {
        this.snackBar.open(errorMsg, 'OK', {
          duration: 4000,
          panelClass: ['error-snackbar'],
        });
      }
      // Redirect to home after error
      setTimeout(() => {
        this.router.navigate(['/']);
      }, 2000);
    }
  }

  get boardMessageHtml(): SafeHtml {
    const html = this.board?.message?.html || '';
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  get hasBoardMessage(): boolean {
    return !!(this.board && this.board.message && this.board.message.html);
  }

  get isPollBoard(): boolean {
    return this.board?.boardType === 'poll' && (this.board.isPollActive !== false);
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

  goToHome() {
    // Always navigate to home page
    this.router.navigate(['/']);
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
    if (typeof window !== 'undefined') {
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
            window.setTimeout(() => {
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
   */
  private setupRealtimeListener(boardId: string) {
    // Clean up existing listener
    if (this.boardUnsubscribe) {
      this.boardUnsubscribe();
      this.boardUnsubscribe = undefined;
    }

    // Store initial board state to prevent immediate duplicate updates
    const initialBoardState = this.board ? JSON.stringify({
      html: this.board.message?.html,
      updatedAt: this.board.message?.updatedAt,
      voteCount: this.board.voteCount,
      boardSize: this.board.boardSize
    }) : null;

    try {
      this.boardUnsubscribe = this.boards.subscribeToBoardUpdates(boardId, (updatedBoard: Board | null) => {
        if (updatedBoard) {
          // Skip first update if it's the initial load (prevent duplicate from listener firing immediately)
          if (this.isInitialLoad) {
            // Check if this is the same as what we just loaded
            const newBoardState = JSON.stringify({
              html: updatedBoard.message?.html,
              updatedAt: updatedBoard.message?.updatedAt,
              voteCount: updatedBoard.voteCount,
              boardSize: updatedBoard.boardSize
            });
            
            // If it's the same state, ignore it (it's just the initial listener fire)
            if (newBoardState === initialBoardState) {
              return;
            }
          }

          // Check if board actually changed
          const currentBoardState = this.board ? JSON.stringify({
            html: this.board.message?.html,
            updatedAt: this.board.message?.updatedAt,
            voteCount: this.board.voteCount,
            boardSize: this.board.boardSize
          }) : null;

          const newBoardState = JSON.stringify({
            html: updatedBoard.message?.html,
            updatedAt: updatedBoard.message?.updatedAt,
            voteCount: updatedBoard.voteCount,
            boardSize: updatedBoard.boardSize
          });

          // Only update if board actually changed
          if (newBoardState !== currentBoardState) {
            // For poll boards, ensure pollData is loaded
            if (updatedBoard.boardType === 'poll') {
              // Ensure isPollActive is set
              if (updatedBoard.isPollActive === undefined) {
                updatedBoard.isPollActive = true;
              }
              // If pollData is missing, try to load it
              if (!updatedBoard.pollData && this.currentBoardKey) {
                this.boards.getPoll(this.currentBoardKey).then(pollData => {
                  if (pollData && !this.isDestroyed) {
                    updatedBoard.pollData = pollData;
                    this.board = updatedBoard;
                    this._lastUpdated = updatedBoard.message?.updatedAt ?? null;
                    if (updatedBoard.boardSize) {
                      this.boardSize = updatedBoard.boardSize;
                    }
                    this.currentBoardKey = boardId;
                    this.cdr.markForCheck();
                    this.cdr.detectChanges();
                  }
                }).catch(e => console.error('Error loading poll data:', e));
                return; // Exit early, will update when poll data loads
              } else if (updatedBoard.pollData) {
                // Ensure pollData is set
                this.currentBoardKey = boardId;
              }
            }
            
            this.board = updatedBoard;
            this._lastUpdated = updatedBoard.message?.updatedAt ?? null;
            // Update board size if changed
            if (updatedBoard.boardSize) {
              this.boardSize = updatedBoard.boardSize;
            }
            // Update currentBoardKey for poll boards
            if (updatedBoard.boardType === 'poll') {
              this.currentBoardKey = boardId;
            }
            this.cdr.markForCheck();
            this.cdr.detectChanges();
          }
        }
      });
    } catch (error) {
      console.error('Error setting up real-time listener:', error);
    }
  }

  get lastUpdated(): number | null {
    return this._lastUpdated;
  }
}


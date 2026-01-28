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
import { distinctUntilChanged, map } from 'rxjs/operators';


@Component({
  selector: 'app-fullscreen-board',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatSnackBarModule,
    MatIconModule,
    MatProgressSpinnerModule
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

  constructor(
    private readonly boards: BoardService,
    private readonly snackBar: MatSnackBar,
    private readonly cdr: ChangeDetectorRef,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly sanitizer: DomSanitizer,
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
    this.routeParamsSubscription = this.route.params.pipe(
      map(params => params['id']),
      distinctUntilChanged() // Only emit when board ID actually changes
    ).subscribe(boardId => {
      if (boardId && typeof boardId === 'string' && boardId.trim()) {
        const trimmedId = boardId.trim();
        // Only load if it's a different board (skip initial load)
        if (this.lastLoadedBoardId !== trimmedId) {
          this.lastLoadedBoardId = trimmedId;
          this.loadBoard(trimmedId);
        }
      }
    });
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
    // Clean up route params subscription
    if (this.routeParamsSubscription) {
      this.routeParamsSubscription.unsubscribe();
      this.routeParamsSubscription = undefined;
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
    if (this.loading) {
      return;
    }
    
    // Prevent loading the same board if it's already loaded (unless it's a fresh load)
    if (this.lastLoadedBoardId === boardId && this.board && !this.error) {
      return;
    }

    // Set loading state
    this.loading = true;
    this.hasShownLoadSuccess = false; // Reset success message flag
    this.isInitialLoad = true; // Mark as initial load
    this.error = '';
    this.board = null;
    this._lastUpdated = null;

    try {
      const result = await this.boards.getBoard(boardId);

      if (!result) {
        const errorMsg = 'Board not found. Please check the board ID and try again.';
        this.error = errorMsg;
        this.board = null;
        this._lastUpdated = null;
        this.loading = false;
        this.cdr.markForCheck();
        this.snackBar.open(errorMsg, 'OK', {
          duration: 4000,
          panelClass: ['error-snackbar'],
        });
        // Redirect to home after error
        setTimeout(() => {
          this.router.navigate(['/']);
        }, 2000);
        return;
      }

      // Check if board is protected - redirect to home with query param for email input
      if (result.boardProtection === true) {
        this.loading = false;
        this.cdr.markForCheck();
        this.snackBar.open('This board is protected. Please access it from the home page with an authorized email.', 'OK', {
          duration: 5000,
          panelClass: ['error-snackbar'],
        });
        // Redirect to home with board ID (subboard will handle email input)
        setTimeout(() => {
          this.router.navigate(['/'], { queryParams: { id: boardId } });
        }, 2000);
        return;
      }

      // Success - update state
      this.board = result;
      this.currentBoardKey = boardId;
      this._lastUpdated = result.message?.updatedAt ?? null;
      // Load board size from database
      this.boardSize = result.boardSize || 'normal';
      this.error = '';
      this.loading = false;
      
      
      this.cdr.markForCheck();
      
      // Set up real-time listener for board updates (with delay to prevent immediate duplicate fire)
      // Use setTimeout to ensure listener is set up after initial load completes
      setTimeout(() => {
        this.setupRealtimeListener(boardId);
        this.isInitialLoad = false; // Mark initial load as complete
      }, 100);
      
      // Start auto-scroll immediately
      this.startAutoScroll();

      // Only show success message once per board load
      if (!this.hasShownLoadSuccess) {
        this.hasShownLoadSuccess = true;
        // Dismiss any existing snackbars first
        this.snackBar.dismiss();
        // Small delay to ensure previous snackbar is dismissed
        setTimeout(() => {
          this.snackBar.open('Board loaded successfully!', 'OK', {
            duration: 3000,
            panelClass: ['success-snackbar'],
          });
        }, 50);
      }
    } catch (e: any) {
      const errorMsg = e?.message || 'Error loading board. Please check the board ID and try again.';
      this.error = errorMsg;
      this.board = null;
      this._lastUpdated = null;
      this.loading = false;
      this.hasShownLoadSuccess = false; // Reset on error
      this.cdr.markForCheck();
      this.snackBar.open(errorMsg, 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
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


  goToHome() {
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
            this.board = updatedBoard;
            this._lastUpdated = updatedBoard.message?.updatedAt ?? null;
            // Update board size if changed
            if (updatedBoard.boardSize) {
              this.boardSize = updatedBoard.boardSize;
            }
            this.cdr.markForCheck();
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


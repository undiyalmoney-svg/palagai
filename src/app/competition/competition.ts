import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Board, BoardService } from '../board.service';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Unsubscribe } from 'firebase/database';

interface CompetitionBoard {
  boardKey: string;
  board: Board;
  voteCount: number;
  hasVoted: boolean;
  unsubscribe?: Unsubscribe;
}

@Component({
  selector: 'app-competition',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatToolbarModule,
  ],
  templateUrl: './competition.html',
  styleUrls: ['./competition.css', '../subboard/display-renderer.css'],
})
export class Competition implements OnInit, OnDestroy {
  boards: CompetitionBoard[] = [];
  loading = true;
  userIP: string = '';

  private voteUnsubscribes: Map<string, Unsubscribe> = new Map();

  constructor(
    private readonly boardsService: BoardService,
    private readonly snackBar: MatSnackBar,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit() {
    try {
      await this.loadCompetitionBoards();
    } catch (error) {
      console.error('Error in ngOnInit:', error);
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  ngOnDestroy() {
    // Unsubscribe from all vote listeners
    this.voteUnsubscribes.forEach((unsubscribe) => unsubscribe());
    this.voteUnsubscribes.clear();
  }

  private async loadCompetitionBoards() {
    console.log('🚀 Starting to load competition boards...');
    this.loading = true;
    this.boards = [];
    this.cdr.detectChanges();

    // Set a timeout to prevent infinite loading
    let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      if (this.loading) {
        console.warn('⚠️ Loading timeout - forcing completion');
        this.loading = false;
        this.boards = [];
        this.cdr.detectChanges();
      }
    }, 8000); // 8 second timeout

    try {
      // Get or create session ID for user identification
      if (typeof window !== 'undefined') {
        this.userIP = sessionStorage.getItem('palagai_session_id') || 
          `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        sessionStorage.setItem('palagai_session_id', this.userIP);
      } else {
        this.userIP = 'unknown';
      }

      // Get all competition boards with timeout
      const competitionBoardsPromise = this.boardsService.getCompetitionBoards();
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), 5000)
      );
      
      const competitionBoards = await Promise.race([competitionBoardsPromise, timeoutPromise]);

      if (competitionBoards.length === 0) {
        this.loading = false;
        this.cdr.detectChanges();
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        return;
      }

      // Process boards quickly without additional Firebase calls
      const boardsWithVotes: CompetitionBoard[] = [];
      
      for (const { boardKey, board } of competitionBoards) {
        try {
          // Calculate vote count from board data
          const votes = board.votes || {};
          const voteCount = Object.values(votes).reduce((total, count) => total + (count > 0 ? 1 : 0), 0);
          
          // Check if user has voted from board data
          const hasVoted = votes[this.userIP] !== undefined && votes[this.userIP] > 0;

          // Subscribe to real-time vote count updates (non-blocking)
          try {
            const unsubscribe = this.boardsService.subscribeToVoteCount(boardKey, (count) => {
              const boardIndex = this.boards.findIndex((b) => b.boardKey === boardKey);
              if (boardIndex !== -1) {
                this.boards[boardIndex].voteCount = count;
                this.boards.sort((a, b) => b.voteCount - a.voteCount);
                this.cdr.detectChanges();
              }
            });
            this.voteUnsubscribes.set(boardKey, unsubscribe);
          } catch (subErr) {
            console.warn(`Could not subscribe to ${boardKey}:`, subErr);
          }

          boardsWithVotes.push({
            boardKey,
            board,
            voteCount,
            hasVoted,
          });
        } catch (err) {
          console.error(`Error processing board ${boardKey}:`, err);
          boardsWithVotes.push({
            boardKey,
            board,
            voteCount: 0,
            hasVoted: false,
          });
        }
      }

      // Sort by vote count (descending)
      boardsWithVotes.sort((a, b) => b.voteCount - a.voteCount);
      this.boards = boardsWithVotes;
      
      console.log('✅ Boards loaded successfully:', this.boards.length);
      console.log('📋 Boards data:', this.boards.map(b => ({ key: b.boardKey, votes: b.voteCount })));
      
    } catch (e: any) {
      console.error('❌ Error loading competition boards:', e);
      this.boards = [];
      const errorMsg = e?.message || 'Error loading competition boards';
      try {
        this.snackBar.open(errorMsg, 'OK', {
          duration: 4000,
          panelClass: ['error-snackbar'],
        });
      } catch (snackErr) {
        console.error('Could not show snackbar:', snackErr);
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      // Ensure loading is false and trigger change detection
      if (this.loading) {
        console.log('🏁 Setting loading to false in finally. Boards count:', this.boards.length);
        this.loading = false;
      }
      console.log('📊 Final state - loading:', this.loading, 'boards:', this.boards.length);
      
      // Use setTimeout to ensure change detection happens after all async operations
      setTimeout(() => {
        this.cdr.detectChanges();
        console.log('🔄 Change detection triggered in setTimeout');
      }, 0);
    }
  }

  async voteForBoard(board: CompetitionBoard) {
    if (board.hasVoted) {
      this.snackBar.open('You have already voted for this Kavithai!', 'OK', {
        duration: 3000,
        panelClass: ['info-snackbar'],
      });
      return;
    }

    try {
      console.log(`🗳️ Voting for board: ${board.boardKey} with IP: ${this.userIP}`);
      
      // Add the vote to Firebase
      await this.boardsService.addVote(board.boardKey, this.userIP);
      
      // Update local state immediately
      board.hasVoted = true;
      
      // Refresh vote count from Firebase to ensure accuracy
      const updatedVoteCount = await this.boardsService.getVoteCount(board.boardKey);
      board.voteCount = updatedVoteCount;
      console.log(`✅ Vote added. Updated count from Firebase: ${board.voteCount}`);

      // Re-sort boards by vote count (descending) - highest votes on top
      this.boards.sort((a, b) => b.voteCount - a.voteCount);
      console.log(`🔄 Boards re-sorted. Top board now: ${this.boards[0]?.boardKey} with ${this.boards[0]?.voteCount} votes`);

      this.snackBar.open('Thank you for your vote! ❤️', 'OK', {
        duration: 3000,
        panelClass: ['success-snackbar'],
      });
      
      // Force change detection
      this.cdr.detectChanges();
    } catch (e: any) {
      console.error('❌ Error voting:', e);
      const errorMsg = e?.message || 'Error submitting vote';
      this.snackBar.open(errorMsg, 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    }
  }

  getBoardLink(boardKey: string): string {
    if (typeof window === 'undefined') {
      return '';
    }
    return `${window.location.origin}/?id=${boardKey}`;
  }
}


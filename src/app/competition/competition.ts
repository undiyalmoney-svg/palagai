import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Board, BoardService } from '../board.service';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Unsubscribe } from 'firebase/database';

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

interface CompetitionBoard {
  boardKey: string;
  board: Board;
  voteCount: number;
  unsubscribe?: Unsubscribe;
}

@Component({
  selector: 'app-competition',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
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
  votedBoards: Set<string> = new Set(); // Track boards voted in this session

  private voteUnsubscribes: Map<string, Unsubscribe> = new Map();

  constructor(
    private readonly boardsService: BoardService,
    private readonly snackBar: MatSnackBar,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit() {
    // Initialize dummy localStorage keys
    initializeDummyLocalStorage();
    
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
    this.loading = true;
    this.boards = [];
    this.cdr.detectChanges();

    try {
      // Get or create user ID for identification (from localStorage) - non-blocking
      if (typeof window !== 'undefined') {
        this.userIP = localStorage.getItem(USER_ANALYTICS_ID) || 
          `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        if (!localStorage.getItem(USER_ANALYTICS_ID)) {
          localStorage.setItem(USER_ANALYTICS_ID, this.userIP);
        }
        
        // Load voted boards from localStorage (obfuscated key)
        try {
          const votedBoards = localStorage.getItem(VOTED_BOARDS_KEY);
          if (votedBoards) {
            const votedBoardList = JSON.parse(votedBoards);
            this.votedBoards = new Set(votedBoardList);
          }
        } catch (e) {
          // Invalid data, reset it
          localStorage.removeItem(VOTED_BOARDS_KEY);
        }
      } else {
        this.userIP = 'unknown';
      }

      // Get all competition boards (reduced timeout to 3 seconds)
      const competitionBoardsPromise = this.boardsService.getCompetitionBoards();
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), 3000)
      );
      
      const competitionBoards = await Promise.race([competitionBoardsPromise, timeoutPromise]);

      if (competitionBoards.length === 0) {
        this.loading = false;
        this.cdr.detectChanges();
        return;
      }

      // Process boards quickly - build array first, then subscribe async
      const boardsWithVotes: CompetitionBoard[] = competitionBoards.map(({ boardKey, board }) => ({
        boardKey,
        board,
        voteCount: board.voteCount || 0,
      }));

      // Sort by vote count (descending)
      boardsWithVotes.sort((a, b) => b.voteCount - a.voteCount);
      this.boards = boardsWithVotes;
      this.loading = false;
      this.cdr.detectChanges();
      
      // Subscribe to vote count updates asynchronously (non-blocking)
      Promise.all(competitionBoards.map(({ boardKey }) => {
        return new Promise<void>((resolve) => {
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
            resolve();
          } catch (subErr) {
            resolve(); // Continue even if subscription fails
          }
        });
      })).catch(() => {
        // Ignore subscription errors
      });
      
    } catch (e: any) {
      console.error('Error loading competition boards:', e);
      this.boards = [];
      this.loading = false;
      this.cdr.detectChanges();
      const errorMsg = e?.message || 'Error loading competition boards';
      try {
        this.snackBar.open(errorMsg, 'OK', {
          duration: 4000,
          panelClass: ['error-snackbar'],
        });
      } catch (snackErr) {
        // Ignore snackbar errors
      }
    }
  }

  async voteForBoard(board: CompetitionBoard) {
    // Check if already voted in this session
    if (this.votedBoards.has(board.boardKey)) {
      return;
    }

    try {
      console.log(`🗳️ Voting for board: ${board.boardKey} with IP: ${this.userIP}`);
      
      // Add the vote to Firebase (allows multiple votes)
      await this.boardsService.addVote(board.boardKey, this.userIP);
      
      // Mark as voted (store in localStorage with obfuscated key)
      this.votedBoards.add(board.boardKey);
      if (typeof window !== 'undefined') {
        try {
          const votedBoardList = Array.from(this.votedBoards);
          localStorage.setItem(VOTED_BOARDS_KEY, JSON.stringify(votedBoardList));
        } catch (e) {
          // If localStorage fails, just keep in memory
          console.warn('Failed to save voted boards to localStorage:', e);
        }
      }
      
      // Refresh vote count from Firebase to ensure accuracy
      const updatedVoteCount = await this.boardsService.getVoteCount(board.boardKey);
      board.voteCount = updatedVoteCount;
      console.log(`✅ Vote added. Updated count from Firebase: ${board.voteCount}`);

      // Re-sort boards by vote count (descending) - highest votes on top
      this.boards.sort((a, b) => b.voteCount - a.voteCount);
      console.log(`🔄 Boards re-sorted. Top board now: ${this.boards[0]?.boardKey} with ${this.boards[0]?.voteCount} votes`);

      this.snackBar.open('⭐ Thanks for your vote!', 'OK', {
        duration: 2000,
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
    return `/board/${boardKey}`;
  }
}


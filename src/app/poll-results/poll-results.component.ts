import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { BoardService, Board, PollData } from '../board.service';
import { AuthService } from '../auth.service';
import { Unsubscribe } from 'firebase/database';

@Component({
  selector: 'app-poll-results',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatToolbarModule,
    MatSnackBarModule,
  ],
  templateUrl: './poll-results.component.html',
  styleUrls: ['./poll-results.component.css'],
})
export class PollResultsComponent implements OnInit, OnDestroy {
  boardKey: string = '';
  board: Board | null = null;
  pollData: PollData | null = null;
  loading = true;
  error = '';
  voteStats: {
    totalVotes: number;
    votesByOption: { optionId: string; count: number; percentage: number }[];
    votesOverTime: { date: string; count: number }[];
  } | null = null;
  private pollUnsubscribe?: Unsubscribe;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private boardsService: BoardService,
    private authService: AuthService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    this.boardKey = this.route.snapshot.paramMap.get('boardKey') || '';
    
    if (!this.boardKey) {
      this.error = 'Board ID is required';
      this.loading = false;
      return;
    }

    try {
      // Load board and verify ownership
      this.board = await this.boardsService.getBoard(this.boardKey);
      
      if (!this.board) {
        this.error = 'Board not found';
        this.loading = false;
        return;
      }

      // Verify user is the owner
      const currentUser = this.authService.user;
      if (!currentUser || currentUser.uid !== this.board.ownerUid) {
        this.error = 'You are not authorized to view these results';
        this.loading = false;
        this.snackBar.open('You can only view results for your own polls', 'OK', {
          duration: 3000,
          panelClass: ['error-snackbar'],
        });
        return;
      }

      // Check if board is a poll
      if (this.board.boardType !== 'poll' || !this.board.pollData) {
        this.error = 'This board is not a poll';
        this.loading = false;
        return;
      }

      this.pollData = this.board.pollData;

      // Load vote statistics
      await this.loadVoteStats();

      // Subscribe to poll updates
      this.pollUnsubscribe = this.boardsService.subscribeToPollUpdates(
        this.boardKey,
        async (poll) => {
          if (poll) {
            this.pollData = poll;
            await this.loadVoteStats();
            this.cdr.detectChanges();
          }
        }
      );

      this.loading = false;
    } catch (error: any) {
      console.error('Error loading poll results:', error);
      this.error = error?.message || 'Failed to load poll results';
      this.loading = false;
      this.snackBar.open(this.error, 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    }
  }

  ngOnDestroy(): void {
    if (this.pollUnsubscribe) {
      this.pollUnsubscribe();
    }
  }

  async loadVoteStats(): Promise<void> {
    if (!this.boardKey) return;

    try {
      this.voteStats = await this.boardsService.getPollVoteStats(this.boardKey);
    } catch (error: any) {
      console.error('Error loading vote stats:', error);
    }
  }

  getOptionById(optionId: string): PollData['options'][0] | undefined {
    if (!this.pollData) return undefined;
    return this.pollData.options.find((opt) => opt.id === optionId);
  }

  getOptionPercentage(optionId: string): number {
    if (!this.voteStats || this.voteStats.totalVotes === 0) return 0;
    const optionStats = this.voteStats.votesByOption.find((v) => v.optionId === optionId);
    return optionStats?.percentage || 0;
  }

  getOptionCount(optionId: string): number {
    if (!this.voteStats) return 0;
    const optionStats = this.voteStats.votesByOption.find((v) => v.optionId === optionId);
    return optionStats?.count || 0;
  }
}







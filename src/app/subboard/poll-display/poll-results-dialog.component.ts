import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import { PollData, PollOption, BoardService } from '../../board.service';

export interface PollResultsDialogData {
  pollData: PollData;
  boardKey: string;
  isAdmin: boolean;
}

@Component({
  selector: 'app-poll-results-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatInputModule,
    MatFormFieldModule,
    FormsModule,
  ],
  template: `
    <div class="poll-results-dialog">
      <h2 mat-dialog-title class="dialog-title">
        <mat-icon>poll</mat-icon>
        Poll Results
      </h2>
      
      <mat-dialog-content class="dialog-content">
        <div class="results-list">
          <div
            class="result-item"
            *ngFor="let option of pollData.options; let i = index"
          >
            <div class="result-header">
              <span class="result-label">{{ option.text }}</span>
              <span class="result-stats">
                <span *ngIf="!isAdmin">
                  {{ getOptionPercentage(option) | number: '1.1-1' }}%
                </span>
                <span *ngIf="isAdmin" class="admin-stats">
                  <input 
                    type="number" 
                    [(ngModel)]="voteCounts[i]" 
                    [name]="'voteCount_' + i"
                    (change)="onVoteCountChange(i, voteCounts[i])"
                    class="vote-count-input"
                    min="0"
                  />
                  votes ({{ getOptionPercentage(option) | number: '1.1-1' }}%)
                </span>
              </span>
            </div>
            <mat-progress-bar
              mode="determinate"
              [value]="getOptionPercentage(option)"
              class="result-progress"
            ></mat-progress-bar>
          </div>
        </div>
        <div class="total-votes">
          <strong>Total Votes: {{ pollData.totalVotes || 0 }}</strong>
        </div>
      </mat-dialog-content>
      
      <mat-dialog-actions class="dialog-actions">
        <button mat-button (click)="close()" class="close-btn">Close</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .poll-results-dialog {
      padding: 0;
      min-width: 400px;
      max-width: 600px;
    }

    .dialog-title {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 24px;
      font-weight: 600;
      color: #1976d2;
      margin: 0 0 8px 0;
      padding: 24px 24px 16px 24px;
    }

    .dialog-title mat-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
    }

    .dialog-content {
      padding: 0 24px 24px 24px;
      max-height: 70vh;
      overflow-y: auto;
    }

    .results-list {
      margin-bottom: 20px;
    }

    .result-item {
      margin-bottom: 20px;
    }

    .result-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .result-label {
      font-weight: 500;
      color: #1f2937;
      flex: 1;
    }

    .result-stats {
      font-size: 14px;
      color: #6b7280;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .admin-stats {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .vote-count-input {
      width: 60px;
      padding: 4px 8px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 14px;
      text-align: center;
    }

    .vote-count-input:focus {
      outline: none;
      border-color: #1976d2;
    }

    .result-progress {
      height: 8px;
      border-radius: 4px;
    }

    .total-votes {
      text-align: center;
      padding: 16px;
      background: #f3f4f6;
      border-radius: 8px;
      margin-top: 20px;
    }

    .total-votes strong {
      color: #1f2937;
      font-size: 16px;
    }

    .dialog-actions {
      padding: 16px 24px 24px 24px;
      display: flex;
      justify-content: flex-end;
      margin: 0;
    }

    .close-btn {
      color: #1976d2;
      font-weight: 500;
    }

    @media (max-width: 600px) {
      .poll-results-dialog {
        min-width: unset;
        max-width: 90vw;
      }

      .dialog-title {
        font-size: 20px;
        padding: 20px 20px 12px 20px;
      }

      .dialog-content {
        padding: 0 20px 20px 20px;
      }

      .vote-count-input {
        width: 50px;
      }
    }
  `],
})
export class PollResultsDialogComponent {
  pollData: PollData;
  boardKey: string;
  isAdmin: boolean;
  voteCounts: number[] = [];

  constructor(
    public dialogRef: MatDialogRef<PollResultsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PollResultsDialogData,
    private boardsService: BoardService
  ) {
    this.pollData = data.pollData;
    this.boardKey = data.boardKey;
    this.isAdmin = data.isAdmin;
    // Initialize vote counts array
    this.voteCounts = this.pollData.options.map((opt: PollOption) => opt.voteCount || 0);
  }

  getOptionPercentage(option: PollOption): number {
    if (!this.pollData || this.pollData.totalVotes === 0) {
      return 0;
    }
    return (option.voteCount / this.pollData.totalVotes) * 100;
  }

  async onVoteCountChange(index: number, newCount: number): Promise<void> {
    if (!this.isAdmin || newCount < 0 || !this.pollData) {
      return;
    }

    try {
      const option = this.pollData.options[index];
      const oldCount = option.voteCount || 0;
      const difference = newCount - oldCount;

      // Update the option vote count
      option.voteCount = newCount;

      // Update total votes
      this.pollData.totalVotes = this.pollData.options.reduce(
        (sum: number, opt: PollOption) => sum + (opt.voteCount || 0),
        0
      );

      // Update in Firebase
      await this.boardsService.updatePollVoteCount(
        this.boardKey,
        option.id,
        newCount
      );

      // Update total votes in Firebase
      await this.boardsService.updatePollTotalVotes(
        this.boardKey,
        this.pollData.totalVotes
      );

      this.voteCounts[index] = newCount;
    } catch (error: any) {
      console.error('Error updating vote count:', error);
      // Revert on error
      this.voteCounts[index] = this.pollData.options[index].voteCount || 0;
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}


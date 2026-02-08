import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-primary-board-info-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
  ],
  template: `
    <div class="primary-board-info-dialog">
      <h2 mat-dialog-title class="dialog-title">
        <mat-icon class="title-icon">info</mat-icon>
        Board Options
      </h2>
      
      <mat-dialog-content class="dialog-content">
        <div class="info-section">
          <h3 class="section-title">
            <mat-icon class="section-icon">star</mat-icon>
            Primary Board
          </h3>
          <ul class="info-list">
            <li>If selected, this board will be shown on the view board page.</li>
            <li>Only one board can be set as primary at a time.</li>
            <li>When you set a board as primary, it will be visible to visitors on the main view board page.</li>
            <li>Primary boards are featured prominently and are the first thing visitors see.</li>
            <li>You can change your primary board at any time by selecting a different board.</li>
          </ul>
        </div>
        
      </mat-dialog-content>
      
      <mat-dialog-actions class="dialog-actions">
        <button mat-button (click)="close()" class="close-btn">Got it</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .primary-board-info-dialog {
      padding: 0;
    }

    .dialog-title {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 0 0 20px 0;
      font-size: 20px;
      font-weight: 600;
      color: #1f2937;
    }

    .title-icon {
      color: #3b82f6;
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    .dialog-content {
      padding: 0;
      margin: 0 0 24px 0;
    }

    .info-section {
      margin-bottom: 24px;
    }

    .info-section:last-child {
      margin-bottom: 0;
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 16px;
      font-weight: 600;
      color: #1f2937;
      margin: 0 0 12px 0;
    }

    .section-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: #3b82f6;
    }

    .info-list {
      margin: 0;
      padding-left: 20px;
      list-style-type: disc;
    }

    .info-list li {
      font-size: 14px;
      line-height: 1.8;
      color: #4b5563;
      margin-bottom: 8px;
    }

    .info-list li:last-child {
      margin-bottom: 0;
    }

    .dialog-actions {
      padding: 0;
      margin: 0;
      justify-content: flex-end;
    }

    .close-btn {
      color: #3b82f6;
      font-weight: 500;
    }
  `]
})
export class PrimaryBoardInfoDialogComponent {
  constructor(private dialogRef: MatDialogRef<PrimaryBoardInfoDialogComponent>) {}

  close(): void {
    this.dialogRef.close();
  }
}




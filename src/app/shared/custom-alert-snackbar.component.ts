import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

export interface CustomAlertData {
  title?: string;
  message: string;
  type: 'info' | 'error' | 'warning' | 'success';
}

@Component({
  selector: 'app-custom-alert-snackbar',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  template: `
    <div class="custom-alert-container" [ngClass]="'alert-' + (data.type || 'info')" *ngIf="data">
      <div class="alert-left-bar"></div>
      <div class="alert-icon-wrapper">
        <mat-icon class="alert-icon">{{ getIcon() }}</mat-icon>
      </div>
      <div class="alert-content">
        <div class="alert-title" *ngIf="data.title">{{ data.title }}</div>
        <div class="alert-message">{{ getMessage() }}</div>
      </div>
      <button mat-icon-button class="alert-close" (click)="dismiss()">
        <mat-icon>close</mat-icon>
      </button>
    </div>
  `,
  styles: [`
    .custom-alert-container {
      display: flex;
      align-items: stretch; /* Ensures the left bar fills the height */
      background: #ffffff !important;
      background-color: #ffffff !important;
      border: none !important;
      border-radius: 8px;
      min-width: 320px;
      max-width: 450px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      pointer-events: auto;
      position: relative;
      z-index: 1;
    }

    .alert-left-bar {
      width: 6px;
      flex-shrink: 0;
    }

    .alert-icon-wrapper {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 16px 12px;
      flex-shrink: 0;
    }

    .alert-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: #fff;
    }

    .alert-content {
      flex: 1;
      padding: 16px 12px 16px 0;
    }

    .alert-title {
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 2px;
      font-size: 14px;
    }

    .alert-message {
      font-size: 13px;
      color: #666;
      line-height: 1.4;
    }

    .alert-close {
      margin-top: 8px;
      margin-right: 4px;
      color: #999;
    }

    /* Type Specific Colors */
    .alert-info .alert-left-bar, .alert-info .alert-icon-wrapper { background-color: #2563eb; }
    .alert-error .alert-left-bar, .alert-error .alert-icon-wrapper { background-color: #ef4444; }
    .alert-warning .alert-left-bar, .alert-warning .alert-icon-wrapper { background-color: #f97316; }
    .alert-success .alert-left-bar, .alert-success .alert-icon-wrapper { background-color: #16a34a; }
  `]
})
export class CustomAlertSnackbarComponent implements OnInit {
  @Input() data: CustomAlertData = { message: '', type: 'info' };
  dismissCallback?: () => void;

  ngOnInit() {
    // Ensure data is initialized
    if (!this.data) {
      this.data = { message: '', type: 'info' };
    }
  }

  getIcon(): string {
    if (!this.data || !this.data.type) return 'info';
    const icons = { info: 'info', error: 'error', warning: 'warning', success: 'check_circle' };
    return icons[this.data.type] || 'info';
  }

  getMessage(): string {
    if (!this.data) return '';
    return this.data.message || '';
  }

  dismiss() {
    if (this.dismissCallback) {
      this.dismissCallback();
    }
  }
}
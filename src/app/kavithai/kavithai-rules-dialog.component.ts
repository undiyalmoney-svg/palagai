import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface KavithaiRulesDialogData {
  // No data needed for rules dialog
}

@Component({
  selector: 'app-kavithai-rules-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="kavithai-rules-dialog-wrapper">
      <h2 mat-dialog-title>
        <mat-icon>info</mat-icon>
        Kavithai Competition Rules
      </h2>
      
      <mat-dialog-content>
        <div class="rules-section">
          <h3>📝 Submission Guidelines</h3>
          <ul>
            <li><strong>Competition Title: <span style="font-weight: 700; font-size: 1.1em;">என்னவள்</span></strong> - Your kavithai should be in this topic.</li>
            <li>Submit your original kavithai (poem) using the editor</li>
            <li>Maximum length: <strong>500 characters</strong> (including title, content, and signature)</li>
            <li>Format: Title, Content, and Signature</li>
            <li>Example format: <em>"தலைப்பு: [Title] ... இப்படிக்கு: [Your Name]"</em></li>
            <li>You can submit your kavithai in <strong>English</strong>, <strong>Tamil</strong>, or even <strong>Thanglish</strong> too</li>
          </ul>
        </div>

        <div class="rules-section">
          <h3>📧 Email Requirement</h3>
          <p>
            Please provide a <strong>valid email address</strong>. 
            If your kavithai wins, our team will contact you through this email.
          </p>
          <p>
            <strong>Use unique emails.</strong> Only one kavithai per email is allowed. Duplicates will be rejected.
          </p>
        </div>

        <div class="rules-section">
          <h3>⭐ Voting</h3>
          <ul>
            <li>Each person can vote once per kavithai</li>
            <li>Votes are tracked to ensure fairness</li>
            <li>You can vote for multiple kavithai entries</li>
          </ul>
        </div>

        <div class="rules-section">
          <h3>📅 Important Dates</h3>
          <p>
            Competition ends on <strong>28th Feb</strong>. 
            For any queries, send email to <strong>palagaiofficial@gmail.com</strong>.
          </p>
        </div>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-raised-button color="primary" (click)="onClose()">
          Got it!
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .kavithai-rules-dialog-wrapper {
      padding: 0;
      min-width: 400px;
      max-width: 600px;
    }

    h2[mat-dialog-title] {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 0 0 20px 0;
      padding-bottom: 16px;
      border-bottom: 2px solid #e0e0e0;
      color: #1976d2;
    }

    h2[mat-dialog-title] mat-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
    }

    mat-dialog-content {
      padding: 20px 24px;
      max-height: 60vh;
      overflow-y: auto;
    }

    .rules-section {
      margin-bottom: 24px;
    }

    .rules-section:last-child {
      margin-bottom: 0;
    }

    .rules-section h3 {
      margin: 0 0 12px 0;
      color: #333;
      font-size: 18px;
      font-weight: 600;
    }

    .rules-section p {
      margin: 8px 0;
      line-height: 1.6;
      color: #666;
    }

    .rules-section ul {
      margin: 8px 0;
      padding-left: 24px;
      color: #666;
    }

    .rules-section li {
      margin: 8px 0;
      line-height: 1.6;
    }

    .rules-section strong {
      color: #1976d2;
      font-weight: 600;
    }

    .rules-section em {
      color: #666;
      font-style: italic;
    }

    mat-dialog-actions {
      padding: 16px 24px;
      margin: 0;
      border-top: 1px solid #e0e0e0;
    }

    @media (max-width: 600px) {
      .kavithai-rules-dialog-wrapper {
        min-width: auto;
        max-width: 100%;
      }

      mat-dialog-content {
        padding: 16px;
        max-height: 50vh;
      }

      h2[mat-dialog-title] {
        font-size: 20px;
      }

      .rules-section h3 {
        font-size: 16px;
      }
    }
  `]
})
export class KavithaiRulesDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<KavithaiRulesDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: KavithaiRulesDialogData
  ) {}

  onClose(): void {
    this.dialogRef.close();
  }
}




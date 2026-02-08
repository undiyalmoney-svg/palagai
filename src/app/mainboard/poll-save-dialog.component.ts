import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormControl, Validators, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';

export interface PollSaveDialogData {
  question: string;
  options: string[];
}

export interface PollSaveDialogResult {
  endDate: Date;
  allowMultiple: boolean;
}

@Component({
  selector: 'app-poll-save-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatNativeDateModule,
  ],
  template: `
    <div class="poll-save-dialog-wrapper">
      <h2 mat-dialog-title class="dialog-title">
        <mat-icon class="title-icon">poll</mat-icon>
        Poll Settings
      </h2>
      
      <mat-dialog-content class="dialog-content">
        <div class="poll-preview">
          <p class="preview-label">Poll Preview:</p>
          <div class="preview-question">
            <strong>{{ data.question }}</strong>
          </div>
          <div class="preview-options">
            <div class="preview-option" *ngFor="let option of data.options">
              • {{ option }}
            </div>
          </div>
        </div>

        <form [formGroup]="settingsForm" class="settings-form">
          <!-- Expiry Date -->
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Expiry Date *</mat-label>
            <input 
              matInput 
              [matDatepicker]="picker" 
              formControlName="endDate" 
              [min]="minDate" 
              [max]="maxDate"
              placeholder="Select expiry date"
            />
            <mat-datepicker-toggle matSuffix [for]="picker"></mat-datepicker-toggle>
            <mat-datepicker #picker></mat-datepicker>
            <mat-hint>Poll will expire on this date (within 30 days)</mat-hint>
            <mat-error *ngIf="settingsForm.get('endDate')?.hasError('required') && settingsForm.get('endDate')?.touched">
              Expiry date is required
            </mat-error>
            <mat-error *ngIf="settingsForm.get('endDate')?.hasError('pastDate')">
              Expiry date cannot be in the past
            </mat-error>
            <mat-error *ngIf="settingsForm.get('endDate')?.hasError('futureDate')">
              Expiry date must be within 30 days from today. For longer periods, contact admin for super board access.
            </mat-error>
          </mat-form-field>

          <!-- Allow Multiple Selection -->
          <div class="checkbox-group">
            <mat-checkbox formControlName="allowMultiple">
              Allow users to select multiple options
            </mat-checkbox>
          </div>
        </form>
      </mat-dialog-content>
      
      <mat-dialog-actions class="dialog-actions">
        <button 
          mat-button 
          (click)="cancel()" 
          class="cancel-btn"
        >
          Cancel
        </button>
        <button 
          mat-raised-button 
          color="primary"
          (click)="save()" 
          [disabled]="settingsForm.invalid"
          class="save-btn"
        >
          <mat-icon>save</mat-icon>
          Save Poll
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .poll-save-dialog-wrapper {
      display: flex;
      flex-direction: column;
      width: 100%;
      max-width: 500px;
      margin: 0 auto;
    }

    .dialog-title {
      margin: 0;
      padding: 20px 20px 0 20px;
      font-size: 20px;
      font-weight: 600;
      color: #111111;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .title-icon {
      color: #667eea;
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    .dialog-content {
      padding: 20px !important;
      margin: 0 !important;
      max-height: 70vh;
      overflow-y: auto;
    }

    .poll-preview {
      background-color: #f5f5f5;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
    }

    .preview-label {
      margin: 0 0 12px 0;
      font-size: 14px;
      font-weight: 500;
      color: #666;
    }

    .preview-question {
      margin-bottom: 12px;
      font-size: 16px;
      color: #111;
      line-height: 1.5;
    }

    .preview-options {
      margin-top: 12px;
    }

    .preview-option {
      margin-bottom: 8px;
      font-size: 14px;
      color: #555;
      line-height: 1.5;
    }

    .preview-option:last-child {
      margin-bottom: 0;
    }

    .settings-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .full-width {
      width: 100%;
    }

    .checkbox-group {
      margin-top: 8px;
    }

    .dialog-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      padding: 0 20px 20px 20px !important;
      margin: 0 !important;
      min-height: auto;
    }

    .cancel-btn {
      min-width: 100px;
    }

    .save-btn {
      min-width: 140px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    @media (max-width: 600px) {
      .poll-save-dialog-wrapper {
        max-width: 90vw;
      }

      .dialog-content {
        padding: 16px !important;
      }

      .dialog-title {
        padding: 16px 16px 0 16px;
        font-size: 18px;
      }

      .poll-preview {
        padding: 12px;
      }

      .dialog-actions {
        flex-direction: column;
        gap: 12px;
        padding: 0 16px 16px 16px !important;
      }

      .cancel-btn,
      .save-btn {
        width: 100%;
      }
    }
  `]
})
export class PollSaveDialogComponent {
  settingsForm: FormGroup;
  minDate = new Date();
  maxDate: Date;

  constructor(
    public dialogRef: MatDialogRef<PollSaveDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PollSaveDialogData,
    private fb: FormBuilder
  ) {
    // Set default end date to 30 days from today
    const defaultEndDate = new Date();
    defaultEndDate.setDate(defaultEndDate.getDate() + 30);
    
    // Set max date to 30 days from today
    this.maxDate = new Date();
    this.maxDate.setDate(this.maxDate.getDate() + 30);
    
    this.settingsForm = this.fb.group({
      endDate: [defaultEndDate, [Validators.required, this.dateWithin30DaysValidator()]],
      allowMultiple: [false],
    });
  }

  // Custom validator to ensure date is within 30 days from today
  dateWithin30DaysValidator() {
    return (control: FormControl): { [key: string]: any } | null => {
      if (!control.value) {
        return { required: true };
      }
      
      const selectedDate = new Date(control.value);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const maxDate = new Date();
      maxDate.setDate(maxDate.getDate() + 30);
      maxDate.setHours(23, 59, 59, 999);
      
      selectedDate.setHours(0, 0, 0, 0);
      
      if (selectedDate < today) {
        return { pastDate: { message: 'Expiry date cannot be in the past' } };
      }
      
      if (selectedDate > maxDate) {
        return { futureDate: { message: 'Expiry date must be within 30 days from today' } };
      }
      
      return null;
    };
  }

  save() {
    if (this.settingsForm.invalid) {
      this.settingsForm.markAllAsTouched();
      return;
    }

    const formValue = this.settingsForm.value;
    this.dialogRef.close({
      endDate: formValue.endDate,
      allowMultiple: formValue.allowMultiple || false,
    } as PollSaveDialogResult);
  }

  cancel() {
    this.dialogRef.close(null);
  }
}





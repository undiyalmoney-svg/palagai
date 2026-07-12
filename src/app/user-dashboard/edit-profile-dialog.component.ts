import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';

export interface EditProfileDialogData {
  name?: string;
  email: string;
  dateOfBirth?: string;
}

export interface EditProfileDialogResult {
  name?: string;
  email: string;
  dateOfBirth?: string;
}

@Component({
  selector: 'app-edit-profile-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
  ],
  template: `
    <div class="edit-profile-dialog">
      <h2 mat-dialog-title class="dialog-title">
        <mat-icon class="title-icon">edit</mat-icon>
        Edit Profile
      </h2>
      
      <mat-dialog-content class="dialog-content">
        <form [formGroup]="profileForm" class="edit-form">
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Name</mat-label>
            <input matInput formControlName="name" placeholder="Enter your name" />
            <mat-hint>Optional</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Email</mat-label>
            <input matInput formControlName="email" type="email" placeholder="Enter your email" />
            <mat-error *ngIf="profileForm.get('email')?.hasError('required')">
              Email is required
            </mat-error>
            <mat-error *ngIf="profileForm.get('email')?.hasError('email')">
              Enter a valid email
            </mat-error>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Date of Birth</mat-label>
            <input matInput [matDatepicker]="picker" formControlName="dateOfBirth" />
            <mat-datepicker-toggle matSuffix [for]="picker"></mat-datepicker-toggle>
            <mat-datepicker #picker></mat-datepicker>
            <mat-hint>Optional</mat-hint>
          </mat-form-field>
        </form>
      </mat-dialog-content>
      
      <mat-dialog-actions class="dialog-actions">
        <button mat-button (click)="cancel()" class="cancel-btn">Cancel</button>
        <button 
          mat-raised-button 
          color="primary" 
          (click)="save()" 
          [disabled]="profileForm.invalid"
          class="save-btn"
        >
          Save
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .edit-profile-dialog {
      padding: 0;
      min-width: 400px;
    }

    .dialog-title {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 0 0 24px 0;
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
      min-height: 200px;
    }

    .edit-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .full-width {
      width: 100%;
    }

    .dialog-actions {
      padding: 0;
      margin: 0;
      justify-content: flex-end;
      gap: 12px;
    }

    .cancel-btn {
      color: #6b7280;
    }

    .save-btn {
      min-width: 100px;
    }

    @media (max-width: 600px) {
      .edit-profile-dialog {
        min-width: 280px;
      }
    }
  `]
})
export class EditProfileDialogComponent implements OnInit {
  profileForm: FormGroup;

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<EditProfileDialogComponent, EditProfileDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: EditProfileDialogData
  ) {
    this.profileForm = this.fb.group({
      name: ['', [Validators.maxLength(100)]],
      email: ['', [Validators.required, Validators.email]],
      dateOfBirth: [null],
    });
  }

  ngOnInit(): void {
    // Set initial form values
    this.profileForm.patchValue({
      name: this.data.name || '',
      email: this.data.email || '',
      dateOfBirth: this.data.dateOfBirth ? new Date(this.data.dateOfBirth) : null,
    });
  }

  cancel(): void {
    this.dialogRef.close();
  }

  save(): void {
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }

    const formValue = this.profileForm.value;
    const result: EditProfileDialogResult = {
      name: formValue.name?.trim() || '',
      email: formValue.email?.trim().toLowerCase(),
      dateOfBirth: formValue.dateOfBirth ? formValue.dateOfBirth.toISOString().split('T')[0] : undefined,
    };

    this.dialogRef.close(result);
  }
}




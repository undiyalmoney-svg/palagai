import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink } from '@angular/router';
import { BoardService } from '../board.service';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-post-job',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatCardModule,
    MatSnackBarModule,
    MatToolbarModule,
  ],
  templateUrl: './post-job.component.html',
  styleUrl: './post-job.component.css',
})
export class PostJobComponent implements OnInit {
  jobForm: FormGroup;
  submitting = false;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private boardsService: BoardService,
    private authService: AuthService,
    private snackBar: MatSnackBar
  ) {
    this.jobForm = this.fb.group({
      title: ['', [Validators.required, Validators.maxLength(100)]],
      company: ['', [Validators.required, Validators.maxLength(100)]],
      description: ['', [Validators.required, Validators.maxLength(1000)]],
      location: ['', [Validators.required, Validators.maxLength(100)]],
      contactEmail: ['', [Validators.required, Validators.email]],
    });
  }

  ngOnInit(): void {
    // Ensure body overflow is enabled
    if (typeof window !== 'undefined') {
      document.body.style.overflow = 'auto';
    }
  }

  async onSubmit(): Promise<void> {
    if (this.jobForm.invalid || this.submitting) {
      return;
    }

    this.submitting = true;

    try {
      const user = this.authService.user;
      if (!user || !user.email) {
        this.snackBar.open('Please login to post a job', 'OK', {
          duration: 3000,
          panelClass: ['error-snackbar'],
        });
        this.router.navigate(['/login']);
        return;
      }

      const jobData = {
        title: this.jobForm.value.title.trim(),
        company: this.jobForm.value.company.trim(),
        description: this.jobForm.value.description.trim(),
        location: this.jobForm.value.location.trim(),
        contactEmail: this.jobForm.value.contactEmail.trim(),
        createdBy: user.email,
      };

      await this.boardsService.createJob(jobData);

      this.snackBar.open('✅ Job posted successfully!', 'OK', {
        duration: 3000,
        panelClass: ['success-snackbar'],
      });

      // Redirect to job list
      this.router.navigate(['/jobs']);
    } catch (error: any) {
      console.error('Error posting job:', error);
      this.snackBar.open(error?.message || 'Failed to post job. Please try again.', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
    } finally {
      this.submitting = false;
    }
  }
}


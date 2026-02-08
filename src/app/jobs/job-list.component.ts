import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink } from '@angular/router';
import { BoardService, Job } from '../board.service';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-job-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatToolbarModule,
  ],
  templateUrl: './job-list.component.html',
  styleUrl: './job-list.component.css',
})
export class JobListComponent implements OnInit, OnDestroy {
  jobs: Job[] = [];
  loading = false;
  error: string | null = null;
  isLoggedIn = false;

  constructor(
    private boardsService: BoardService,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Ensure body overflow is enabled
    if (typeof window !== 'undefined') {
      document.body.style.overflow = 'auto';
    }

    this.isLoggedIn = !!this.authService.user;
    this.loadJobs();
  }

  ngOnDestroy(): void {
    // Clean up if needed
  }

  async loadJobs(): Promise<void> {
    this.loading = true;
    this.error = null;

    try {
      this.jobs = await this.boardsService.getAllJobs();
    } catch (err: any) {
      console.error('Error loading jobs:', err);
      this.error = err?.message || 'Failed to load jobs. Please try again.';
    } finally {
      this.loading = false;
    }
  }

  formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  postJob(): void {
    if (this.isLoggedIn) {
      this.router.navigate(['/jobs/post']);
    } else {
      this.router.navigate(['/login'], { queryParams: { returnUrl: '/jobs/post' } });
    }
  }

  contactJob(job: Job): void {
    window.location.href = `mailto:${job.contactEmail}?subject=Application for ${job.title}`;
  }
}


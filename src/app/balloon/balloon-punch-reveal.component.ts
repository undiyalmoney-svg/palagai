import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

interface BalloonData {
  punchCount: number;
  message: string;
  icon?: number;
}

@Component({
  selector: 'app-balloon-punch-reveal',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
  ],
  templateUrl: './balloon-punch-reveal.component.html',
  styleUrls: ['./balloon-punch-reveal.component.css']
})
export class BalloonPunchRevealComponent implements OnInit, OnDestroy {
  totalPunchCount: number = 0;
  currentPunchCount: number = 0;
  isBurst: boolean = false;
  decodedMessage: string = '';
  hasError: boolean = false;
  errorMessage: string = '';
  lastClickTime: number = 0;
  clickThrottleMs: number = 300;
  storageKey: string = '';
  isZooming: boolean = false;
  selectedIcon: number = 1; // Default to icon 1

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Prevent body scrolling
    if (typeof document !== 'undefined') {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    }

    const dataParam = this.route.snapshot.paramMap.get('data');
    
    if (!dataParam) {
      this.showError('Invalid link. No data found.');
      return;
    }

    this.storageKey = `balloon_${dataParam}`;

    try {
      // Decode Base64 (URL-safe)
      const base64String = dataParam
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      
      // Add padding if needed
      const padded = base64String + '='.repeat((4 - base64String.length % 4) % 4);
      const jsonString = atob(padded);
      const data: BalloonData = JSON.parse(jsonString);

      // Validate data
      if (!data.punchCount || !data.message || data.punchCount < 1 || data.punchCount > 1000) {
        this.showError('Invalid data. Please check your link.');
        return;
      }

      this.totalPunchCount = data.punchCount;
      this.decodedMessage = data.message;
      this.selectedIcon = data.icon || 1; // Default to icon 1 if not provided

      // Restore progress from sessionStorage
      this.restoreProgress();
    } catch (error) {
      console.error('Error decoding data:', error);
      this.showError('Failed to decode link. Please check your link and try again.');
    }
  }

  ngOnDestroy(): void {
    // Restore body scrolling
    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }
  }

  private restoreProgress(): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const saved = sessionStorage.getItem(this.storageKey);
      if (saved) {
        const savedCount = parseInt(saved, 10);
        if (savedCount >= 0 && savedCount < this.totalPunchCount) {
          this.currentPunchCount = savedCount;
        } else if (savedCount >= this.totalPunchCount) {
          // Already completed
          this.currentPunchCount = this.totalPunchCount;
          this.isBurst = true;
        }
      }
    } catch (error) {
      console.error('Error restoring progress:', error);
    }
  }

  private saveProgress(): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      sessionStorage.setItem(this.storageKey, this.currentPunchCount.toString());
    } catch (error) {
      console.error('Error saving progress:', error);
    }
  }

  private showError(message: string): void {
    this.hasError = true;
    this.errorMessage = message;
    this.cdr.detectChanges();
  }


  handlePunch(): void {
    // Throttle clicks
    const now = Date.now();
    if (now - this.lastClickTime < this.clickThrottleMs) {
      return;
    }

    // Ignore if already burst
    if (this.isBurst) {
      return;
    }

    this.lastClickTime = now;
    
    // Trigger zoom animation
    this.isZooming = true;
    setTimeout(() => {
      this.isZooming = false;
      this.cdr.detectChanges();
    }, 300);

    this.currentPunchCount++;

    // Save progress
    this.saveProgress();

    // Check if burst
    if (this.currentPunchCount >= this.totalPunchCount) {
      this.currentPunchCount = this.totalPunchCount;
      this.isBurst = true;
      // Trigger burst animation
      setTimeout(() => {
        this.cdr.detectChanges();
      }, 100);
    }

    this.cdr.detectChanges();
  }

  goHome(): void {
    this.router.navigate(['/']);
  }

  get balloonScale(): number {
    if (this.isBurst) {
      return 0;
    }
    return 1 + (this.currentPunchCount / this.totalPunchCount) * 0.8;
  }

  get progressPercentage(): number {
    return Math.min((this.currentPunchCount / this.totalPunchCount) * 100, 100);
  }

  get progressPercentageText(): string {
    return Math.round(this.progressPercentage) + '%';
  }

  get isNearFinal(): boolean {
    return this.currentPunchCount >= this.totalPunchCount * 0.8 && !this.isBurst;
  }
}


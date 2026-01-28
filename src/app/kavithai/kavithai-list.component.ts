import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BoardService, Kavithai } from '../board.service';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Unsubscribe } from 'firebase/database';

// Obfuscated localStorage keys (made to look like app preferences/analytics)
const VOTED_KAVITHAI_KEY = 'app_pref_cache_v3'; // Stores voted kavithai IDs
const USER_ANALYTICS_ID = 'usr_analytics_id'; // Stores user session/analytics ID

// Initialize dummy localStorage keys to obfuscate voting data
function initializeDummyLocalStorage() {
  if (typeof window === 'undefined') return;
  
  try {
    // Add dummy keys that look like normal app preferences
    if (!localStorage.getItem('ui_theme_pref')) {
      localStorage.setItem('ui_theme_pref', 'light');
    }
    if (!localStorage.getItem('last_visit_ts')) {
      localStorage.setItem('last_visit_ts', Date.now().toString());
    }
    if (!localStorage.getItem('cache_ver')) {
      localStorage.setItem('cache_ver', '1.0');
    }
    if (!localStorage.getItem('lang_pref')) {
      localStorage.setItem('lang_pref', 'en');
    }
    if (!localStorage.getItem('app_metrics_enabled')) {
      localStorage.setItem('app_metrics_enabled', 'true');
    }
  } catch (e) {
    // Ignore localStorage errors
  }
}

interface KavithaiItem {
  kavithai: Kavithai;
  voteCount: number;
  unsubscribe?: Unsubscribe;
}

@Component({
  selector: 'app-kavithai-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatToolbarModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './kavithai-list.component.html',
  styleUrls: ['./kavithai-list.component.css', '../subboard/display-renderer.css'],
})
export class KavithaiListComponent implements OnInit, OnDestroy {
  allKavithai: KavithaiItem[] = [];
  displayedKavithai: KavithaiItem[] = [];
  loading = true;
  userIP: string = '';
  votedKavithai: Set<string> = new Set(); // Track kavithai voted in this session

  // Pagination
  pageSize = 10;
  pageIndex = 0;
  pageSizeOptions = [5, 10, 20, 50];
  totalItems = 0;

  private voteUnsubscribes: Map<string, Unsubscribe> = new Map();

  constructor(
    private readonly boardsService: BoardService,
    private readonly snackBar: MatSnackBar,
    private readonly cdr: ChangeDetectorRef,
    private readonly sanitizer: DomSanitizer,
  ) {}

  async ngOnInit() {
    // Initialize dummy localStorage keys
    initializeDummyLocalStorage();
    
    // Ensure body overflow is enabled for scrolling on this page
    if (typeof window !== 'undefined') {
      document.body.style.overflow = 'auto';
      document.body.style.margin = '';
      document.body.style.padding = '';
      document.documentElement.style.overflow = 'auto';
    }
    
    try {
      await this.loadKavithai();
    } catch (error) {
      console.error('Error in ngOnInit:', error);
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  ngOnDestroy() {
    // Unsubscribe from all vote listeners
    this.voteUnsubscribes.forEach((unsubscribe) => unsubscribe());
    this.voteUnsubscribes.clear();
  }

  private async loadKavithai() {
    this.loading = true;
    this.allKavithai = [];
    this.cdr.detectChanges();

    try {
      // Get or create user ID for identification (from localStorage) - non-blocking
      if (typeof window !== 'undefined') {
        try {
          this.userIP = localStorage.getItem(USER_ANALYTICS_ID) || 
            await this.boardsService.getUserIP();
          
          if (!localStorage.getItem(USER_ANALYTICS_ID)) {
            localStorage.setItem(USER_ANALYTICS_ID, this.userIP);
          }

          // Load voted kavithai from localStorage (obfuscated key)
          try {
            const votedKavithai = localStorage.getItem(VOTED_KAVITHAI_KEY);
            if (votedKavithai) {
              const votedList = JSON.parse(votedKavithai);
              this.votedKavithai = new Set(votedList);
            }
          } catch (e) {
            // If corrupted, remove it
            localStorage.removeItem(VOTED_KAVITHAI_KEY);
          }
        } catch (e) {
          console.warn('Failed to get user IP or load voted kavithai:', e);
        }
      }

      // Fetch all kavithai entries
      const kavithaiList = await this.boardsService.getAllKavithai();
      
      this.allKavithai = kavithaiList.map((kavithai) => ({
        kavithai,
        voteCount: kavithai.voteCount || 0,
      }));

      // Set up real-time vote listeners for each kavithai
      this.allKavithai.forEach((item) => {
        const unsubscribe = this.boardsService.subscribeToKavithaiVoteCount(
          item.kavithai.id,
          (count) => {
            item.voteCount = count;
            this.cdr.detectChanges();
          }
        );
        this.voteUnsubscribes.set(item.kavithai.id, unsubscribe);
      });

      this.totalItems = this.allKavithai.length;
      this.updateDisplayedKavithai();

      // Only show snackbar in browser (not during SSR)
      if (typeof window !== 'undefined') {
        this.snackBar.open(`✅ Loaded ${this.allKavithai.length} kavithai entries`, 'OK', {
          duration: 2000,
          panelClass: ['success-snackbar'],
        });
      }
    } catch (error: any) {
      console.error('Error loading kavithai:', error);
      // Only show snackbar in browser (not during SSR)
      if (typeof window !== 'undefined') {
        this.snackBar.open(
          error?.message || 'Failed to load kavithai entries. Please try again.',
          'OK',
          {
            duration: 4000,
            panelClass: ['error-snackbar'],
          }
        );
      }
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  updateDisplayedKavithai() {
    const startIndex = this.pageIndex * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    this.displayedKavithai = this.allKavithai.slice(startIndex, endIndex);
  }

  onPageChange(event: PageEvent) {
    this.pageIndex = event.pageIndex;
    this.pageSize = event.pageSize;
    this.updateDisplayedKavithai();
  }

  trackByKavithaiId(index: number, item: KavithaiItem): string {
    return item.kavithai.id;
  }

  getSanitizedContent(content: string): SafeHtml {
    // Use DomSanitizer to preserve inline styles (like text-align)
    return this.sanitizer.bypassSecurityTrustHtml(content);
  }

  hasVoted(kavithaiId: string): boolean {
    return this.votedKavithai.has(kavithaiId);
  }

  async voteForKavithai(item: KavithaiItem) {
    const kavithaiId = item.kavithai.id;

    // Check if already voted
    if (this.hasVoted(kavithaiId)) {
      // Only show snackbar in browser (not during SSR)
      if (typeof window !== 'undefined') {
        this.snackBar.open('You have already voted for this kavithai', 'OK', {
          duration: 2000,
          panelClass: ['info-snackbar'],
        });
      }
      return;
    }

    try {
      // Get user IP if not already set
      if (!this.userIP) {
        this.userIP = await this.boardsService.getUserIP();
      }

      // Add vote
      await this.boardsService.addKavithaiVote(kavithaiId, this.userIP);

      // Mark as voted (store in localStorage with obfuscated key)
      this.votedKavithai.add(kavithaiId);
      if (typeof window !== 'undefined') {
        try {
          const votedKavithaiList = Array.from(this.votedKavithai);
          localStorage.setItem(VOTED_KAVITHAI_KEY, JSON.stringify(votedKavithaiList));
        } catch (e) {
          // If localStorage fails, just keep in memory
          console.warn('Failed to save voted kavithai to localStorage:', e);
        }
      }

      // Only show snackbar in browser (not during SSR)
      if (typeof window !== 'undefined') {
        this.snackBar.open('⭐ Thanks for your vote!', 'OK', {
          duration: 2000,
          panelClass: ['success-snackbar'],
        });
      }

      this.cdr.detectChanges();
    } catch (error: any) {
      console.error('Error voting for kavithai:', error);
      // Only show snackbar in browser (not during SSR)
      if (typeof window !== 'undefined') {
        this.snackBar.open(
          error?.message || 'Failed to submit vote. Please try again.',
          'OK',
          {
            duration: 3000,
            panelClass: ['error-snackbar'],
          }
        );
      }
    }
  }
}


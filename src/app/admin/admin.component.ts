import { Component, OnInit, OnDestroy, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AdminService } from '../admin.service';
import { BoardService, Board } from '../board.service';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';

interface BoardRow {
  boardKey: string;
  board: Board;
  ownerEmail?: string;
}

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [
    CommonModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatSnackBarModule,
    MatTableModule,
    MatChipsModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    MatTooltipModule,
  ],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.css',
})
export class AdminComponent implements OnInit, OnDestroy, AfterViewInit {
  boards: BoardRow[] = [];
  loading = true;
  displayedColumns: string[] = ['boardKey', 'ownerEmail', 'status', 'competition', 'actions'];
  private boardsSubscription?: Subscription;

  constructor(
    private readonly admin: AdminService,
    private readonly boardsService: BoardService,
    private readonly router: Router,
    private readonly snackBar: MatSnackBar,
    private readonly dialog: MatDialog,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    if (!this.admin.isAdminLoggedIn()) {
      this.router.navigate(['/admin/login']);
      return;
    }
    // Don't load boards here - wait for AfterViewInit
  }

  ngAfterViewInit() {
    // Load boards AFTER view is initialized to avoid change detection errors
    if (this.admin.isAdminLoggedIn()) {
      this.loadBoards();
    }
  }

  ngOnDestroy() {
    // Clean up subscription
    if (this.boardsSubscription) {
      this.boardsSubscription.unsubscribe();
    }
  }

  loadBoards() {
    if (this.loading && this.boards.length > 0) {
      return; // Prevent multiple simultaneous loads if already loaded
    }

    this.loading = true;
    this.boards = [];

    // Unsubscribe from previous subscription if exists
    if (this.boardsSubscription) {
      this.boardsSubscription.unsubscribe();
    }

    console.log('[Admin] Starting to load boards...');
    
    // Use Observable pattern with RxJS
    this.boardsSubscription = this.boardsService.getAllBoards$().subscribe({
      next: (boards) => {
        console.log('[Admin] Boards received:', boards.length);
        console.log('[Admin] Board data:', boards);
        
        // Update state
        this.boards = boards;
        this.loading = false;
        
        // Mark for check to ensure change detection runs properly
        this.cdr.markForCheck();
        
        console.log('[Admin] Boards assigned to component:', this.boards.length);
        console.log('[Admin] Loading complete. Final boards count:', this.boards.length);

        if (boards.length === 0) {
          console.log('[Admin] No boards found');
        }
      },
      error: (err: any) => {
        console.error('[Admin] Error loading boards:', err);
        this.snackBar.open(
          err?.message || 'Failed to load boards. Please check your Firebase connection.',
          'OK',
          {
            duration: 5000,
            panelClass: ['error-snackbar'],
          }
        );
        this.boards = [];
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  logout() {
    this.admin.logout();
  }

  async toggleCompetition(boardKey: string, currentStatus: boolean) {
    try {
      await this.boardsService.updateCompetitionSubmission(boardKey, !currentStatus);
      this.snackBar.open(
        !currentStatus ? 'Added to competition' : 'Removed from competition',
        'OK',
        { duration: 2000, panelClass: ['success-snackbar'] }
      );
      await this.loadBoards();
    } catch (err: any) {
      this.snackBar.open(err?.message || 'Failed to update competition status', 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    }
  }

  async toggleBlock(boardKey: string, currentStatus: boolean) {
    try {
      if (currentStatus) {
        await this.boardsService.unblockBoard(boardKey);
        this.snackBar.open('Board unblocked', 'OK', {
          duration: 2000,
          panelClass: ['success-snackbar'],
        });
      } else {
        await this.boardsService.blockBoard(boardKey);
        this.snackBar.open('Board blocked', 'OK', {
          duration: 2000,
          panelClass: ['success-snackbar'],
        });
      }
      await this.loadBoards();
    } catch (err: any) {
      this.snackBar.open(err?.message || 'Failed to update block status', 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    }
  }

  async deleteBoard(boardKey: string) {
    // Find the board row to get ownerUid
    const boardRow = this.boards.find(b => b.boardKey === boardKey);
    if (!boardRow) {
      this.snackBar.open('Board not found', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }

    const ownerUid = boardRow.board.ownerUid;
    const ownerEmail = boardRow.ownerEmail || 'Unknown';

    if (!confirm(`Are you sure you want to delete the account for ${ownerEmail}?\n\nThis will delete:\n- Board: ${boardKey}\n- User account\n\nThis action cannot be undone.`)) {
      return;
    }

    try {
      if (ownerUid) {
        // Delete both user and board
        await this.boardsService.deleteAccount(boardKey, ownerUid);
        this.snackBar.open('Account deleted successfully (user and board removed from RTDB)', 'OK', {
          duration: 3000,
          panelClass: ['success-snackbar'],
        });
      } else {
        // Fallback: only delete board if ownerUid is missing
        console.warn('[Admin] Owner UID not found, deleting board only');
        await this.boardsService.deleteBoard(boardKey);
        this.snackBar.open('Board deleted (user entry not found)', 'OK', {
          duration: 3000,
          panelClass: ['success-snackbar'],
        });
      }
      await this.loadBoards();
    } catch (err: any) {
      this.snackBar.open(err?.message || 'Failed to delete account', 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    }
  }

  viewBoard(boardKey: string) {
    // Navigate to home page with board ID query param
    // The subboard component will automatically load the board and enter full screen mode
    this.router.navigate(['/'], { queryParams: { id: boardKey } });
  }
}


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
import { MatTabsModule } from '@angular/material/tabs';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { Kavithai } from '../board.service';

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
    MatTabsModule,
    MatInputModule,
    MatFormFieldModule,
    MatCheckboxModule,
    FormsModule,
  ],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.css',
})
export class AdminComponent implements OnInit, OnDestroy, AfterViewInit {
  boards: BoardRow[] = [];
  kavithaiList: Kavithai[] = [];
  loading = true;
  loadingKavithai = false;
  selectedTabIndex = 0;
  displayedColumns: string[] = ['boardKey', 'ownerEmail', 'status', 'competition', 'actions'];
  displayedKavithaiColumns: string[] = ['select', 'id', 'email', 'content', 'votes', 'duplicate', 'invalid', 'actions'];
  selectedKavithai = new Set<string>();
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
    console.log('[Admin] Component initialized, selectedTabIndex:', this.selectedTabIndex);
  }

  ngAfterViewInit() {
    // Load boards AFTER view is initialized to avoid change detection errors
    if (this.admin.isAdminLoggedIn()) {
      this.loadBoards();
      this.loadKavithai();
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
    this.router.navigate(['/board', boardKey]);
  }

  async loadKavithai() {
    this.loadingKavithai = true;
    try {
      this.kavithaiList = await this.boardsService.getAllKavithai();
      this.loadingKavithai = false;
      this.cdr.markForCheck();
    } catch (err: any) {
      console.error('[Admin] Error loading kavithai:', err);
      this.snackBar.open(
        err?.message || 'Failed to load kavithai entries.',
        'OK',
        {
          duration: 5000,
          panelClass: ['error-snackbar'],
        }
      );
      this.kavithaiList = [];
      this.loadingKavithai = false;
      this.cdr.markForCheck();
    }
  }

  async deleteKavithai(kavithaiId: string) {
    const kavithai = this.kavithaiList.find(k => k.id === kavithaiId);
    if (!confirm(`Are you sure you want to delete this kavithai entry?\n\nID: ${kavithaiId}\nEmail: ${kavithai?.email || 'N/A'}\n\nThis action cannot be undone.`)) {
      return;
    }

    try {
      await this.boardsService.deleteKavithai(kavithaiId);
      this.snackBar.open('Kavithai deleted successfully', 'OK', {
        duration: 2000,
        panelClass: ['success-snackbar'],
      });
      await this.loadKavithai();
    } catch (err: any) {
      this.snackBar.open(err?.message || 'Failed to delete kavithai', 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    }
  }

  async markAsDuplicate(kavithaiId: string, isDuplicate: boolean) {
    try {
      await this.boardsService.markKavithaiAsDuplicate(kavithaiId, isDuplicate);
      this.snackBar.open(
        isDuplicate ? 'Marked as duplicate email' : 'Removed duplicate mark',
        'OK',
        {
          duration: 2000,
          panelClass: ['success-snackbar'],
        }
      );
      await this.loadKavithai();
    } catch (err: any) {
      this.snackBar.open(err?.message || 'Failed to update duplicate status', 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    }
  }

  async updateVoteCount(kavithaiId: string, newCount: number) {
    if (newCount < 0) {
      this.snackBar.open('Vote count cannot be negative', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }

    try {
      await this.boardsService.updateKavithaiVoteCount(kavithaiId, newCount);
      this.snackBar.open('Vote count updated successfully', 'OK', {
        duration: 2000,
        panelClass: ['success-snackbar'],
      });
      await this.loadKavithai();
    } catch (err: any) {
      this.snackBar.open(err?.message || 'Failed to update vote count', 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    }
  }

  async setVoteCount(kavithaiId: string) {
    const kavithai = this.kavithaiList.find(k => k.id === kavithaiId);
    if (!kavithai) return;

    const input = prompt(`Enter new vote count for ${kavithaiId}:`, kavithai.voteCount.toString());
    if (input === null) return; // User cancelled

    const newCount = parseInt(input, 10);
    if (isNaN(newCount) || newCount < 0) {
      this.snackBar.open('Please enter a valid number (0 or greater)', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
      return;
    }

    await this.updateVoteCount(kavithaiId, newCount);
  }

  async markAsInvalid(kavithaiId: string, isInvalid: boolean) {
    try {
      await this.boardsService.markKavithaiAsInvalid(kavithaiId, isInvalid);
      this.snackBar.open(
        isInvalid ? 'Marked as invalid entry' : 'Removed invalid mark',
        'OK',
        {
          duration: 2000,
          panelClass: ['success-snackbar'],
        }
      );
      await this.loadKavithai();
    } catch (err: any) {
      this.snackBar.open(err?.message || 'Failed to update invalid status', 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    }
  }

  onTabChange(index: number) {
    this.selectedTabIndex = index;
    if (index === 1 && this.kavithaiList.length === 0 && !this.loadingKavithai) {
      this.loadKavithai();
    }
    // Clear selections when switching tabs
    this.selectedKavithai.clear();
  }

  toggleKavithaiSelection(kavithaiId: string) {
    if (this.selectedKavithai.has(kavithaiId)) {
      this.selectedKavithai.delete(kavithaiId);
    } else {
      this.selectedKavithai.add(kavithaiId);
    }
  }

  isKavithaiSelected(kavithaiId: string): boolean {
    return this.selectedKavithai.has(kavithaiId);
  }

  toggleSelectAll() {
    if (this.isAllSelected()) {
      this.selectedKavithai.clear();
    } else {
      this.kavithaiList.forEach(kavithai => this.selectedKavithai.add(kavithai.id));
    }
  }

  isAllSelected(): boolean {
    return this.kavithaiList.length > 0 && this.selectedKavithai.size === this.kavithaiList.length;
  }

  isSomeSelected(): boolean {
    return this.selectedKavithai.size > 0 && !this.isAllSelected();
  }

  async deleteSelectedKavithai() {
    if (this.selectedKavithai.size === 0) {
      this.snackBar.open('Please select at least one entry to delete', 'OK', {
        duration: 3000,
        panelClass: ['info-snackbar'],
      });
      return;
    }

    const count = this.selectedKavithai.size;
    if (!confirm(`Are you sure you want to delete ${count} kavithai entr${count === 1 ? 'y' : 'ies'}?\n\nThis action cannot be undone.`)) {
      return;
    }

    const selectedIds = Array.from(this.selectedKavithai);
    let successCount = 0;
    let failCount = 0;

    try {
      for (const id of selectedIds) {
        try {
          await this.boardsService.deleteKavithai(id);
          successCount++;
        } catch (err) {
          console.error(`Failed to delete kavithai ${id}:`, err);
          failCount++;
        }
      }

      this.selectedKavithai.clear();
      
      if (failCount === 0) {
        this.snackBar.open(`Successfully deleted ${successCount} entr${successCount === 1 ? 'y' : 'ies'}`, 'OK', {
          duration: 3000,
          panelClass: ['success-snackbar'],
        });
      } else {
        this.snackBar.open(`Deleted ${successCount} entr${successCount === 1 ? 'y' : 'ies'}, ${failCount} failed`, 'OK', {
          duration: 4000,
          panelClass: ['warning-snackbar'],
        });
      }

      await this.loadKavithai();
    } catch (err: any) {
      this.snackBar.open(err?.message || 'Failed to delete selected entries', 'OK', {
        duration: 4000,
        panelClass: ['error-snackbar'],
      });
    }
  }
}


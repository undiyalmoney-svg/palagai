import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../auth.service';
import { BoardService, Board, UserRecord } from '../board.service';
import { AlertService } from '../shared/alert.service';
import { EditProfileDialogComponent, EditProfileDialogData, EditProfileDialogResult } from './edit-profile-dialog.component';

@Component({
  selector: 'app-user-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatTooltipModule,
  ],
  templateUrl: './user-dashboard.component.html',
  styleUrl: './user-dashboard.component.css',
})
export class UserDashboardComponent implements OnInit {
  loading = false;
  userProfile: UserRecord | null = null;
  userBoards: Array<{ boardKey: string; board: Board }> = [];

  constructor(
    private auth: AuthService,
    private boards: BoardService,
    private router: Router,
    private snackBar: MatSnackBar,
    private alertService: AlertService,
    private cdr: ChangeDetectorRef,
    private dialog: MatDialog,
  ) {}

  async ngOnInit() {
    const user = this.auth.user;
    if (!user) {
      await this.router.navigate(['/login']);
      return;
    }

    await this.loadUserData();
  }

  async loadUserData() {
    this.loading = true;
    this.cdr.detectChanges();

    try {
      const user = this.auth.user;
      if (!user?.uid) {
        await this.router.navigate(['/login']);
        return;
      }

      // Load user profile and boards in parallel for faster loading
      const [userRecord, boards] = await Promise.all([
        this.boards.getUserByUid(user.uid),
        this.boards.getUserBoards(user.uid),
      ]);

      if (userRecord) {
        this.userProfile = userRecord.user;
      }

      this.userBoards = boards;
    } catch (e: any) {
      console.error('Error loading user data:', e);
      this.alertService.error(e?.message || 'Failed to load user data');
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  get displayName(): string {
    return this.userProfile?.name || this.userProfile?.email?.split('@')[0] || 'User';
  }

  get hasBoards(): boolean {
    return this.userBoards.length > 0;
  }

  get boardCount(): number {
    return this.userBoards.length;
  }

  getBoardType(board: Board): string {
    if (board.boardType === 'poll') {
      return 'Poll Board';
    }
    return 'Standard Board';
  }

  getBoardPreview(board: Board): string {
    if (board.boardType === 'poll' && board.pollData) {
      return board.pollData.question || 'Poll';
    }
    const text = (board.message?.html || '').replace(/<[^>]*>/g, '').trim();
    return text.substring(0, 100) + (text.length > 100 ? '...' : '') || 'No content';
  }

  editProfile() {
    if (!this.userProfile) {
      return;
    }

    const dialogData: EditProfileDialogData = {
      name: this.userProfile.name || '',
      email: this.userProfile.email || '',
      dateOfBirth: this.userProfile.dateOfBirth || undefined,
    };

    const dialogRef = this.dialog.open(EditProfileDialogComponent, {
      width: '90%',
      maxWidth: '500px',
      data: dialogData,
    });

    dialogRef.afterClosed().subscribe(async (result: EditProfileDialogResult | undefined) => {
      if (!result) {
        return; // User cancelled
      }

      const user = this.auth.user;
      if (!user?.uid) {
        return;
      }

      try {
        const updates: { name?: string; email?: string; dateOfBirth?: string } = {};

        if (result.name !== undefined) {
          updates.name = result.name;
        }
        if (result.email !== undefined && result.email !== this.userProfile?.email) {
          updates.email = result.email;
        }
        if (result.dateOfBirth !== undefined) {
          updates.dateOfBirth = result.dateOfBirth;
        }

        await this.boards.updateUserProfile(user.uid, updates);
        
        // Update local profile
        if (this.userProfile) {
          this.userProfile = { ...this.userProfile, ...updates };
        }

        // Update auth service if email changed
        if (updates.email && this.auth.user) {
          this.auth.setUser({ ...this.auth.user, email: updates.email });
        }

        this.alertService.success('Profile updated successfully');
        this.cdr.detectChanges();
      } catch (e: any) {
        console.error('Error updating profile:', e);
        this.alertService.error(e?.message || 'Failed to update profile');
      }
    });
  }

  async createBoard() {
    const user = this.auth.user;
    if (!user?.uid) {
      await this.router.navigate(['/login']);
      return;
    }

    // Navigate to mainboard with create flag and standard board type - it will create a board if needed
    await this.router.navigate(['/mainboard'], { 
      queryParams: { create: 'true', type: 'standard' } 
    });
  }

  async editBoard(boardKey: string, boardType: 'standard' | 'poll' | 'job') {
    if (!boardKey) {
      this.alertService.error('Invalid board');
      return;
    }

    // Navigate with query params to edit the specific board
    await this.router.navigate(['/mainboard'], { 
      queryParams: { 
        boardKey: boardKey.trim(), 
        type: boardType || 'standard' 
      } 
    });
  }

  viewBoard(boardKey: string) {
    this.router.navigate(['/board', boardKey]);
  }
}


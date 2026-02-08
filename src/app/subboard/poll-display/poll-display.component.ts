import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ChangeDetectorRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormControl, FormArray, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatRadioModule } from '@angular/material/radio';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { PollData, PollOption, BoardService } from '../../board.service';
import { PollResultsDialogComponent, PollResultsDialogData } from './poll-results-dialog.component';
import { Unsubscribe } from 'firebase/database';
import { AuthService } from '../../auth.service';
import { AdminService } from '../../admin.service';

@Component({
  selector: 'app-poll-display',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatRadioModule,
    MatCheckboxModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatDialogModule,
  ],
  templateUrl: './poll-display.component.html',
  styleUrls: ['./poll-display.component.css'],
})
export class PollDisplayComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() boardKey: string = '';
  @Input() pollData: PollData | null = null;
  @Input() canVote: boolean = true;
  @Input() canViewResults: boolean = false; // Only creator/admin can view results
  @Input() userEmail?: string;

  pollForm: FormGroup;
  hasVoted: boolean = false;
  isVoting: boolean = false;
  currentPollData: PollData | null = null;
  private pollUnsubscribe?: Unsubscribe;
  loading: boolean = false;
  error: string | null = null;
  formReady: boolean = false; // Track when form is ready

  constructor(
    private fb: FormBuilder,
    private boardsService: BoardService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
    private dialog: MatDialog,
    private auth: AuthService,
    private admin: AdminService
  ) {
    // Initialize form - structure depends on poll type
    this.pollForm = this.fb.group({
      selectedOptions: this.fb.array<FormControl<boolean | null>>([]),
      selectedOption: this.fb.control<number | null>(null), // For single choice
    });
  }

  ngOnInit(): void {
    console.log('[PollDisplay] ngOnInit called, boardKey:', this.boardKey, 'pollData:', !!this.pollData);
    
    // If pollData is provided as input, use it directly
    if (this.pollData) {
      console.log('[PollDisplay] Using provided pollData');
      this.currentPollData = this.pollData;
      this.initializeForm();
      this.cdr.detectChanges();
      return;
    }
    
    // Otherwise, load from Firebase using boardKey
    if (this.boardKey && this.boardKey.trim()) {
      console.log('[PollDisplay] Loading from Firebase, boardKey:', this.boardKey);
      this.loadPollDataFromFirebase();
    } else {
      console.warn('[PollDisplay] No pollData and no boardKey, cannot load');
      this.error = 'No poll data available';
    }
  }

  private async loadPollDataFromFirebase(): Promise<void> {
    if (!this.boardKey || !this.boardKey.trim()) {
      return;
    }

    this.loading = true;
    this.error = null;
    
    try {
      console.log('[PollDisplay] Fetching poll data for boardKey:', this.boardKey);
      const poll = await this.boardsService.getPoll(this.boardKey);
      
      // Check voted status after loading poll data
      this.checkVotedStatus();
      
      if (poll) {
        console.log('[PollDisplay] Poll data loaded:', poll.question, 'options:', poll.options?.length);
        this.currentPollData = poll;
        this.initializeForm();
        this.error = null;
        
        // Don't auto-show results on load - user must vote first
      } else {
        console.warn('[PollDisplay] No poll data found for boardKey:', this.boardKey);
        this.error = 'Poll data not found';
        this.currentPollData = null;
      }
    } catch (error: any) {
      console.error('[PollDisplay] Error loading poll data:', error);
      this.error = error?.message || 'Failed to load poll data';
      this.currentPollData = null;
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  get selectedOptionsArray(): FormArray {
    const array = this.pollForm.get('selectedOptions') as FormArray;
    if (!array) {
      console.warn('[PollDisplay] selectedOptionsArray is null, form may not be initialized');
      // Return a minimal safe array - this should not happen if formReady is checked
      return new FormArray<FormControl<boolean | null>>([]);
    }
    return array;
  }

  initializeForm(): void {
    console.log('[PollDisplay] initializeForm called, currentPollData:', !!this.currentPollData, 'pollType:', this.currentPollData?.pollType);
    this.formReady = false;
    
    if (!this.currentPollData || !this.currentPollData.options || this.currentPollData.options.length === 0) {
      console.log('[PollDisplay] No poll data, initializing empty array');
      const emptyArray = this.fb.array<FormControl<boolean | null>>([]);
      this.pollForm.setControl('selectedOptions', emptyArray);
      this.pollForm.setControl('selectedOption', this.fb.control<number | null>(null));
      this.formReady = false;
      this.cdr.markForCheck();
      return;
    }

    const optionsCount = this.currentPollData.options.length;
    const pollType = this.currentPollData.pollType;
    console.log('[PollDisplay] Initializing form with', optionsCount, 'options, type:', pollType);
    
    if (pollType === 'single') {
      // Single choice: use a single FormControl for the selected option index
      console.log('[PollDisplay] Initializing single choice form');
      this.pollForm.setControl('selectedOption', this.fb.control<number | null>(null));
      // Clear the array for single choice
      const emptyArray = this.fb.array<FormControl<boolean | null>>([]);
      this.pollForm.setControl('selectedOptions', emptyArray);
      this.formReady = true;
      console.log('[PollDisplay] Single choice form ready');
    } else {
      // Multiple choice: use FormArray with one control per option
      console.log('[PollDisplay] Initializing multiple choice form');
      const formControls: FormControl<boolean | null>[] = [];
      
      for (let i = 0; i < optionsCount; i++) {
        const option = this.currentPollData.options[i];
        const control = this.fb.control<boolean | null>(false);
        formControls.push(control);
        console.log('[PollDisplay] Created control at index', i, 'for option:', option.text);
      }
      
      // Create new FormArray with all controls at once
      const optionsArray = this.fb.array<FormControl<boolean | null>>(formControls);
      this.pollForm.setControl('selectedOptions', optionsArray);
      // Clear single choice control
      this.pollForm.setControl('selectedOption', this.fb.control<number | null>(null));
      
      // Verify immediately
      const verifyArray = this.pollForm.get('selectedOptions') as FormArray;
      const actualLength = verifyArray?.length || 0;
      console.log('[PollDisplay] Form initialized - array length:', actualLength, 'expected:', optionsCount);
      
      if (actualLength === optionsCount && verifyArray) {
        console.log('[PollDisplay] Form array controls:', verifyArray.controls.map((c, i) => `[${i}]: ${c.value}`).join(', '));
        this.formReady = true;
        console.log('[PollDisplay] Multiple choice form ready');
      } else {
        console.error('[PollDisplay] Form array length mismatch! Expected:', optionsCount, 'Got:', actualLength);
        this.formReady = false;
      }
    }
    
    this.cdr.markForCheck();
  }

  ngAfterViewInit(): void {
    // Ensure form is ready after view initialization
    // Use setTimeout to avoid ExpressionChangedAfterItHasBeenCheckedError
    setTimeout(() => {
      if (this.currentPollData && this.currentPollData.options && this.currentPollData.options.length > 0) {
        const array = this.pollForm.get('selectedOptions') as FormArray;
        if (array && array.length === this.currentPollData.options.length && !this.formReady) {
          this.formReady = true;
          this.cdr.markForCheck();
        }
      }
    }, 0);
  }

  // Removed loadPollData - using loadPollDataFromFirebase instead

  ngOnDestroy(): void {
    if (this.pollUnsubscribe) {
      this.pollUnsubscribe();
    }
  }

  checkVotedStatus(): void {
    // Removed - users can vote multiple times now
    this.hasVoted = false;
  }

  getOptionPercentage(option: PollOption): number {
    if (!this.currentPollData || this.currentPollData.totalVotes === 0) {
      return 0;
    }
    return (option.voteCount / this.currentPollData.totalVotes) * 100;
  }

  async submitVote(): Promise<void> {
    if (!this.boardKey || !this.currentPollData || this.isVoting || !this.canVote) {
      return;
    }

    let selectedIndices: number[] = [];

    // Handle single choice polls
    if (this.currentPollData.pollType === 'single') {
      const selectedOption = this.pollForm.get('selectedOption')?.value;
      if (selectedOption === null || selectedOption === undefined) {
        this.snackBar.open('Please select an option', 'OK', {
          duration: 2000,
          panelClass: ['info-snackbar'],
        });
        return;
      }
      selectedIndices = [selectedOption];
    } else {
      // Handle multiple choice polls
      const selectedOptionsArray = this.pollForm.get('selectedOptions') as FormArray;
      if (!selectedOptionsArray) {
        this.snackBar.open('Form not ready. Please wait...', 'OK', {
          duration: 2000,
          panelClass: ['info-snackbar'],
        });
        return;
      }

      selectedIndices = selectedOptionsArray.controls
        .map((control, index) => (control.value ? index : -1))
        .filter((index) => index !== -1);

      if (selectedIndices.length === 0) {
        this.snackBar.open('Please select at least one option', 'OK', {
          duration: 2000,
          panelClass: ['info-snackbar'],
        });
        return;
      }
    }

    this.isVoting = true;

    try {
      const optionIds = selectedIndices.map((index) => this.currentPollData!.options[index].id);
      const userIP = await this.boardsService.getUserIP();

      await this.boardsService.voteOnPoll(this.boardKey, optionIds, userIP, this.userEmail);

      // Refresh poll data to get updated vote counts
      if (this.boardKey) {
        const updatedPoll = await this.boardsService.getPoll(this.boardKey);
        if (updatedPoll) {
          this.currentPollData = updatedPoll;
        }
      }

      // Reset form so user can vote again
      if (this.currentPollData.pollType === 'single') {
        this.pollForm.get('selectedOption')?.setValue(null);
      } else {
        const selectedOptionsArray = this.pollForm.get('selectedOptions') as FormArray;
        selectedOptionsArray.controls.forEach(control => control.setValue(false));
      }

      // Show results after voting (percentages for public, counts for admin)
      const isAdmin = this.admin.isAdminLoggedIn();
      this.showResultsDialog(isAdmin);

      this.snackBar.open('⭐ Thanks for your vote! You can vote again to change your choice.', 'OK', {
        duration: 3000,
        panelClass: ['success-snackbar'],
      });

      this.cdr.detectChanges();
    } catch (error: any) {
      console.error('Error voting:', error);
      this.snackBar.open(error?.message || 'Failed to submit vote. Please try again.', 'OK', {
        duration: 3000,
        panelClass: ['error-snackbar'],
      });
    } finally {
      this.isVoting = false;
    }
  }

  shouldShowResults(): boolean {
    // Only show results if user is creator/admin
    if (!this.canViewResults) return false;
    if (!this.currentPollData) return false;
    // Creator/admin can always see results
    return true;
  }

  canChangeVote(): boolean {
    // Users can always change their vote now
    return true;
  }

  onViewResults(): void {
    const isAdmin = this.admin.isAdminLoggedIn();
    this.showResultsDialog(isAdmin);
  }

  showResultsDialog(isAdmin: boolean): void {
    if (!this.currentPollData) {
      return;
    }

    // For preview mode (no boardKey), show results with current data
    const boardKeyForDialog = this.boardKey || 'preview';

    const dialogRef = this.dialog.open(PollResultsDialogComponent, {
      width: '90%',
      maxWidth: '600px',
      data: {
        pollData: this.currentPollData,
        boardKey: boardKeyForDialog,
        isAdmin: isAdmin
      } as PollResultsDialogData
    });

    dialogRef.afterClosed().subscribe(() => {
      // Refresh poll data after dialog closes (in case admin updated counts)
      if (this.boardKey && this.boardKey.trim()) {
        this.boardsService.getPoll(this.boardKey).then(poll => {
          if (poll) {
            this.currentPollData = poll;
            this.cdr.detectChanges();
          }
        });
      }
    });
  }
}


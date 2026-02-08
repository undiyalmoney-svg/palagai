import { Component, Input, Output, EventEmitter, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormArray, FormControl, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { PollData, PollOption } from '../../board.service';

@Component({
  selector: 'app-poll-editor',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './poll-editor.component.html',
  styleUrls: ['./poll-editor.component.css'],
})
export class PollEditorComponent implements OnInit {
  @Input() pollData: PollData | null = null;
  @Input() canModify: boolean = true;
  @Output() pollSave = new EventEmitter<PollData>();
  @Output() pollClear = new EventEmitter<void>();
  
  // Expose savePoll method for parent to call
  public savePollFromParent(): void {
    this.savePoll();
  }

  pollForm: FormGroup;
  maxOptions = 5;
  minOptions = 2;

  constructor(private fb: FormBuilder, private cdr: ChangeDetectorRef) {
    this.pollForm = this.fb.group({
      question: ['', [Validators.required, Validators.maxLength(200)]],
      options: this.fb.array([]),
    });
  }

  ngOnInit(): void {
    if (this.pollData) {
      this.loadPollData(this.pollData);
    } else {
      // Initialize with 2 empty options
      this.addOption();
      this.addOption();
    }
  }

  get optionsArray(): FormArray {
    return this.pollForm.get('options') as FormArray;
  }

  getOptionControl(index: number): FormControl<string | null> {
    return this.optionsArray.at(index) as FormControl<string | null>;
  }

  loadPollData(pollData: PollData): void {
    this.pollForm.patchValue({
      question: pollData.question,
    });

    // Clear existing options
    while (this.optionsArray.length > 0) {
      this.optionsArray.removeAt(0);
    }

    // Load options (without vote counts for editing)
    pollData.options.forEach((option) => {
      this.addOption(option.text);
    });
  }

  addOption(text: string = ''): void {
    if (this.optionsArray.length >= this.maxOptions) {
      return;
    }
    this.optionsArray.push(
      this.fb.control(text, [Validators.required, Validators.maxLength(100)])
    );
  }

  removeOption(index: number): void {
    if (this.optionsArray.length > this.minOptions) {
      this.optionsArray.removeAt(index);
      this.pollForm.updateValueAndValidity();
      this.cdr.detectChanges();
    }
  }

  canAddOption(): boolean {
    return this.optionsArray.length < this.maxOptions;
  }

  canRemoveOption(): boolean {
    return this.optionsArray.length > this.minOptions;
  }

  savePoll(): void {
    if (this.pollForm.invalid) {
      this.markFormGroupTouched(this.pollForm);
      return;
    }

    const formValue = this.pollForm.value;
    const options: PollOption[] = formValue.options.map((text: string, index: number) => ({
      id: `opt_${index + 1}`,
      text: text.trim(),
      voteCount: 0,
    }));

    // Emit poll data without settings (settings will be collected in dialog)
    const pollData: Partial<PollData> = {
      question: formValue.question.trim(),
      options: options,
      totalVotes: 0,
      createdAt: this.pollData?.createdAt || Date.now(),
    };

    this.pollSave.emit(pollData as PollData);
  }

  clearPoll(): void {
    this.pollForm.reset({
      question: '',
    });

    // Clear options and add 2 empty ones
    while (this.optionsArray.length > 0) {
      this.optionsArray.removeAt(0);
    }
    this.addOption();
    this.addOption();

    this.pollClear.emit();
  }

  private markFormGroupTouched(formGroup: FormGroup): void {
    Object.keys(formGroup.controls).forEach((key) => {
      const control = formGroup.get(key);
      control?.markAsTouched();

      if (control instanceof FormArray) {
        control.controls.forEach((ctrl) => {
          if (ctrl instanceof FormControl) {
            ctrl.markAsTouched();
          }
        });
      }
    });
  }
}


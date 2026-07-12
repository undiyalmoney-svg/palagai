import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { HistoricalTest } from '../../../core/models/historical-test.model';
import { ResultsStoreService } from '../../../core/services/results-store.service';

@Component({
  selector: 'app-results',
  standalone: true,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './results.component.html',
  styleUrl: './results.component.css',
})
export class ResultsComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly resultsStore = inject(ResultsStoreService);

  protected readonly filteredTests = signal<HistoricalTest[]>([]);

  protected readonly filters = this.formBuilder.nonNullable.group({
    date: [''],
    instrument: [''],
    strategy: [''],
  });

  ngOnInit(): void {
    this.applyFilters();
  }

  protected applyFilters(): void {
    const values = this.filters.getRawValue();
    this.filteredTests.set(
      this.resultsStore.search({
        date: values.date || undefined,
        instrument: values.instrument || undefined,
        strategy: values.strategy || undefined,
      }),
    );
  }
}

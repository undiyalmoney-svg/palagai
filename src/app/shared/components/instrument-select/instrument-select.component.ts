import {
  Component,
  computed,
  effect,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Instrument } from '../../../core/models/instrument.model';

@Component({
  selector: 'app-instrument-select',
  standalone: true,
  imports: [ScrollingModule, MatFormFieldModule, MatInputModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InstrumentSelectComponent),
      multi: true,
    },
  ],
  templateUrl: './instrument-select.component.html',
  styleUrl: './instrument-select.component.css',
})
export class InstrumentSelectComponent implements ControlValueAccessor {
  readonly label = input('Instrument');
  readonly instruments = input<Instrument[]>([]);

  protected readonly searchQuery = signal('');
  protected readonly open = signal(false);
  protected readonly selectedToken = signal<number | null>(null);

  protected readonly filtered = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const list = this.instruments();
    if (!list.length) {
      return [];
    }
    if (!query) {
      return list.slice(0, 200);
    }
    return list
      .filter(
        (item) =>
          item.tradingSymbol.toLowerCase().includes(query) ||
          item.name.toLowerCase().includes(query) ||
          String(item.instrumentToken).includes(query),
      )
      .slice(0, 200);
  });

  private onChange: (value: number | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  constructor() {
    effect(() => {
      const token = this.selectedToken();
      const list = this.instruments();
      if (token == null || !list.length) {
        return;
      }
      const match = list.find((item) => item.instrumentToken === token);
      if (match) {
        this.searchQuery.set(`${match.tradingSymbol} (${match.instrumentToken})`);
      }
    });
  }

  writeValue(value: number | null): void {
    this.selectedToken.set(value);
    if (value == null) {
      this.searchQuery.set('');
      return;
    }
    const match = this.instruments().find((item) => item.instrumentToken === value);
    this.searchQuery.set(match ? `${match.tradingSymbol} (${match.instrumentToken})` : String(value));
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  protected onFocus(): void {
    this.open.set(true);
    if (!this.searchQuery() && this.selectedToken() != null) {
      const match = this.instruments().find((item) => item.instrumentToken === this.selectedToken());
      this.searchQuery.set(match?.tradingSymbol ?? '');
    }
  }

  protected onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
    this.open.set(true);
    if (!value.trim()) {
      this.selectedToken.set(null);
      this.onChange(null);
    }
  }

  protected select(item: Instrument, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.selectedToken.set(item.instrumentToken);
    this.searchQuery.set(`${item.tradingSymbol} (${item.instrumentToken})`);
    this.onChange(item.instrumentToken);
    this.onTouched();
    this.open.set(false);
  }

  protected onBlur(): void {
    setTimeout(() => {
      this.open.set(false);
      const token = this.selectedToken();
      if (token != null) {
        const match = this.instruments().find((item) => item.instrumentToken === token);
        if (match) {
          this.searchQuery.set(`${match.tradingSymbol} (${match.instrumentToken})`);
        }
      }
      this.onTouched();
    }, 200);
  }
}

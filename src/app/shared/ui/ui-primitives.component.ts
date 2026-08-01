import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-ui-card',
  standalone: true,
  template: `<section class="ui-card" [class.ui-card-sm]="dense"><ng-content /></section>`,
})
export class UiCardComponent {
  @Input() dense = false;
}

@Component({
  selector: 'app-ui-section-header',
  standalone: true,
  template: `
    <header class="ui-section-head">
      <h2 class="ui-section-title">{{ title }}</h2>
      @if (description) {
        <p class="ui-section-desc">{{ description }}</p>
      }
      <ng-content />
    </header>
  `,
  styles: `
    .ui-section-head {
      margin-bottom: 1rem;
    }
  `,
})
export class UiSectionHeaderComponent {
  @Input({ required: true }) title = '';
  @Input() description = '';
}

@Component({
  selector: 'app-ui-stat-card',
  standalone: true,
  template: `
    <div class="ui-stat-card">
      <span class="ui-stat-label">{{ label }}</span>
      <strong class="ui-stat-value">{{ value }}</strong>
      @if (hint) {
        <span class="ui-section-desc">{{ hint }}</span>
      }
    </div>
  `,
})
export class UiStatCardComponent {
  @Input({ required: true }) label = '';
  @Input({ required: true }) value = '';
  @Input() hint = '';
}

@Component({
  selector: 'app-ui-status-badge',
  standalone: true,
  template: `<span class="pg-badge" [class]="toneClass">{{ label }}</span>`,
})
export class UiStatusBadgeComponent {
  @Input({ required: true }) label = '';
  @Input() tone: 'paper' | 'live' | 'stopped' | 'error' | 'warning' | 'neutral' = 'neutral';

  protected get toneClass(): string {
    switch (this.tone) {
      case 'paper':
        return 'pg-badge-bull';
      case 'live':
        return 'pg-badge-info';
      case 'stopped':
        return 'pg-badge-neutral';
      case 'error':
        return 'pg-badge-bear';
      case 'warning':
        return 'pg-badge-warn';
      default:
        return 'pg-badge-neutral';
    }
  }
}

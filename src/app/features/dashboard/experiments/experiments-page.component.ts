import { Component, signal } from '@angular/core';
import { CrudeOilDeskComponent } from '../crude-oil-desk/crude-oil-desk.component';
import { StocksDeskComponent } from '../stocks-desk/stocks-desk.component';

export type ExperimentsTab = 'crude' | 'natgas' | 'stocks';

@Component({
  selector: 'app-experiments-page',
  standalone: true,
  imports: [CrudeOilDeskComponent, StocksDeskComponent],
  templateUrl: './experiments-page.component.html',
  styleUrl: './experiments-page.component.css',
})
export class ExperimentsPageComponent {
  protected readonly tab = signal<ExperimentsTab>('crude');

  protected setTab(next: ExperimentsTab): void {
    this.tab.set(next);
  }
}

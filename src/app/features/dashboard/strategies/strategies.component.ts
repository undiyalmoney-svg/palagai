import { Component, OnInit, inject, signal } from '@angular/core';
import { StrategyEngineService, ActiveStrategyInfo } from '../../../core/strategies/registry/strategy-engine.service';

@Component({
  selector: 'app-strategies',
  standalone: true,
  imports: [],
  templateUrl: './strategies.component.html',
  styleUrl: './strategies.component.css',
})
export class StrategiesComponent implements OnInit {
  private readonly strategyEngine = inject(StrategyEngineService);

  protected readonly strategy = signal<ActiveStrategyInfo | null>(null);

  ngOnInit(): void {
    const list = this.strategyEngine.getActiveStrategyInfo();
    this.strategy.set(list[0] ?? null);
  }
}

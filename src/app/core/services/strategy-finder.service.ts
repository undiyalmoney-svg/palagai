import { Injectable, inject, signal } from '@angular/core';
import { Candle } from '../models/candle.model';
import { SwingScannerService } from './swing-scanner.service';
import { NIFTY_50_UNIVERSE } from './nifty50-universe';
import { NIFTY_500_UNIVERSE } from './nifty500-universe';
import {
  RecipeTrade,
  StrategyRecipe,
  SymbolIndicators,
  buildIndicators,
  collectIndicatorNeeds,
  emptyIndicatorRequest,
  runRecipeOnSymbol,
} from '../strategy-engine/strategies/finder/strategy-recipe';
import {
  FinderUniverse,
  IN_SAMPLE_FRACTION,
  MIN_TRADES_FOR_SIGNIFICANCE,
  SearchSpace,
  buildRecipes,
  costHurdleInR,
  dateAtFraction,
} from '../strategy-engine/strategies/finder/strategy-search-space';
import { mapWithConcurrency } from '../utils/concurrency.util';
import { resolveMonthRange } from '../utils/month-range.util';

/** Warm-up so the longest indicator has history before the search window opens. */
const WARMUP_DAYS = 200;
const FETCH_CONCURRENCY = 3;
const FETCH_BATCH_DELAY_MS = 350;

export interface RecipeMetrics {
  trades: number;
  winRatePct: number;
  avgRMultiple: number;
  totalR: number;
  profitFactor: number | null;
  avgBarsHeld: number;
  targetExits: number;
  stopExits: number;
  timeExits: number;
}

export type FinderVerdict = 'promising' | 'likely-overfit' | 'no-edge' | 'too-few-trades';

export interface FinderCandidate {
  recipe: StrategyRecipe;
  inSample: RecipeMetrics;
  outOfSample: RecipeMetrics;
  verdict: FinderVerdict;
  /** avgR needed just to cover charges at the assumed position size. */
  costHurdleR: number;
}

export interface FinderProgress {
  phase: 'idle' | 'fetching' | 'searching';
  done: number;
  total: number;
}

export interface FinderOutput {
  candidates: FinderCandidate[];
  combinationsTested: number;
  symbolsScanned: number;
  symbolsSkipped: number;
  universe: FinderUniverse;
  inSampleFrom: string;
  inSampleTo: string;
  outOfSampleFrom: string;
  outOfSampleTo: string;
  positionSizeRs: number;
  ranAt: string;
}

function emptyMetrics(): RecipeMetrics {
  return {
    trades: 0,
    winRatePct: 0,
    avgRMultiple: 0,
    totalR: 0,
    profitFactor: null,
    avgBarsHeld: 0,
    targetExits: 0,
    stopExits: 0,
    timeExits: 0,
  };
}

function summarize(trades: RecipeTrade[]): RecipeMetrics {
  if (!trades.length) return emptyMetrics();
  const wins = trades.filter((t) => t.win);
  const grossWin = wins.reduce((a, t) => a + t.rMultiple, 0);
  const grossLoss = Math.abs(trades.filter((t) => !t.win).reduce((a, t) => a + t.rMultiple, 0));
  const totalR = trades.reduce((a, t) => a + t.rMultiple, 0);
  return {
    trades: trades.length,
    winRatePct: (wins.length / trades.length) * 100,
    avgRMultiple: totalR / trades.length,
    totalR,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgBarsHeld: trades.reduce((a, t) => a + t.barsHeld, 0) / trades.length,
    targetExits: trades.filter((t) => t.exitReason === 'TARGET').length,
    stopExits: trades.filter((t) => t.exitReason === 'STOP').length,
    timeExits: trades.filter((t) => t.exitReason === 'TIME').length,
  };
}

@Injectable({ providedIn: 'root' })
export class StrategyFinderService {
  private readonly scanner = inject(SwingScannerService);

  readonly result = signal<FinderOutput | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly progress = signal<FinderProgress>({ phase: 'idle', done: 0, total: 0 });

  async run(params: {
    space: SearchSpace;
    startMonth: string;
    endMonth: string;
    universe: FinderUniverse;
    positionSizeRs: number;
  }): Promise<void> {
    if (this.busy()) return;
    if (!this.scanner.hasKiteSession()) {
      this.error.set('Kite access token required. Generate token in Get Token tab.');
      return;
    }
    const { space, startMonth, endMonth, universe, positionSizeRs } = params;
    if (!startMonth || !endMonth || startMonth > endMonth) {
      this.error.set('Pick a valid start month → end month range.');
      return;
    }

    const recipes = buildRecipes(space);
    if (!recipes.length) {
      this.error.set('That search space produces no valid strategies — enable at least one entry block.');
      return;
    }

    const symbols = universe === 'nifty50' ? NIFTY_50_UNIVERSE : NIFTY_500_UNIVERSE;
    const { requestedFrom, requestedTo, fetchFrom } = resolveMonthRange(startMonth, endMonth, WARMUP_DAYS);

    // Split the requested window by calendar position: search on the earlier part, validate
    // on the later part. Anything that only works in-sample is a curve fit, not an edge.
    const splitDate = dateAtFraction(requestedFrom, requestedTo, IN_SAMPLE_FRACTION);

    this.error.set('');
    this.busy.set(true);
    this.progress.set({ phase: 'fetching', done: 0, total: symbols.length });

    const indicatorsBySymbol = new Map<string, SymbolIndicators>();
    let skipped = 0;

    try {
      const req = emptyIndicatorRequest();
      for (const r of recipes) collectIndicatorNeeds(r, req);

      const rawBySymbol = new Map<string, Candle[]>();
      await mapWithConcurrency(
        symbols as string[],
        FETCH_CONCURRENCY,
        async (symbol) => {
          try {
            const candles = await this.scanner.fetchDailyCandlesRange(symbol, fetchFrom, requestedTo);
            if (candles.length > 60) rawBySymbol.set(symbol, candles);
            else skipped += 1;
          } catch {
            skipped += 1;
          } finally {
            this.progress.update((p) => ({ ...p, done: p.done + 1 }));
          }
        },
        FETCH_BATCH_DELAY_MS,
      );

      if (!rawBySymbol.size) {
        this.error.set('No candles came back — check the Kite session and date range.');
        return;
      }

      for (const [symbol, candles] of rawBySymbol) {
        indicatorsBySymbol.set(symbol, buildIndicators(candles, req));
      }

      this.progress.set({ phase: 'searching', done: 0, total: recipes.length });

      const candidates: FinderCandidate[] = [];
      for (let ri = 0; ri < recipes.length; ri += 1) {
        const recipe = recipes[ri]!;
        const isTrades: RecipeTrade[] = [];
        const oosTrades: RecipeTrade[] = [];
        for (const [symbol, ind] of indicatorsBySymbol) {
          isTrades.push(...runRecipeOnSymbol(recipe, symbol, ind, requestedFrom, splitDate));
          oosTrades.push(...runRecipeOnSymbol(recipe, symbol, ind, splitDate, requestedTo));
        }
        const inSample = summarize(isTrades);
        const outOfSample = summarize(oosTrades);
        const costHurdleR = costHurdleInR(positionSizeRs, recipe.exit.maxRiskPct);

        let verdict: FinderVerdict;
        if (inSample.trades < MIN_TRADES_FOR_SIGNIFICANCE) verdict = 'too-few-trades';
        else if (inSample.avgRMultiple <= costHurdleR) verdict = 'no-edge';
        else if (outOfSample.trades < 10 || outOfSample.avgRMultiple <= costHurdleR) verdict = 'likely-overfit';
        else verdict = 'promising';

        candidates.push({ recipe, inSample, outOfSample, verdict, costHurdleR });

        this.progress.update((p) => ({ ...p, done: ri + 1 }));
        // Hand the frame back periodically so the page stays responsive during a long sweep.
        if (ri % 10 === 0) await new Promise((r) => setTimeout(r, 0));
      }

      // Rank by out-of-sample first — that is the number that has not been fitted to.
      const rank = (c: FinderCandidate) => {
        const order: Record<FinderVerdict, number> = {
          promising: 0, 'likely-overfit': 1, 'no-edge': 2, 'too-few-trades': 3,
        };
        return order[c.verdict];
      };
      candidates.sort((a, b) => {
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return b.outOfSample.avgRMultiple - a.outOfSample.avgRMultiple;
      });

      this.result.set({
        candidates: candidates.slice(0, 60),
        combinationsTested: recipes.length,
        symbolsScanned: symbols.length - skipped,
        symbolsSkipped: skipped,
        universe,
        inSampleFrom: requestedFrom,
        inSampleTo: splitDate,
        outOfSampleFrom: splitDate,
        outOfSampleTo: requestedTo,
        positionSizeRs,
        ranAt: new Date().toISOString(),
      });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Strategy search failed.');
    } finally {
      this.busy.set(false);
      this.progress.set({ phase: 'idle', done: 0, total: 0 });
    }
  }
}

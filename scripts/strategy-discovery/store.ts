import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StrategyResult } from './types.ts';

export class StrategyStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS strategies (
        id TEXT PRIMARY KEY,
        instrument TEXT NOT NULL,
        trend TEXT NOT NULL,
        sr TEXT NOT NULL,
        entry TEXT NOT NULL,
        stop TEXT NOT NULL,
        target TEXT NOT NULL,
        time_filter TEXT NOT NULL,
        exit_rule TEXT NOT NULL,
        net_profit REAL,
        cagr REAL,
        win_rate REAL,
        profit_factor REAL,
        sharpe REAL,
        max_drawdown_pct REAL,
        avg_r REAL,
        total_trades INTEGER,
        consecutive_wins INTEGER,
        consecutive_losses INTEGER,
        consistency_score REAL,
        stability_score REAL,
        rank_score REAL,
        passed_filters INTEGER,
        monthly_json TEXT,
        yearly_json TEXT,
        params_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_id TEXT NOT NULL,
        instrument TEXT NOT NULL,
        entry_time TEXT,
        exit_time TEXT,
        direction TEXT,
        entry REAL,
        exit REAL,
        stop REAL,
        target REAL,
        points REAL,
        r_multiple REAL,
        outcome TEXT,
        month TEXT,
        FOREIGN KEY(strategy_id) REFERENCES strategies(id)
      );

      CREATE INDEX IF NOT EXISTS idx_strategies_rank ON strategies(rank_score DESC);
      CREATE INDEX IF NOT EXISTS idx_strategies_pf ON strategies(profit_factor DESC);
      CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy_id);
    `);
  }

  clearInstrument(instrument: string): void {
    this.db.prepare('DELETE FROM trades WHERE instrument = ?').run(instrument);
    this.db.prepare('DELETE FROM strategies WHERE instrument = ?').run(instrument);
  }

  saveResult(instrument: string, result: StrategyResult): void {
    const { dna, metrics } = result;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO strategies (
          id, instrument, trend, sr, entry, stop, target, time_filter, exit_rule,
          net_profit, cagr, win_rate, profit_factor, sharpe, max_drawdown_pct, avg_r,
          total_trades, consecutive_wins, consecutive_losses, consistency_score,
          stability_score, rank_score, passed_filters, monthly_json, yearly_json, params_json
        ) VALUES (
          @id, @instrument, @trend, @sr, @entry, @stop, @target, @time_filter, @exit_rule,
          @net_profit, @cagr, @win_rate, @profit_factor, @sharpe, @max_drawdown_pct, @avg_r,
          @total_trades, @consecutive_wins, @consecutive_losses, @consistency_score,
          @stability_score, @rank_score, @passed_filters, @monthly_json, @yearly_json, @params_json
        )`,
      )
      .run({
        id: `${instrument}::${dna.id}`,
        instrument,
        trend: dna.trend,
        sr: dna.sr,
        entry: dna.entry,
        stop: dna.stop,
        target: dna.target,
        time_filter: dna.time,
        exit_rule: dna.exit,
        net_profit: metrics.netProfit,
        cagr: metrics.cagr,
        win_rate: metrics.winRate,
        profit_factor: metrics.profitFactor,
        sharpe: metrics.sharpe,
        max_drawdown_pct: metrics.maxDrawdownPct,
        avg_r: metrics.avgR,
        total_trades: metrics.totalTrades,
        consecutive_wins: metrics.consecutiveWins,
        consecutive_losses: metrics.consecutiveLosses,
        consistency_score: metrics.consistencyScore,
        stability_score: metrics.stabilityScore,
        rank_score: result.rankScore,
        passed_filters: result.passedFilters ? 1 : 0,
        monthly_json: JSON.stringify(metrics.monthlyReturns),
        yearly_json: JSON.stringify(metrics.yearlyReturns),
        params_json: JSON.stringify(dna),
      });

    // Store trades only for filtered / high-rank strategies to keep DB lean
    if (result.passedFilters || result.rankScore > 80) {
      const insert = this.db.prepare(
        `INSERT INTO trades (
          strategy_id, instrument, entry_time, exit_time, direction, entry, exit, stop, target,
          points, r_multiple, outcome, month
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const sid = `${instrument}::${dna.id}`;
      const tx = this.db.transaction(() => {
        for (const t of result.trades) {
          insert.run(
            sid,
            instrument,
            t.entryTime,
            t.exitTime,
            t.direction,
            t.entry,
            t.exit,
            t.stop,
            t.target,
            t.points,
            t.rMultiple,
            t.outcome,
            t.month,
          );
        }
      });
      tx();
    }
  }

  topStrategies(instrument: string, limit = 100): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT * FROM strategies
         WHERE instrument = ? AND passed_filters = 1
         ORDER BY rank_score DESC
         LIMIT ?`,
      )
      .all(instrument, limit) as Record<string, unknown>[];
  }

  close(): void {
    this.db.close();
  }
}

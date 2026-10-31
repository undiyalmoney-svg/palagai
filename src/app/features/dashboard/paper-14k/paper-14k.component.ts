import { DecimalPipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PAPER_14K_BLOTTER } from '../../../core/paper-desk/paper-14k-blotter.fixture';
import {
  PAPER_14K_BOOKS,
  Paper14kSnapshot,
  paperSnapshot,
  readPaperCursor,
  resetPaperCursor,
  writePaperCursor,
} from '../../../core/paper-desk/paper-14k.engine';

@Component({
  selector: 'app-paper-14k',
  standalone: true,
  imports: [DecimalPipe, RouterLink],
  templateUrl: './paper-14k.component.html',
  styleUrl: '../crude-oil/crude-oil.component.css',
})
export class Paper14kComponent implements OnInit {
  protected readonly tape = PAPER_14K_BLOTTER;
  protected readonly books = PAPER_14K_BOOKS;
  protected readonly snap = signal<Paper14kSnapshot>(paperSnapshot(0));

  ngOnInit(): void {
    this.snap.set(paperSnapshot(readPaperCursor()));
  }

  protected playNext(): void {
    const next = Math.min(this.snap().played + 1, this.tape.sessions.length);
    writePaperCursor(next);
    this.snap.set(paperSnapshot(next));
  }

  protected playAll(): void {
    writePaperCursor(this.tape.sessions.length);
    this.snap.set(paperSnapshot(this.tape.sessions.length));
  }

  protected resetFund(): void {
    resetPaperCursor();
    this.snap.set(paperSnapshot(0));
  }
}

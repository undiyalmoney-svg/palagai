import { DecimalPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LivePaperService } from '../../../core/paper-desk/live-paper.service';
import { allClosedFills, booksFundEnd } from '../../../core/paper-desk/live-paper.engine';

@Component({
  selector: 'app-paper-14k',
  standalone: true,
  imports: [DecimalPipe, RouterLink],
  templateUrl: './paper-14k.component.html',
  styleUrl: '../crude-oil/crude-oil.component.css',
})
export class Paper14kComponent {
  protected readonly paper = inject(LivePaperService);

  protected startPaper(): void {
    void this.paper.start();
  }

  protected stopPaper(): void {
    this.paper.stop();
  }

  protected booksFund(): number {
    return booksFundEnd(this.paper.session().books);
  }

  protected fills() {
    return allClosedFills(this.paper.session().books);
  }
}

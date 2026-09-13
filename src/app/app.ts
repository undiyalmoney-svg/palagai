import { Component, OnDestroy, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, take } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  protected readonly title = signal('palagai');

  private readonly platformId = inject(PLATFORM_ID);
  private readonly router    = inject(Router);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  protected readonly splashVisible = signal(this.isBrowser);
  protected readonly splashFading  = signal(false);

  private fadeTimer:     ReturnType<typeof setTimeout> | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    if (!this.isBrowser) return;

    // Remove splash after first route resolves
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), take(1))
      .subscribe(() => {
        this.fadeTimer = setTimeout(() => this.beginFade(), 450);
      });

    // Hard fallback — always clear by 3.5 s
    this.fallbackTimer = setTimeout(() => this.beginFade(), 3500);
  }

  private beginFade(): void {
    if (this.splashFading()) return;
    this.splashFading.set(true);
    this.fadeTimer = setTimeout(() => this.splashVisible.set(false), 560);
  }

  ngOnDestroy(): void {
    if (this.fadeTimer)     clearTimeout(this.fadeTimer);
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
  }
}

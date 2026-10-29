import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it, beforeEach } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { KiteFundsService } from '../../core/services/kite-funds.service';
import { UiDialogService } from '../../shared/ui/dialog/ui-dialog.service';
import { DashboardComponent } from './dashboard.component';

describe('DashboardComponent navigation', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let router: Router;

  beforeEach(async () => {
    if (typeof window !== 'undefined' && !window.matchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: () => ({
          matches: false,
          media: '',
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        }),
      });
    }
    const user = signal({
      id: '1',
      username: 'Devil',
      role: 'owner',
      modules: ['token', 'backtest', 'test'],
    });
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideHttpClient(),
        provideRouter([
          { path: 'dashboard/get-token', component: DashboardComponent },
          { path: 'dashboard/historical-backtest', component: DashboardComponent },
          { path: 'dashboard/order-test', component: DashboardComponent },
          { path: 'login', component: DashboardComponent },
        ]),
        {
          provide: AuthService,
          useValue: {
            hasModule: () => true,
            isPublic: () => false,
            isAuthenticated: () => true,
            currentUser: user.asReadonly(),
            ensureHydratedFromStorage: () => true,
            refreshMe: async () => true,
            refreshMeStrict: async () => true,
            getToken: () => 'tok',
            logout: () => undefined,
            dismissAdminMessage: async () => undefined,
          },
        },
        {
          provide: UiDialogService,
          useValue: { confirm: async () => false },
        },
        {
          provide: KiteFundsService,
          useValue: {
            funds: signal(null),
            busy: signal(false),
            error: signal(''),
            refresh: async () => undefined,
          },
        },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    await router.navigateByUrl('/dashboard/get-token');
    fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
  });

  it('lists Historical Backtest and navigates there from Token', async () => {
    const el = fixture.nativeElement as HTMLElement;
    const link = el.querySelector('[data-testid="nav-backtest"]') as HTMLAnchorElement | null;
    expect(link).toBeTruthy();
    expect(link?.textContent).toMatch(/Historical Backtest/i);

    fixture.componentInstance['go']('/dashboard/historical-backtest');
    await fixture.whenStable();
    expect(router.url).toBe('/dashboard/historical-backtest');
  });
});

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { LoginComponent } from './login.component';

@Component({ standalone: true, template: '' })
class StubPageComponent {}

describe('LoginComponent desk resume', () => {
  it('continues a signed-in owner to Historical Backtest when returnUrl is set', async () => {
    const user = {
      id: '1',
      username: 'Devil',
      role: 'owner',
      modules: ['token', 'backtest', 'test'],
    };
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([
          { path: 'login', component: LoginComponent },
          { path: 'dashboard/historical-backtest', component: StubPageComponent },
          { path: 'dashboard/get-token', component: StubPageComponent },
        ]),
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: () => true,
            isPublic: () => false,
            currentUser: () => user,
            ensureHydratedFromStorage: () => true,
            hasModule: () => true,
            login: async () => ({ ok: true }),
            refreshMe: async () => true,
            logout: () => undefined,
          },
        },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    await router.navigateByUrl('/login?returnUrl=%2Fdashboard%2Fhistorical-backtest');
    const fixture: ComponentFixture<LoginComponent> = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    fixture.componentInstance['resumeDeskIfPossible']();
    await fixture.whenStable();
    expect(router.url).toBe('/dashboard/historical-backtest');
  });
});

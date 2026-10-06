import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DeskTabComponent } from './desk-tab.component';
import { MomentumApiService } from '../momentum-api.service';
import { DeskScan } from '../momentum.models';

describe('DeskTabComponent suggestions', () => {
  let fixture: ComponentFixture<DeskTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeskTabComponent],
      providers: [
        provideRouter([]),
        {
          provide: MomentumApiService,
          useValue: {
            desk: () => Promise.resolve({ tokenReady: true }),
            deskScan: () => new Promise(() => undefined),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DeskTabComponent);
  });

  it('shows buy tomorrow, sell today and sell tomorrow and no paper or live', () => {
    const scan = {
      headline: 'Buy tomorrow: NYKAA. Sell today: RECLTD.',
      capital: 25000,
      buyTomorrow: [{ symbol: 'NYKAA', qty: 14, suggestedLimit: 341, whenLabel: 'Buy tomorrow', analysis: '3M +8.3%, 6M +41.5%, 1M +0.6% · score 89.3' }],
      sellToday: [{ symbol: 'RECLTD', qty: 1, suggestedSell: 297, whenLabel: 'Sell today', analysis: '3M -16.7%, 6M -8.0% · score 41' }],
      sellTomorrow: [{ symbol: 'IDEA', qty: 10, suggestedSell: 12, whenLabel: 'Sell tomorrow', analysis: '3M -4.0% · score 30' }],
      buy: [],
      hold: [],
      sell: [],
    } as unknown as DeskScan;
    fixture.componentInstance['scan'].set(scan);
    fixture.componentInstance['busy'].set(false);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const text = root.textContent as string;
    expect(root.querySelectorAll('article.signal').length).toBe(3);
    expect(text).toContain('Buy tomorrow');
    expect(text).toContain('NYKAA');
    expect(text).toContain('14 shares');
    expect(text).toContain('Qty from');
    expect(text).toContain('3M +8.3%');
    expect(text).toContain('Sell today');
    expect(text).toContain('3M -16.7%');
    expect(text).toContain('RECLTD');
    expect(text).toContain('Sell tomorrow');
    expect(text).toContain('IDEA');
    expect(text).not.toContain('Paper');
    expect(text).not.toContain('Live');
  });
});

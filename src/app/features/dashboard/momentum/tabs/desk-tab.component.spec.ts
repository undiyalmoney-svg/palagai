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
      headline: 'Buy tomorrow: NIACL. Sell today: RECLTD.',
      buyTomorrow: [{ symbol: 'NIACL', qty: 3, suggestedLimit: 162.5, whenLabel: 'Buy tomorrow' }],
      sellToday: [{ symbol: 'RECLTD', qty: 1, suggestedSell: 297, whenLabel: 'Sell today' }],
      sellTomorrow: [{ symbol: 'IDEA', qty: 10, suggestedSell: 12, whenLabel: 'Sell tomorrow' }],
      buy: [],
      hold: [],
      sell: [],
    } as unknown as DeskScan;
    fixture.componentInstance['scan'].set(scan);
    fixture.componentInstance['busy'].set(false);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Buy tomorrow');
    expect(text).toContain('NIACL');
    expect(text).toContain('Sell today');
    expect(text).toContain('RECLTD');
    expect(text).toContain('Sell tomorrow');
    expect(text).toContain('IDEA');
    expect(text).not.toContain('Paper');
    expect(text).not.toContain('Live');
  });
});

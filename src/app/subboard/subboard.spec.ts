import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Subboard } from './subboard';

describe('Subboard', () => {
  let component: Subboard;
  let fixture: ComponentFixture<Subboard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Subboard]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Subboard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

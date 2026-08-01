import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';

/** Shown when the user has no modules (or as a safe landing). */
@Component({
  selector: 'app-dashboard-home',
  standalone: true,
  imports: [RouterLink, MatButtonModule],
  template: `
    <section class="home">
      <h1>No desk available</h1>
      <p>
        Your account has no modules enabled, or the session needs a fresh login. Ask admin
        (<code>angel</code>) to enable Trade / Crude / Auto / Token — or sign in again.
      </p>
      <a mat-flat-button color="primary" routerLink="/login">Go to login</a>
    </section>
  `,
  styles: `
    .home {
      max-width: 520px;
      margin: 3rem auto;
      padding: 1.5rem;
      text-align: center;
    }
    p {
      color: #5a6f66;
      line-height: 1.5;
    }
  `,
})
export class DashboardHomeComponent {}

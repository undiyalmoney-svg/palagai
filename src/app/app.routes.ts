import { Routes } from '@angular/router';
import { Subboard } from './subboard/subboard';
import { Login } from './login/login';
import { Signup } from './signup/signup';
import { Mainboard } from './mainboard/mainboard';
import { Competition } from './competition/competition';
import { AdminComponent } from './admin/admin.component';
import { AdminLoginComponent } from './admin/admin-login.component';
import { FullScreenBoardComponent } from './fullscreen-board/fullscreen-board.component';
import { KavithaiSubmitComponent } from './kavithai/kavithai-submit.component';
import { KavithaiListComponent } from './kavithai/kavithai-list.component';
import { PollResultsComponent } from './poll-results/poll-results.component';
import { UserDashboardComponent } from './user-dashboard/user-dashboard.component';
import { CreateBalloonSecretComponent } from './balloon/create-balloon-secret.component';
import { BalloonPunchRevealComponent } from './balloon/balloon-punch-reveal.component';

export const routes: Routes = [
  {
    path: '',
    component: Subboard,
    pathMatch: 'full',
  },
  {
    path: 'login',
    component: Login,
  },
  {
    path: 'signup',
    component: Signup,
  },
  {
    path: 'dashboard',
    component: UserDashboardComponent,
  },
  {
    path: 'mainboard',
    component: Mainboard,
  },
  {
    path: 'preview',
    component: Subboard,
  },
  {
    path: 'competition',
    component: Competition,
  },
  {
    path: 'board/:id',
    component: FullScreenBoardComponent,
  },
  {
    path: 'kavithai/submit',
    component: KavithaiSubmitComponent,
  },
  {
    path: 'kavithai/list',
    component: KavithaiListComponent,
  },
  {
    path: 'create-balloon',
    component: CreateBalloonSecretComponent,
  },
  {
    path: 'punch/:data',
    component: BalloonPunchRevealComponent,
  },
  {
    path: 'poll/:boardKey/results',
    component: PollResultsComponent,
  },
  {
    path: 'admin',
    component: AdminComponent,
  },
  {
    path: 'admin/login',
    component: AdminLoginComponent,
  },
  {
    path: '**',
    redirectTo: '',
  },
];

import { Routes } from '@angular/router';
import { Subboard } from './subboard/subboard';
import { Login } from './login/login';
import { Mainboard } from './mainboard/mainboard';
import { Competition } from './competition/competition';

export const routes: Routes = [
  {
    path: '',
    component: Subboard,
  },
  {
    path: 'login',
    component: Login,
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
    path: '**',
    redirectTo: '',
  },
];

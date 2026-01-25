import { Routes } from '@angular/router';
import { Subboard } from './subboard/subboard';
import { Login } from './login/login';
import { Signup } from './signup/signup';
import { Mainboard } from './mainboard/mainboard';
import { Competition } from './competition/competition';
import { AdminComponent } from './admin/admin.component';
import { AdminLoginComponent } from './admin/admin-login.component';

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

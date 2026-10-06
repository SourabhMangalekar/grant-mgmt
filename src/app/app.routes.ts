import { Routes } from '@angular/router';
import { approvedGuard, authGuard, guestGuard } from './core/auth/auth.guards';

export const routes: Routes = [
  {
    path: 'auth',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/auth/auth-layout').then(m => m.AuthLayout),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'login' },
      { path: 'login', title: 'Sign in · Grant Management', loadComponent: () => import('./pages/auth/login/login').then(m => m.Login) },
      { path: 'signup', title: 'Create account · Grant Management', loadComponent: () => import('./pages/auth/signup/signup').then(m => m.Signup) },
      { path: 'forgot-password', title: 'Reset password · Grant Management', loadComponent: () => import('./pages/auth/forgot-password/forgot-password').then(m => m.ForgotPassword) },
    ],
  },
  {
    path: 'pending',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/auth/auth-layout').then(m => m.AuthLayout),
    children: [
      { path: '', title: 'Awaiting approval · Grant Management', loadComponent: () => import('./pages/auth/pending/pending').then(m => m.Pending) },
    ],
  },
  {
    path: '',
    canActivate: [authGuard, approvedGuard],
    loadComponent: () => import('./layout/shell').then(m => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', title: 'Dashboard · Grant Management', loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard) },
      { path: 'grants', title: 'Grants · Grant Management', loadComponent: () => import('./pages/grants/grants').then(m => m.Grants) },
    ],
  },
  { path: '**', redirectTo: '' },
];

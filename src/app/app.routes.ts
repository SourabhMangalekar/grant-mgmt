import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { affiliationGuard, approvedGuard, authGuard, guestGuard } from './core/auth/auth.guards';
import { AuthStore } from './core/auth/auth.store';
import { homeOf } from './core/nav';

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
      // Each tenant type lands on its own home page.
      { path: '', pathMatch: 'full', redirectTo: () => homeOf(inject(AuthStore).user()?.affiliation) },

      // Granter (funder)
      { path: 'dashboard', canActivate: [affiliationGuard('granter')], title: 'Overview · Grant Management', loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard) },
      { path: 'grant-calls', canActivate: [affiliationGuard('granter')], title: 'Calls for proposals · Grant Management', loadComponent: () => import('./pages/granter/grant-calls/grant-calls').then(m => m.GrantCalls) },
      { path: 'grant-calls/new', canActivate: [affiliationGuard('granter')], title: 'New call for proposals · Grant Management', loadComponent: () => import('./pages/granter/grant-call-form/grant-call-form').then(m => m.GrantCallForm) },
      { path: 'grant-calls/:id', canActivate: [affiliationGuard('granter')], title: 'Call for proposals · Grant Management', loadComponent: () => import('./pages/granter/grant-call-detail/grant-call-detail').then(m => m.GrantCallDetail) },
      { path: 'grants', canActivate: [affiliationGuard('granter')], title: 'Applications · Grant Management', loadComponent: () => import('./pages/grants/grants').then(m => m.Grants) },

      // Grantee
      { path: 'home', canActivate: [affiliationGuard('grantee')], title: 'Home · Grant Management', loadComponent: () => import('./pages/grantee/home/grantee-home').then(m => m.GranteeHome) },
      { path: 'calls', canActivate: [affiliationGuard('grantee')], title: 'Open calls · Grant Management', loadComponent: () => import('./pages/grantee/calls/open-calls').then(m => m.OpenCalls) },
      { path: 'applications', canActivate: [affiliationGuard('grantee')], title: 'My applications · Grant Management', loadComponent: () => import('./pages/grantee/applications/my-applications').then(m => m.MyApplications) },
    ],
  },
  { path: '**', redirectTo: '' },
];

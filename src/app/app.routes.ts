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
      { path: 'login', title: 'Sign in · Commons.Grants', loadComponent: () => import('./pages/auth/login/login').then(m => m.Login) },
      { path: 'signup', title: 'Create account · Commons.Grants', loadComponent: () => import('./pages/auth/signup/signup').then(m => m.Signup) },
      { path: 'forgot-password', title: 'Reset password · Commons.Grants', loadComponent: () => import('./pages/auth/forgot-password/forgot-password').then(m => m.ForgotPassword) },
    ],
  },
  {
    path: 'pending',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/auth/auth-layout').then(m => m.AuthLayout),
    children: [
      { path: '', title: 'Awaiting approval · Commons.Grants', loadComponent: () => import('./pages/auth/pending/pending').then(m => m.Pending) },
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
      { path: 'dashboard', canActivate: [affiliationGuard('granter')], title: 'Overview · Commons.Grants', loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard) },
      { path: 'grant-calls', canActivate: [affiliationGuard('granter')], title: 'Calls for proposals · Commons.Grants', loadComponent: () => import('./pages/granter/grant-calls/grant-calls').then(m => m.GrantCalls) },
      { path: 'grant-calls/new', canActivate: [affiliationGuard('granter')], title: 'New call for proposals · Commons.Grants', loadComponent: () => import('./pages/granter/grant-call-form/grant-call-form').then(m => m.GrantCallForm) },
      { path: 'grant-calls/:id', canActivate: [affiliationGuard('granter')], title: 'Call for proposals · Commons.Grants', loadComponent: () => import('./pages/granter/grant-call-detail/grant-call-detail').then(m => m.GrantCallDetail) },
      // Applications received: per call, then one application. The side-nav "Applications" page lists them across all calls.
      { path: 'grant-calls/:id/applications', canActivate: [affiliationGuard('granter')], title: 'Applications received · Commons.Grants', loadComponent: () => import('./pages/granter/received/call-applications').then(m => m.CallApplications) },
      { path: 'grant-calls/:id/applications/:applicationId', canActivate: [affiliationGuard('granter')], title: 'Application · Commons.Grants', loadComponent: () => import('./pages/granter/received/application-detail').then(m => m.ApplicationDetail) },
      // After approval: the award and its tranches (set up, review plans and reports, release payments, close).
      { path: 'grant-calls/:id/applications/:applicationId/award', canActivate: [affiliationGuard('granter')], title: 'Grant & tranches · Commons.Grants', loadComponent: () => import('./pages/granter/award/award-detail').then(m => m.AwardDetail) },
      { path: 'grants', canActivate: [affiliationGuard('granter')], title: 'Applications · Commons.Grants', loadComponent: () => import('./pages/grants/grants').then(m => m.Grants) },

      // Grantee
      { path: 'home', canActivate: [affiliationGuard('grantee')], title: 'Home · Commons.Grants', loadComponent: () => import('./pages/grantee/home/grantee-home').then(m => m.GranteeHome) },
      { path: 'calls', canActivate: [affiliationGuard('grantee')], title: 'Open calls · Commons.Grants', loadComponent: () => import('./pages/grantee/calls/open-calls').then(m => m.OpenCalls) },
      { path: 'calls/:id', canActivate: [affiliationGuard('grantee')], title: 'Call for proposals · Commons.Grants', data: { audience: 'grantee' }, loadComponent: () => import('./pages/granter/grant-call-detail/grant-call-detail').then(m => m.GrantCallDetail) },
      { path: 'calls/:id/apply', canActivate: [affiliationGuard('grantee')], title: 'New proposal · Commons.Grants', loadComponent: () => import('./pages/grantee/proposal-form/proposal-form').then(m => m.ProposalForm) },
      { path: 'applications', canActivate: [affiliationGuard('grantee')], title: 'My applications · Commons.Grants', loadComponent: () => import('./pages/grantee/applications/my-applications').then(m => m.MyApplications) },
      // One of the grantee's applications: its status and, once approved, the grant's tranches (write plans and reports).
      { path: 'applications/:id', canActivate: [affiliationGuard('grantee')], title: 'Application · Commons.Grants', loadComponent: () => import('./pages/grantee/applications/application-view').then(m => m.ApplicationView) },
    ],
  },
  { path: '**', redirectTo: '' },
];

import { registerLocaleData } from '@angular/common';
import localeEnIn from '@angular/common/locales/en-IN';
import { ApplicationConfig, LOCALE_ID, inject, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { routes } from './app.routes';
import { sessionInterceptor } from './core/auth/session.interceptor';
import { mockIamInterceptor } from './core/auth/mock-iam.interceptor';
import { AuthStore } from './core/auth/auth.store';

// Indian digit grouping (₹50,00,000) for the currency and number pipes app-wide.
registerLocaleData(localeEnIn);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: LOCALE_ID, useValue: 'en-IN' },
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    // Order matters: session header is added first, then the mock (if enabled) answers.
    provideHttpClient(withInterceptors([sessionInterceptor, mockIamInterceptor])),
    provideAppInitializer(() => inject(AuthStore).restore()),
  ],
};

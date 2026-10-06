import { Injectable, effect, inject, signal } from '@angular/core';
import { AuthStore } from './auth/auth.store';

const KEY = 'gm-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly auth = inject(AuthStore);
  readonly dark = signal(this.initial());

  constructor() {
    effect(() => {
      const dark = this.dark();
      document.documentElement.classList.toggle('dark-theme', dark);
      try { localStorage.setItem(KEY, dark ? 'dark' : 'light'); } catch {}
    });
    // Tenant-type palette (see styles/_theme.scss). Signed-out pages keep the default (granter blue) palette.
    effect(() => {
      document.documentElement.classList.toggle('tenant-grantee', this.auth.user()?.affiliation === 'grantee');
    });
  }

  toggle() { this.dark.update(v => !v); }

  private initial(): boolean {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) return saved === 'dark';
    } catch {}
    return true; // dark navy is the default look
  }
}

import { Injectable, effect, signal } from '@angular/core';

const KEY = 'gm-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly dark = signal(this.initial());

  constructor() {
    effect(() => {
      const dark = this.dark();
      document.documentElement.classList.toggle('dark-theme', dark);
      try { localStorage.setItem(KEY, dark ? 'dark' : 'light'); } catch {}
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

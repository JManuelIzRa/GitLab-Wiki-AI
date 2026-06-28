import { Injectable, signal } from '@angular/core';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'theme';

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return 'dark';
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private _theme = signal<Theme>(readStoredTheme());

  /** Readonly signal emitting the current theme. */
  readonly theme = this._theme.asReadonly();

  constructor() {
    // Ensure the data-theme attribute is set on initialisation.
    applyTheme(this._theme());
  }

  /** Toggle between 'dark' and 'light', persist to localStorage, and update the
   *  data-theme attribute on <html>. */
  toggleTheme(): void {
    const current = this._theme();
    const next: Theme = current === 'dark' ? 'light' : 'dark';
    this._theme.set(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  /** Programmatically set a specific theme. */
  setTheme(theme: Theme): void {
    this._theme.set(theme);
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme(theme);
  }
}

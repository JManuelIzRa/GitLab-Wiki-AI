import { Injectable, effect, inject } from '@angular/core';
import mermaid from 'mermaid';
import { ThemeService } from './theme.service';

export const MERMAID_DARK_VARS: Record<string, string> = {
  background: '#201D17',
  primaryColor: '#2A2620',
  primaryTextColor: '#EDE8DC',
  primaryBorderColor: '#C97C4A',
  lineColor: '#8A5536',
  secondaryColor: '#332E25',
  tertiaryColor: '#201D17',
  fontFamily: 'JetBrains Mono, monospace',
};

export const MERMAID_LIGHT_VARS: Record<string, string> = {
  background: '#F7F3EC',
  primaryColor: '#EDE8DC',
  primaryTextColor: '#1A150C',
  primaryBorderColor: '#A05A28',
  lineColor: '#C87A44',
  secondaryColor: '#E2DAC8',
  tertiaryColor: '#EDE8DC',
  fontFamily: 'JetBrains Mono, monospace',
};

export type MermaidTheme = 'dark' | 'default' | 'neutral' | 'forest';

export interface MermaidRenderResult {
  svg: string;
}

/**
 * Injectable service wrapping the mermaid library.
 *
 * Provides initialize() and render() methods so components can lazily
 * re-initialize mermaid on theme changes without importing the raw module.
 */
@Injectable({
  providedIn: 'root',
})
export class MermaidService {
  constructor() {
    const themeService = inject(ThemeService);
    // Re-init mermaid whenever the app theme changes
    effect(() => {
      const t = themeService.theme();
      this.initialize(t === 'light' ? 'default' : 'dark');
    });
  }

  /**
   * (Re-)initialize mermaid with the given theme and matching theme variables.
   */
  initialize(theme: MermaidTheme = 'dark'): void {
    const themeVariables = theme === 'default' ? MERMAID_LIGHT_VARS : MERMAID_DARK_VARS;
    mermaid.initialize({
      startOnLoad: false,
      theme,
      themeVariables,
    });
  }

  /**
   * Render a mermaid diagram string to SVG.
   * Returns a promise that resolves to `{ svg }`.
   */
  async render(renderId: string, code: string): Promise<MermaidRenderResult> {
    return mermaid.render(renderId, code);
  }
}

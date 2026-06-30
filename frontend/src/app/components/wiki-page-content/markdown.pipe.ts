import { Pipe, PipeTransform } from '@angular/core';

/**
 * Simple markdown-to-HTML pipe for basic formatting.
 * Code blocks and mermaid blocks are extracted beforehand (not processed here).
 */
@Pipe({
  name: 'basicMarkdown',
  standalone: true,
})
export class BasicMarkdownPipe implements PipeTransform {
  transform(value: string): string {
    if (!value) return '';

    let html = value
      // Escape HTML
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Double asterisk bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Single asterisk italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Inline code
      .replace(/`(.+?)`/g, '<code class="inline-code">$1</code>')
      // Links
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
      )
      // Line breaks
      .replace(/\n/g, '<br>');

    return html;
  }
}

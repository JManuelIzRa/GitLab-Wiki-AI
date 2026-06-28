import {
  Component,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  inject,
} from '@angular/core';

interface LineProps {
  style?: Record<string, string>;
}

@Component({
  selector: 'app-highlighted-code',
  standalone: true,
  imports: [],
  templateUrl: './highlighted-code.component.html',
  styleUrls: ['./highlighted-code.component.css'],
})
export class HighlightedCodeComponent implements OnChanges {
  @Input() language = 'text';
  @Input() showLineNumbers = false;
  @Input() startingLineNumber = 1;
  @Input() wrapLines = false;
  @Input() lineProps?: (lineNumber: number) => LineProps;
  @Input() customStyle?: Record<string, string>;

  private el = inject(ElementRef);

  processedLines: { number: number; code: string; style: Record<string, string> }[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    this.highlight();
  }

  private highlight(): void {
    const code = this.el.nativeElement.textContent || '';
    const lines = code.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    this.processedLines = lines.map((line, i) => {
      const lineNumber = this.startingLineNumber + i;
      const propsStyle = this.lineProps ? this.lineProps(lineNumber).style || {} : {};
      return {
        number: lineNumber,
        code: line,
        style: {
          display: 'block',
          ...propsStyle,
        },
      };
    });
  }
}

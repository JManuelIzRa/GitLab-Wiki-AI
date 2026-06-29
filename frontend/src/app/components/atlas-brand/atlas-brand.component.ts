import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-atlas-brand',
  standalone: true,
  imports: [],
  templateUrl: './atlas-brand.component.html',
  styleUrls: ['./atlas-brand.component.css'],
})
export class AtlasBrandComponent {
  @Input() size: number = 24;
  @Input() showText: boolean = true;
}

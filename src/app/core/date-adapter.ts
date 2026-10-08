import { Injectable, Provider } from '@angular/core';
import { DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE, MatDateFormats, NativeDateAdapter } from '@angular/material/core';

/**
 * Material's NativeDateAdapter parses typed dates with Date.parse, i.e. US month-first: "07/10/2026" becomes 10 July.
 * This adapter reads Indian day-first input (DD/MM/YYYY, also with "-" or "." and 2-digit years) and rejects impossible
 * dates like 31/02/2026. Everything else (calendar, display via Intl in en-IN) is the native adapter's.
 */
@Injectable()
export class AppDateAdapter extends NativeDateAdapter {
  override parse(value: unknown, parseFormat?: unknown): Date | null {
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) return null;
      const m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
      if (m) {
        const day = +m[1], month = +m[2] - 1, year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
        const date = new Date(year, month, day);
        const real = date.getFullYear() === year && date.getMonth() === month && date.getDate() === day;
        return real ? date : this.invalid();
      }
    }
    return super.parse(value, parseFormat);
  }
}

/** Input shows DD/MM/YYYY (en-IN); calendar header "Oct 2026"; screen readers get "7 October 2026". */
export const APP_DATE_FORMATS: MatDateFormats = {
  parse: { dateInput: 'DD/MM/YYYY' },
  display: {
    dateInput: { day: '2-digit', month: '2-digit', year: 'numeric' },
    monthYearLabel: { year: 'numeric', month: 'short' },
    dateA11yLabel: { year: 'numeric', month: 'long', day: 'numeric' },
    monthYearA11yLabel: { year: 'numeric', month: 'long' },
  },
};

/** App-wide date support for mat-datepicker / mat-date-range-input. Registered once in app.config.ts. */
export function provideAppDateAdapter(): Provider[] {
  return [
    { provide: MAT_DATE_LOCALE, useValue: 'en-IN' },
    { provide: DateAdapter, useClass: AppDateAdapter },
    { provide: MAT_DATE_FORMATS, useValue: APP_DATE_FORMATS },
  ];
}

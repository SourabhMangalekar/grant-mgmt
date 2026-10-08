import { AbstractControl, ValidationErrors } from '@angular/forms';

/** Helpers shared by the tranche plan and report forms. */

/** Required, and more than spaces. */
export function notBlank(control: AbstractControl): ValidationErrors | null {
  return String(control.value ?? '').trim() ? null : { required: true };
}

/** Rupees with at most two decimals (paise). Empty values are left to `required`. */
export function paise(control: AbstractControl): ValidationErrors | null {
  const v = control.value as number | null;
  return v == null || Math.abs(v * 100 - Math.round(v * 100)) < 1e-6 ? null : { paise: true };
}

/** "₹1,20,000" or "₹40,000.40": whole rupees unless there are paise. */
export function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 })
    .format(minor / 100);
}

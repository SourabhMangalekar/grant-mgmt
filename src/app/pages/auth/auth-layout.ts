import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { ThemeService } from '../../core/theme.service';

@Component({
  selector: 'gm-auth-layout',
  imports: [RouterOutlet, MatIconModule, MatButtonModule],
  template: `
    <div class="auth">
      <aside class="hero" aria-hidden="true">
        <div class="brand"><mat-icon>bar_chart</mat-icon><span>Commons<span class="brand-suffix">.Grants</span></span></div>
        <div class="pitch">
          <span class="eyebrow">For funders &amp; nonprofits</span>
          <h2>Run every grant from call to closure.</h2>
          <ul>
            <li><mat-icon>campaign</mat-icon> Publish calls for proposals</li>
            <li><mat-icon>fact_check</mat-icon> Review and decide on applications</li>
            <li><mat-icon>account_balance</mat-icon> Release tranches and track utilisation</li>
          </ul>
        </div>
        <div class="bars">
          <span style="--w: 72%"></span><span style="--w: 48%"></span><span style="--w: 88%"></span>
        </div>
      </aside>

      <main class="panel">
        <div class="panel-top">
          <div class="brand mobile-brand"><mat-icon>bar_chart</mat-icon><span>Commons<span class="brand-suffix">.Grants</span></span></div>
          <button mat-icon-button (click)="theme.toggle()"
                  [attr.aria-label]="theme.dark() ? 'Switch to light theme' : 'Switch to dark theme'">
            <mat-icon>{{ theme.dark() ? 'light_mode' : 'dark_mode' }}</mat-icon>
          </button>
        </div>
        <div class="form-wrap"><router-outlet /></div>
      </main>
    </div>
  `,
  styleUrl: './auth-layout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthLayout {
  protected readonly theme = inject(ThemeService);
}

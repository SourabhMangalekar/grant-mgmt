import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { map } from 'rxjs';
import { ThemeService } from '../core/theme.service';
import { AuthStore } from '../core/auth/auth.store';
import { MatMenuModule } from '@angular/material/menu';

@Component({
  selector: 'gm-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatSidenavModule, MatToolbarModule, MatListModule, MatIconModule, MatButtonModule, MatTooltipModule, MatMenuModule],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Shell {
  protected readonly auth = inject(AuthStore);
  protected readonly initials = computed(() =>
    (this.auth.user()?.name ?? '?').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase());
  protected readonly theme = inject(ThemeService);
  protected readonly isMobile = toSignal(
    inject(BreakpointObserver).observe('(max-width: 959.98px)').pipe(map(r => r.matches)),
    { initialValue: false },
  );
  protected readonly nav = [
    { path: '/dashboard', label: 'Dashboard', icon: 'space_dashboard' },
    { path: '/grants', label: 'Grants', icon: 'request_quote' },
  ];
}

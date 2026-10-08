import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Observable, filter, map, switchMap } from 'rxjs';

const MESSAGE_ID = 'gm-confirm-message';

export interface ConfirmData {
  title: string;
  message: string;
  /** Label of the confirming button, e.g. "Select application". */
  confirm: string;
  icon?: string;
}

/** Asks before an action that changes a record. Focus starts on Cancel, so Enter doesn't confirm by accident. */
@Component({
  selector: 'gm-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content><p [id]="messageId">{{ data.message }}</p></mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [mat-dialog-close]="false">Cancel</button>
      <button mat-flat-button type="button" [mat-dialog-close]="true">
        @if (data.icon) { <mat-icon>{{ data.icon }}</mat-icon> }
        {{ data.confirm }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `p { margin: 0; line-height: 1.5; }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
  protected readonly messageId = MESSAGE_ID;
}

/** Opens a ConfirmDialog; emits true only when the user confirms (Cancel, Esc and clicking outside give false). */
export function confirmAction(dialog: MatDialog, data: ConfirmData): Observable<boolean> {
  const ref = dialog.open<ConfirmDialog, ConfirmData, boolean>(ConfirmDialog, {
    data, width: '440px', maxWidth: 'calc(100vw - 32px)',
    // Screen readers read the message (which record, what happens), not just the title.
    ariaDescribedBy: MESSAGE_ID,
    // Closing is handled below: the second click of a double-click would otherwise land on the new backdrop and close it.
    disableClose: true,
  });
  ref.keydownEvents().pipe(filter(e => e.key === 'Escape')).subscribe(() => ref.close(false));
  ref.afterOpened().pipe(switchMap(() => ref.backdropClick())).subscribe(() => ref.close(false));
  return ref.afterClosed().pipe(map(result => result === true));
}

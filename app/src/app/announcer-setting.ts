import { signal } from '@angular/core';

/** Plan 42: the announcer (play-by-play) switch, remembered on this device. Default on. */
const KEY = 'pr_pbp';
function load(): boolean { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } }
export const announcerOn = signal(load());
export function setAnnouncer(on: boolean) {
  announcerOn.set(on);
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode: this visit only */ }
}

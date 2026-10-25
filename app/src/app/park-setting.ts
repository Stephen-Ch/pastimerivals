import { signal } from '@angular/core';

/** Plan 44: "Follow the ball" switch, remembered on this device. Default on. */
const KEY = 'pr_park';
function load(): boolean { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } }
export const parkOn = signal(load());
export function setPark(on: boolean) {
  parkOn.set(on);
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode: this visit only */ }
}

import { signal } from '@angular/core';

/** Plan 42: the announcer (play-by-play) switch, remembered on this device. Default on. */
const KEY = 'pr_pbp';
function load(): boolean { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } }
export const announcerOn = signal(load());
/** Plan 50: listeners told when the text announcer is switched (the voice turns off with it). */
const onChange: ((on: boolean) => void)[] = [];
export function onAnnouncerChange(fn: (on: boolean) => void) { onChange.push(fn); }
export function setAnnouncer(on: boolean) {
  announcerOn.set(on);
  onChange.forEach(fn => fn(on));
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode: this visit only */ }
}

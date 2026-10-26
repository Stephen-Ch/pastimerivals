import { signal } from '@angular/core';
import { announcerOn, onAnnouncerChange, setAnnouncer } from './announcer-setting';
import { voice } from './audio';

/** Plan 50: the announcer voice switch, remembered on this device. Default off. The voice speaks the text announcer's lines,
 *  so turning the voice on turns the text on, and turning the text off turns the voice off. */
const KEY = 'pr_voice';
function load(): boolean { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } }
export const voiceOn = signal(load() && announcerOn());
export function setVoice(on: boolean) {
  voiceOn.set(on);
  if (on) { voice.ensure(); void voice.enable(); if (!announcerOn()) setAnnouncer(true); }
  else voice.stopAll();
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode: this visit only */ }
}
onAnnouncerChange(on => { if (!on && voiceOn()) setVoice(false); });

/** Unlock on any tap while the voice is on (covers a returning visitor with the voice already on). iPhones accept
 *  pointerup, click and keydown as gestures (not pointerdown). Removed once the context is running. */
if (typeof document !== 'undefined') {
  const evs = ['pointerup', 'click', 'keydown'] as const;
  const unlock = () => {
    if (!voiceOn()) return;
    voice.ensure();
    if (voice.running()) evs.forEach(e => document.removeEventListener(e, unlock, true));
  };
  evs.forEach(e => document.addEventListener(e, unlock, true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') voice.stopAll(); });
  if (voiceOn()) void voice.enable();
}

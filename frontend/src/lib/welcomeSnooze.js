// "Don't show again for 7 days" on the welcome popup. The deadline is kept in
// localStorage (per browser). Storage can be missing or throw (private mode,
// blocked site data), in which case the popup simply shows as before.
const KEY = 'dino.welcomeSnoozedUntil'
const DAY_MS = 24 * 60 * 60 * 1000

export const WELCOME_SNOOZE_DAYS = 7

export function isWelcomeSnoozed(now = Date.now()) {
  try {
    const until = Number(window.localStorage.getItem(KEY))
    return Number.isFinite(until) && until > now
  } catch {
    return false
  }
}

export function snoozeWelcome(days = WELCOME_SNOOZE_DAYS, now = Date.now()) {
  try {
    window.localStorage.setItem(KEY, String(now + days * DAY_MS))
  } catch {
    // Nothing to do: it just won't be remembered.
  }
}

export const MOBILE_FEEDBACK_STORAGE_KEY = 'scpo-mobile-feedback'

export function triggerMobileFeedback() {
  if (typeof navigator === 'undefined' || window.localStorage.getItem(MOBILE_FEEDBACK_STORAGE_KEY) !== 'enabled') return
  if ('vibrate' in navigator && typeof navigator.vibrate === 'function') {
    navigator.vibrate(18)
  }
}

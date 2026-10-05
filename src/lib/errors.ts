// Turns database/network errors into plain English.
// `loading`: the error happened while loading, so there are no entries on screen to keep.
export function friendlyError(message: string, code?: string, loading = false): string {
  if (/failed to fetch|network|load failed/i.test(message)) {
    return loading
      ? "Can't reach the server. Check your internet connection and try again."
      : "Can't reach the server. Check your internet connection and try again. Your entries are still on screen."
  }
  if (code === '23505') {
    return 'This was already saved from another tab or device. Reload the page to see it (unsaved entries here will be lost).'
  }
  if (/locked/i.test(message)) {
    return 'This day is confirmed and locked, so it cannot be changed.'
  }
  return `The database refused to save: ${message}`
}

'use client'

export function formatCallPhone(phoneRaw: string | null | undefined): string {
  if (!phoneRaw) return ''
  let clean = phoneRaw.trim()
  if (clean.startsWith('+')) return clean
  let digits = clean.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.substring(1)
  }
  if (digits.length === 10) {
    return `+91${digits}`
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits}`
  }
  return `+${digits}`
}

/**
 * Universal safe phone dialer for PWA, Mobile Web, and Native Apps.
 * 
 * In standalone PWA mode (Android Chrome WebAPK, iOS PWA) and WebViews:
 * Calling `window.open('tel:...', '_self')` or clicking `<a href="tel:...">` without target="_blank"
 * replaces the PWA window's location with the 'tel:' URI.
 * When returning from the dialer, Chromium attempts to load or restore that URL,
 * which crashes with `net::ERR_UNKNOWN_URL_SCHEME` ("The site can't be reached").
 * 
 * This helper dispatches the system phone dialer safely without modifying
 * the main PWA window's location or history.
 */
export function openPhoneDialer(phoneRaw: string | null | undefined): void {
  if (!phoneRaw || typeof window === 'undefined') return
  const cleanPhone = formatCallPhone(phoneRaw)
  if (!cleanPhone) return

  const telUri = `tel:${cleanPhone}`

  // 1. If running inside native Android / iOS Capacitor container with CallLog plugin
  try {
    const cap = (window as any).Capacitor
    const callPlugin = cap?.Plugins?.CallLog || (window as any).CallLog
    if (callPlugin && typeof callPlugin.openDialer === 'function') {
      callPlugin.openDialer({ phoneNumber: cleanPhone }).catch(() => {
        dispatchPwaDial(telUri)
      })
      return
    }
  } catch (e) {}

  // 2. Safe PWA / Web dispatch
  dispatchPwaDial(telUri)
}

function dispatchPwaDial(telUri: string): void {
  // Method 1: Invisible detached iframe.
  // In Chrome PWA (standalone WebAPK) and mobile browsers, setting an iframe's src
  // to a tel: URL triggers the OS dialer without ANY top-level navigation.
  // The main window's URL and history remain completely untouched.
  try {
    let iframe = document.getElementById('nobogent-tel-dispatcher') as HTMLIFrameElement | null
    if (!iframe) {
      iframe = document.createElement('iframe')
      iframe.id = 'nobogent-tel-dispatcher'
      iframe.style.position = 'fixed'
      iframe.style.top = '-9999px'
      iframe.style.left = '-9999px'
      iframe.style.width = '1px'
      iframe.style.height = '1px'
      iframe.style.opacity = '0'
      iframe.style.pointerEvents = 'none'
      iframe.style.border = 'none'
      document.body.appendChild(iframe)
    }
    iframe.src = telUri
    return
  } catch (e) {}

  // Method 2: Temporary hidden anchor with target="_blank"
  try {
    const a = document.createElement('a')
    a.href = telUri
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      try { document.body.removeChild(a) } catch (e) {}
    }, 1000)
  } catch (e) {
    // Method 3: window.open with _blank as last resort (never _self)
    try {
      window.open(telUri, '_blank')
    } catch (e2) {}
  }
}

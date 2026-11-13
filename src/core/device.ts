// Name of this browser in „Meine Geräte“, like the app takes the model of the phone.
import { texts } from '../i18n'

/** Name in „Meine Geräte“ on the phone, e.g. „Firefox auf Mac“. */
export function browserDeviceName(ua = navigator.userAgent): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Mac OS X|Macintosh/.test(ua) && !/Mobile/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : ''
  const on = texts.dateLocale.startsWith('de') ? 'auf' : 'on'
  return os ? `${browser} ${on} ${os}` : browser
}

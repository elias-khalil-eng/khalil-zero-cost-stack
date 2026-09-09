// Ports of the C# server's LooseDateParser / MoneyParser (themselves ports of
// the original Electron app's parseDateLoose / moneyNum). Handles three date
// shapes: Excel/Sheets serial-day numbers, ISO dates, and slash/dash
// DD/MM/YYYY (or MM/DD) with an ambiguity heuristic that defaults to DD/MM,
// matching this business's data entry convention.

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)
const MS_PER_DAY = 86_400_000

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function toIso(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

/** Parses a loose date string; returns ISO `yyyy-MM-dd` or null. */
export function parseDateLoose(value?: string | null): string | null {
  if (!value || !String(value).trim()) return null

  let s = String(value).trim()
  const spaceIdx = s.indexOf(' ')
  if (spaceIdx >= 0) s = s.slice(0, spaceIdx)
  if (!s) return null

  // Excel/Sheets serial day number (base 1899-12-30)
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const serial = Number(s)
    if (Number.isFinite(serial) && serial > 20000) {
      const d = new Date(EXCEL_EPOCH_UTC + Math.floor(serial) * MS_PER_DAY)
      return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
    }
  }

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) {
    const y = Number(iso[1])
    const m = Number(iso[2])
    const d = Number(iso[3])
    if (m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)) return toIso(y, m, d)
    return null
  }

  const m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    let yy = Number(m[3])
    if (yy < 100) yy += 2000

    // DD/MM by default; swap only when one side is unambiguously a day (>12).
    let day: number
    let month: number
    if (a > 12 && b <= 12) { day = a; month = b }
    else if (b > 12 && a <= 12) { day = b; month = a }
    else { day = a; month = b }

    // Like the C# port (unlike JS's Date), an out-of-range calendar date is
    // treated as unparseable rather than rolled into the next month.
    if (month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(yy, month)) {
      return toIso(yy, month, day)
    }
  }

  return null
}

/** Strips everything but digits/decimal point; returns a number or null. */
export function parseMoney(value?: string | null): number | null {
  if (value === null || value === undefined) return null
  const digits = String(value).replace(/[^0-9.]/g, '')
  if (!digits) return null
  const n = Number.parseFloat(digits)
  return Number.isFinite(n) ? n : null
}

/** Inclusive date-range overlap on ISO strings (lexicographic = chronological). */
export function rangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA <= endB && startB <= endA
}

/** Today's date (UTC) as ISO yyyy-MM-dd. */
export function todayIso(): string {
  const d = new Date()
  return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/** Formats an ISO datetime as the API's `yyyy-MM-dd HH:mm` timestamp shape. */
export function formatTimestamp(isoDateTime: string): string {
  const d = new Date(isoDateTime)
  if (Number.isNaN(d.getTime())) return isoDateTime
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** Formats an ISO date as dd/MM/yyyy for generated documents; empty string when unparseable. */
export function formatDateSlash(raw?: string | null): string {
  const iso = parseDateLoose(raw)
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/**
 * `datetime`: RFC 3339 timestamps, compared as instants.
 *
 * Reference: vers-spec docs/types/vers-types.md and https://www.rfc-editor.org/rfc/rfc3339#section-5.6.
 * Canonical VERS requires an uppercase `T` and `Z`; RFC 3339 also permits lowercase, but those are not
 * valid here. Fractional seconds of any precision are compared exactly. A leap second (`:60`) counts as
 * the first second of the next minute.
 */
import type { Scheme } from './types.ts'
import { compareDigits, invalidVersion } from './util.ts'

const DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$/

interface Instant {
  /** Whole seconds since 1970-01-01T00:00:00Z. */
  readonly seconds: number
  /** Fractional-second digits, without trailing zeros. */
  readonly fraction: string
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

function daysInMonth(y: number, m: number): number {
  return m === 2 ? (isLeapYear(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31
}

// Days since 1970-01-01 in the proleptic Gregorian calendar (Howard Hinnant's days_from_civil).
function daysFromCivil(year: number, m: number, d: number): number {
  const y = m <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * ((m + 9) % 12) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

function parse(version: string): Instant | undefined {
  const m = DATETIME.exec(version)
  if (!m) return undefined
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  const sign = m[8] === '-' ? -1 : 1
  const oh = Number(m[9] ?? 0)
  const om = Number(m[10] ?? 0)
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return undefined
  if (h > 23 || mi > 59 || s > 60 || oh > 23 || om > 59) return undefined
  const local = daysFromCivil(y, mo, d) * 86400 + h * 3600 + mi * 60 + s
  return {
    seconds: local - sign * (oh * 3600 + om * 60),
    fraction: (m[7] ?? '').replace(/0+$/, ''),
  }
}

function parseOrThrow(version: string): Instant {
  const instant = parse(version)
  if (!instant) throw invalidVersion('datetime', version)
  return instant
}

export const datetime: Scheme = {
  type: 'datetime',
  isValid: (version) => parse(version) !== undefined,
  compare(a, b) {
    const x = parseOrThrow(a)
    const y = parseOrThrow(b)
    if (x.seconds !== y.seconds) return x.seconds - y.seconds
    const n = Math.max(x.fraction.length, y.fraction.length)
    return compareDigits(x.fraction.padEnd(n, '0'), y.fraction.padEnd(n, '0'))
  },
}

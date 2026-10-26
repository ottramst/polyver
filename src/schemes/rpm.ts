/**
 * `rpm`: RPM package versions, `[epoch:]version[-release]`.
 *
 * Reference: the rpmvercmp algorithm as described in the Fedora packaging guidelines
 * (https://docs.fedoraproject.org/en-US/packaging-guidelines/Versioning/) and in the comments of the
 * osv-scalibr comparator (https://github.com/google/osv-scalibr/blob/main/semantic/version-redhat.go,
 * Apache-2.0). Tested against rpm 6.0 (`rpm.ver` comparisons) as an oracle (testdata/oracle).
 *
 * Segments of letters or digits are compared one by one and other characters only separate them;
 * `~` sorts before everything (`1.0~rc1 < 1.0`) and `^` sorts after the end of a string but before any
 * further segment (`1.0 < 1.0^git1 < 1.0.1`). A missing epoch is 0, and a missing release sorts
 * before any release (`1.0 < 1.0-~1 < 1.0-1`). rpm accepts any string, but a valid version here is
 * printable ASCII without spaces, which is what RPM packages use.
 */
import type { Scheme } from './types.ts'
import { compareDigits, invalidVersion } from './util.ts'

interface Evr {
  readonly epoch: string
  readonly version: string
  readonly release?: string
}

function parse(evr: string): Evr | undefined {
  if (evr === '' || /[^\x21-\x7e]/.test(evr)) return undefined
  const m = /^(\d*):/.exec(evr)
  const epoch = m ? m[1] || '0' : '0'
  const vr = m ? evr.slice(m[0].length) : evr
  const dash = vr.lastIndexOf('-')
  if (dash === -1) return { epoch, version: vr }
  return { epoch, version: vr.slice(0, dash), release: vr.slice(dash + 1) }
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9'
}

function isAlpha(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

/** Compares two version or release strings segment by segment. */
function rpmvercmp(a: string, b: string): number {
  if (a === b) return 0
  let i = 0
  let j = 0
  for (;;) {
    while (
      i < a.length &&
      !isDigit(a[i] as string) &&
      !isAlpha(a[i] as string) &&
      a[i] !== '~' &&
      a[i] !== '^'
    )
      i++
    while (
      j < b.length &&
      !isDigit(b[j] as string) &&
      !isAlpha(b[j] as string) &&
      b[j] !== '~' &&
      b[j] !== '^'
    )
      j++

    if (a[i] === '~' || b[j] === '~') {
      if (a[i] !== '~') return 1
      if (b[j] !== '~') return -1
      i++
      j++
      continue
    }
    if (a[i] === '^' || b[j] === '^') {
      if (i >= a.length) return -1
      if (j >= b.length) return 1
      if (a[i] !== '^') return 1
      if (b[j] !== '^') return -1
      i++
      j++
      continue
    }
    if (i >= a.length || j >= b.length) break

    const numeric = isDigit(a[i] as string)
    const run = numeric ? isDigit : isAlpha
    const x = i
    const y = j
    while (i < a.length && run(a[i] as string)) i++
    while (j < b.length && run(b[j] as string)) j++
    // A numeric segment is newer than an alphabetic one.
    if (j === y) return numeric ? 1 : -1
    const sa = a.slice(x, i)
    const sb = b.slice(y, j)
    const d = numeric ? compareDigits(sa, sb) : sa < sb ? -1 : sa > sb ? 1 : 0
    if (d !== 0) return d
  }
  if (i >= a.length && j >= b.length) return 0
  return i >= a.length ? -1 : 1
}

function parseOrThrow(version: string): Evr {
  const v = parse(version)
  if (!v) throw invalidVersion('rpm', version)
  return v
}

export const rpm: Scheme = {
  type: 'rpm',
  isValid: (version) => parse(version) !== undefined,
  compare(a, b) {
    const x = parseOrThrow(a)
    const y = parseOrThrow(b)
    const d = compareDigits(x.epoch, y.epoch) || rpmvercmp(x.version, y.version)
    if (d !== 0) return d
    // As in rpm's own EVR comparison, a missing release sorts before any release, even `~1`.
    if (x.release === undefined || y.release === undefined) {
      return Number(x.release !== undefined) - Number(y.release !== undefined)
    }
    return rpmvercmp(x.release, y.release)
  },
}

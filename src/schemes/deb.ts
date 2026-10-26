/**
 * `deb`: Debian package versions, `[epoch:]upstream_version[-debian_revision]`.
 *
 * Reference: Debian Policy §5.6.12 (https://www.debian.org/doc/debian-policy/ch-controlfields.html#version),
 * which defines the comparison, and the validity rules that `dpkg --validate-version` applies. Tested
 * against dpkg 1.22 as an oracle (testdata/oracle). A missing revision compares equal to `0`.
 */
import type { Scheme } from './types.ts'
import { compareDigits, invalidVersion } from './util.ts'

interface DebVersion {
  readonly epoch: string
  readonly upstream: string
  readonly revision: string
}

const MAX_EPOCH = '2147483647'

function parse(version: string): DebVersion | undefined {
  const colon = version.indexOf(':')
  const epoch = colon === -1 ? '0' : version.slice(0, colon)
  const rest = version.slice(colon + 1)
  const dash = rest.lastIndexOf('-')
  const upstream = dash === -1 ? rest : rest.slice(0, dash)
  const revision = dash === -1 ? '' : rest.slice(dash + 1)
  // dpkg reads the epoch with strtol, so it accepts a leading `+`.
  if (!/^\+?\d+$/.test(epoch) || compareDigits(epoch.replace('+', ''), MAX_EPOCH) > 0)
    return undefined
  if (!/^\d[A-Za-z0-9.+~:-]*$/.test(upstream)) return undefined
  if (dash !== -1 && !/^[A-Za-z0-9.+~]+$/.test(revision)) return undefined
  return { epoch: epoch.replace('+', ''), upstream, revision }
}

// Sort weight of a character in a non-digit part: `~` before the end of the part, the end before
// letters, letters before everything else. A digit ends the part, so it weighs like the end.
function order(s: string, i: number): number {
  if (i >= s.length || isDigit(s, i)) return 0
  const c = s.charCodeAt(i)
  if (c === 0x7e) return -1
  if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) return c
  return c + 256
}

function isDigit(s: string, i: number): boolean {
  const c = s.charCodeAt(i)
  return c >= 0x30 && c <= 0x39
}

/** Compares upstream versions or revisions: alternating non-digit and digit parts (Policy §5.6.12). */
function verrevcmp(a: string, b: string): number {
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    while ((i < a.length && !isDigit(a, i)) || (j < b.length && !isDigit(b, j))) {
      const d = order(a, i) - order(b, j)
      if (d !== 0) return d
      i++
      j++
    }
    const x = i
    const y = j
    while (i < a.length && isDigit(a, i)) i++
    while (j < b.length && isDigit(b, j)) j++
    // A missing digit part counts as 0.
    const d = compareDigits(a.slice(x, i), b.slice(y, j))
    if (d !== 0) return d
  }
  return 0
}

function parseOrThrow(version: string): DebVersion {
  const v = parse(version)
  if (!v) throw invalidVersion('deb', version)
  return v
}

export const deb: Scheme = {
  type: 'deb',
  isValid: (version) => parse(version) !== undefined,
  compare(a, b) {
    const x = parseOrThrow(a)
    const y = parseOrThrow(b)
    return (
      compareDigits(x.epoch, y.epoch) ||
      verrevcmp(x.upstream, y.upstream) ||
      verrevcmp(x.revision, y.revision)
    )
  },
}

/**
 * `npm`: versions and ranges as node-semver parses them in strict (non-loose) mode.
 *
 * Reference: https://github.com/npm/node-semver (ISC), `classes/semver.js` and `classes/range.js`.
 * Versions are SemVer 2.0.0 with an optional leading `v`, at most 256 characters, and numeric core
 * parts no larger than `Number.MAX_SAFE_INTEGER`. Build metadata is ignored when comparing, as in
 * `semver.compare`.
 *
 * Native ranges are desugared as node-semver does (hyphen ranges, `~`, `^`, x-ranges, `*`), with two
 * differences that follow the vers-spec convention: an upper bound is written `<2.0.0` rather than
 * node-semver's `<2.0.0-0`, and node-semver's rule that excludes pre-releases outside the bounds' own
 * `major.minor.patch` is not applied, because VERS ranges are plain intervals.
 */

import { VersError } from '../errors.ts'
import {
  ALL,
  comparatorSet,
  intersect,
  toConstraints,
  union,
  type VersionSet,
} from '../intervals.ts'
import type { Comparator, Constraint } from '../vers.ts'
import { compareSemverParts, parseSemver, type SemverParts } from './semver.ts'
import type { Scheme } from './types.ts'
import { compareDigits, invalidVersion } from './util.ts'

const MAX_LENGTH = 256
const MAX_SAFE_DIGITS = String(Number.MAX_SAFE_INTEGER)

function parseNpm(version: string): SemverParts | undefined {
  if (version.length > MAX_LENGTH) return undefined
  const parts = parseSemver(version.startsWith('v') ? version.slice(1) : version)
  if (!parts || parts.core.some((n) => compareDigits(n, MAX_SAFE_DIGITS) > 0)) return undefined
  return parts
}

function parseOrThrow(version: string): SemverParts {
  const parts = parseNpm(version)
  if (!parts) throw invalidVersion('npm', version)
  return parts
}

function compare(a: string, b: string): number {
  return compareSemverParts(parseOrThrow(a), parseOrThrow(b))
}

// A partial version in a range: `1`, `1.2`, `1.x`, `1.2.3-beta+build`, `*`. `undefined` is a missing
// or wildcard (`x`, `X`, `*`) part.
interface Partial {
  readonly major?: number
  readonly minor?: number
  readonly patch?: number
  readonly prerelease?: string
}

const NUMERIC = '0|[1-9]\\d*'
const XID = `${NUMERIC}|[xX*]`
const PRERELEASE_ID = `(?:${NUMERIC}|\\d*[a-zA-Z-][a-zA-Z0-9-]*)`
const PARTIAL = new RegExp(
  `^[v=]*(${XID})(?:\\.(${XID})(?:\\.(${XID})(?:-(${PRERELEASE_ID}(?:\\.${PRERELEASE_ID})*))?)?)?$`,
)
// node-semver removes build metadata from a comparator before parsing it.
const BUILD = /\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*/

function syntaxError(range: string, detail: string): VersError {
  return new VersError('INVALID_SYNTAX', `invalid npm range ${JSON.stringify(range)}: ${detail}`)
}

function parsePartial(text: string, range: string): Partial {
  const m = PARTIAL.exec(text.replace(BUILD, ''))
  if (!m) throw syntaxError(range, `cannot parse ${JSON.stringify(text)}`)
  const parts = [m[1], m[2], m[3]].map((part) => {
    if (part === undefined || /^[xX*]$/.test(part)) return undefined
    if (compareDigits(part, MAX_SAFE_DIGITS) > 0) throw syntaxError(range, `${part} is too large`)
    return Number(part)
  })
  // A wildcard can only be followed by wildcards, as in `1.x.x`; `1.x.5` is invalid.
  const wildcard = parts.indexOf(undefined)
  if (wildcard !== -1 && parts.slice(wildcard).some((n) => n !== undefined)) {
    throw syntaxError(range, `${JSON.stringify(text)} has a number after a wildcard`)
  }
  const [major, minor, patch] = parts
  return {
    ...(major !== undefined && { major }),
    ...(minor !== undefined && { minor }),
    ...(patch !== undefined && { patch }),
    // A pre-release after a wildcard, as in `1.x.x-alpha`, is ignored.
    ...(m[4] !== undefined && wildcard === -1 && { prerelease: m[4] }),
  }
}

function v(major: number, minor: number, patch: number, prerelease?: string): string {
  return `${major}.${minor}.${patch}${prerelease === undefined ? '' : `-${prerelease}`}`
}

function cmp(comparator: Comparator, version: string): VersionSet {
  // node-semver treats `>=0.0.0` as "any version".
  if (comparator === '>=' && version === '0.0.0') return ALL
  return comparatorSet(comparator, version)
}

function between(lo: string, hi: string): VersionSet {
  return intersect([cmp('>=', lo), cmp('<', hi)], compare)
}

function caret({ major: M, minor: m, patch: p, prerelease }: Partial): VersionSet {
  if (M === undefined) return ALL
  if (m === undefined) return between(v(M, 0, 0), v(M + 1, 0, 0))
  if (p === undefined) return between(v(M, m, 0), M === 0 ? v(0, m + 1, 0) : v(M + 1, 0, 0))
  const lo = v(M, m, p, prerelease)
  if (M > 0) return between(lo, v(M + 1, 0, 0))
  if (m > 0) return between(lo, v(0, m + 1, 0))
  return between(lo, v(0, 0, p + 1))
}

function tilde({ major: M, minor: m, patch: p, prerelease }: Partial): VersionSet {
  if (M === undefined) return ALL
  if (m === undefined) return between(v(M, 0, 0), v(M + 1, 0, 0))
  return between(v(M, m, p ?? 0, prerelease), v(M, m + 1, 0))
}

function xrange(op: string, partial: Partial): VersionSet {
  const { major: M, minor: m, patch: p, prerelease } = partial
  if (M === undefined) return op === '<' || op === '>' ? [] : ALL
  if (m !== undefined && p !== undefined) {
    return cmp(op === '' ? '=' : (op as Comparator), v(M, m, p, prerelease))
  }
  switch (op) {
    case '>':
      return cmp('>=', m === undefined ? v(M + 1, 0, 0) : v(M, m + 1, 0))
    case '>=':
      return cmp('>=', v(M, m ?? 0, 0))
    case '<':
      return cmp('<', v(M, m ?? 0, 0))
    case '<=':
      return cmp('<', m === undefined ? v(M + 1, 0, 0) : v(M, m + 1, 0))
    default:
      return m === undefined
        ? between(v(M, 0, 0), v(M + 1, 0, 0))
        : between(v(M, m, 0), v(M, m + 1, 0))
  }
}

function hyphen(from: Partial, to: Partial): VersionSet {
  const lo: VersionSet =
    from.major === undefined
      ? ALL
      : cmp('>=', v(from.major, from.minor ?? 0, from.patch ?? 0, from.prerelease))
  let hi: VersionSet
  if (to.major === undefined) hi = ALL
  else if (to.minor === undefined) hi = cmp('<', v(to.major + 1, 0, 0))
  else if (to.patch === undefined) hi = cmp('<', v(to.major, to.minor + 1, 0))
  else hi = cmp('<=', v(to.major, to.minor, to.patch, to.prerelease))
  return intersect([lo, hi], compare)
}

const HYPHEN = /^(\S+)\s+-\s+(\S+)$/
const COMPARATOR = /^(~>?|\^|[<>]=?|=)?(.*)$/

function parseAlternative(text: string, range: string): VersionSet {
  const alt = text.trim()
  const h = HYPHEN.exec(alt)
  if (h) return hyphen(parsePartial(h[1] as string, range), parsePartial(h[2] as string, range))
  if (alt === '') return ALL
  const sets = alt
    .replace(/(~>?|\^|[<>]=?|=)\s+/g, '$1')
    .split(/\s+/)
    .map((token) => {
      const [, op = '', rest] = COMPARATOR.exec(token) as RegExpExecArray
      const partial = parsePartial(rest as string, range)
      if (op === '^') return caret(partial)
      if (op.startsWith('~')) return tilde(partial)
      return xrange(op === '=' ? '' : op, partial)
    })
  return intersect(sets, compare)
}

function fromNative(range: string): Constraint[] {
  const set = union(
    range.split('||').map((alt) => parseAlternative(alt, range)),
    compare,
  )
  if (set.length === 0) {
    throw new VersError(
      'INVALID_CONSTRAINTS',
      `npm range ${JSON.stringify(range)} matches no version`,
    )
  }
  return toConstraints(set, compare)
}

export const npm: Scheme = {
  type: 'npm',
  isValid: (version) => parseNpm(version) !== undefined,
  compare,
  fromNative,
}

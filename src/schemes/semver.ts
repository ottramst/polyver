/**
 * `semver`: Semantic Versioning 2.0.0.
 *
 * Reference: https://semver.org/spec/v2.0.0.html (precedence rules in §11). Build metadata does not
 * affect precedence, so `1.0.0+a` and `1.0.0+b` compare equal.
 */
import type { Scheme } from './types.ts'
import { compareDigits, invalidVersion } from './util.ts'

// The regular expression suggested by the SemVer 2.0.0 specification.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

/** A parsed SemVer version: the numeric core as digit strings and the pre-release identifiers. */
export interface SemverParts {
  readonly core: readonly [string, string, string]
  readonly prerelease: readonly string[]
}

export function parseSemver(version: string): SemverParts | undefined {
  const m = SEMVER.exec(version)
  if (!m) return undefined
  return {
    core: [m[1] as string, m[2] as string, m[3] as string],
    prerelease: m[4] === undefined ? [] : m[4].split('.'),
  }
}

const NUMERIC = /^\d+$/

function compareIdentifiers(a: string, b: string): number {
  const an = NUMERIC.test(a)
  const bn = NUMERIC.test(b)
  if (an && bn) return compareDigits(a, b)
  if (an) return -1
  if (bn) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Compares two parsed versions by SemVer 2.0.0 precedence. */
export function compareSemverParts(a: SemverParts, b: SemverParts): number {
  for (let i = 0; i < 3; i++) {
    const c = compareDigits(a.core[i] as string, b.core[i] as string)
    if (c !== 0) return c
  }
  // A version without a pre-release has higher precedence than one with a pre-release.
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length - a.prerelease.length
  }
  const n = Math.min(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < n; i++) {
    const c = compareIdentifiers(a.prerelease[i] as string, b.prerelease[i] as string)
    if (c !== 0) return c
  }
  return a.prerelease.length - b.prerelease.length
}

function parseOrThrow(version: string): SemverParts {
  const parts = parseSemver(version)
  if (!parts) throw invalidVersion('semver', version)
  return parts
}

export const semver: Scheme = {
  type: 'semver',
  isValid: (version) => SEMVER.test(version),
  compare: (a, b) => compareSemverParts(parseOrThrow(a), parseOrThrow(b)),
}

/**
 * `npm`: versions as node-semver parses them in strict (non-loose) mode.
 *
 * Reference: https://github.com/npm/node-semver/blob/main/classes/semver.js (ISC). That is SemVer
 * 2.0.0 with an optional leading `v`, at most 256 characters, and numeric core parts no larger than
 * `Number.MAX_SAFE_INTEGER`. Build metadata is ignored when comparing, as in `semver.compare`.
 * Numeric pre-release identifiers are compared exactly, as SemVer requires; node-semver converts them to
 * numbers, so it treats `1.0.0-9007199254740993` and `1.0.0-9007199254740992` as equal.
 */

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

export const npm: Scheme = {
  type: 'npm',
  isValid: (version) => parseNpm(version) !== undefined,
  compare: (a, b) => compareSemverParts(parseOrThrow(a), parseOrThrow(b)),
}

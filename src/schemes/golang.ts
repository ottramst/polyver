/**
 * `golang`: Go module versions, ordered as by `golang.org/x/mod/semver`.
 *
 * Reference: the Go modules reference (https://go.dev/ref/mod#versions and
 * https://go.dev/ref/mod#pseudo-versions) and `semver/semver.go` in golang.org/x/mod v0.42.0
 * (https://github.com/golang/mod/blob/b5136e5ba156da612a1efc6e49b55988a134a5e0/semver/semver.go,
 * BSD-3-Clause). Tested against that version as an oracle (testdata/oracle) and against its test tables
 * (testdata/x-mod).
 *
 * Go follows SemVer 2.0.0 with two exceptions: a version starts with `v`, and the shorthands `v1` and
 * `v1.2` (without a pre-release or build) mean `v1.0.0` and `v1.2.0`. The `v` is optional here, as
 * advisories usually omit it, so `1.2.3 == v1.2.3`. Pseudo-versions such as
 * `v0.0.0-20191109021931-daa7c04131f5` are pre-releases whose timestamp sorts numerically, and
 * `+incompatible` is build metadata, so neither needs special handling. x/mod orders an invalid version
 * before every valid one; here `compare` throws instead. Go has no native range syntax (go.mod uses
 * minimum version selection), so there is no `fromNative`.
 */
import { compareSemverParts, parseSemver, type SemverParts } from './semver.ts'
import type { Scheme } from './types.ts'
import { invalidVersion } from './util.ts'

const SHORTHAND = /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?$/

function parseGo(version: string): SemverParts | undefined {
  const v = version.startsWith('v') ? version.slice(1) : version
  const m = SHORTHAND.exec(v)
  if (m) return { core: [m[1] as string, m[2] ?? '0', '0'], prerelease: [] }
  return parseSemver(v)
}

function parseOrThrow(version: string): SemverParts {
  const parts = parseGo(version)
  if (!parts) throw invalidVersion('golang', version)
  return parts
}

export const golang: Scheme = {
  type: 'golang',
  isValid: (version) => parseGo(version) !== undefined,
  compare: (a, b) => compareSemverParts(parseOrThrow(a), parseOrThrow(b)),
}

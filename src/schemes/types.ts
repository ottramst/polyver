import type { Constraint } from '../vers.ts'

/**
 * A versioning scheme: how one ecosystem's versions are validated and ordered.
 *
 * Each scheme mirrors a reference implementation (dpkg, rpmvercmp, apk-tools, pypa/packaging, ...)
 * and is tested against vectors from a permissively licensed source or from that tool as an oracle.
 */
export interface Scheme {
  /** The VERS type, e.g. `deb`. */
  readonly type: string
  /** Reports whether `version` is a valid version in this scheme. */
  isValid(version: string): boolean
  /**
   * Returns a negative number, zero or a positive number as `a` sorts before, equal to or after `b`.
   * Throws a `VersError` with code `INVALID_VERSION` if either version is invalid.
   */
  compare(a: string, b: string): number
  /**
   * Converts a range in the ecosystem's native syntax (such as npm's `^1.2.3 || >=2.0.1`) to canonical
   * VERS constraints. Only some schemes implement it; use the package's `fromNative` function.
   */
  fromNative?(native: string): Constraint[]
}

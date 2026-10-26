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
  /** Returns a negative number, zero or a positive number as `a` sorts before, equal to or after `b`. */
  compare(a: string, b: string): number
}

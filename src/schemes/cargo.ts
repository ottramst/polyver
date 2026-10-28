/**
 * `cargo`: Rust crate versions and Cargo version requirements.
 *
 * Reference: https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html and dtolnay/semver
 * 1.0.28, the crate Cargo uses (https://github.com/dtolnay/semver/tree/7625c7aa3f0e8ba21e099d1765bcebcb72aa8816,
 * MIT/Apache-2.0): `Version::parse` and `VersionReq::parse` in `src/parse.rs`, `VersionReq::matches` in
 * `src/eval.rs`. Tested against that version as an oracle (testdata/oracle) and against its test suite
 * (testdata/dtolnay-semver).
 *
 * Versions are SemVer 2.0.0 whose major, minor and patch numbers fit in a u64. Build metadata is
 * ignored when comparing, as in SemVer precedence, `Version::cmp_precedence` and
 * `VersionReq::matches`; `Version`'s `Ord` instead uses build metadata as a tie-breaker, so that
 * `1.0.0+a < 1.0.0+b` there but not here.
 *
 * Native ranges are `VersionReq` strings: comparators joined with `,` (Cargo has no `||`), each one of
 * `^`, `~`, `=`, `>`, `>=`, `<`, `<=` or none, which means `^`. A comparator can omit the minor and
 * patch numbers or replace them with `*`, `x` or `X`; a lone `*` matches every version. `^` allows
 * changes that keep the leftmost nonzero number (`^0.2.3` is `>=0.2.3|<0.3.0`, `^0.0.3` is `0.0.3`),
 * and `~` allows patch changes (`~1.2` is `>=1.2.0|<1.3.0`).
 *
 * The VERS range contains every version that the requirement matches. A partial `^` (or bare)
 * comparator and a partial `>` also match the pre-releases of their lower bound, so that bound is the
 * smallest pre-release: `^1.2` is `>=1.2.0-0|<2.0.0` and `>1` is `>=2.0.0-0`. It can also contain
 * pre-releases that the requirement rejects: as for npm, upper bounds are written `<2.0.0` rather than
 * `<2.0.0-0`, and Cargo's rule that a pre-release only matches a requirement with a pre-release of the
 * same `major.minor.patch` is not applied, because a VERS range is a plain set of intervals:
 * `vers:cargo/>=1.0.0|<2.0.0` contains `1.5.0-alpha`, which `^1.0.0` does not match.
 */
import { VersError } from '../errors.ts'
import { ALL, comparatorSet, intersect, toConstraints, type VersionSet } from '../intervals.ts'
import type { Constraint } from '../vers.ts'
import { compareSemverParts, parseSemver, type SemverParts } from './semver.ts'
import type { Scheme } from './types.ts'
import { compareDigits, invalidVersion } from './util.ts'

const U64_MAX = '18446744073709551615'

function parseCargo(version: string): SemverParts | undefined {
  const parts = parseSemver(version)
  if (!parts || parts.core.some((n) => compareDigits(n, U64_MAX) > 0)) return undefined
  return parts
}

function parseOrThrow(version: string): SemverParts {
  const parts = parseCargo(version)
  if (!parts) throw invalidVersion('cargo', version)
  return parts
}

function compare(a: string, b: string): number {
  return compareSemverParts(parseOrThrow(a), parseOrThrow(b))
}

type Op = '=' | '>' | '>=' | '<' | '<=' | '~' | '^'

/** A comparator of a requirement; a missing minor or patch number was omitted or a wildcard. */
interface Comparator {
  readonly op: Op
  readonly major: string
  readonly minor?: string
  readonly patch?: string
  readonly pre: string
}

// The parser is a port of `src/parse.rs`, character by character, so that it accepts exactly what
// `VersionReq::parse` does. Its only whitespace is U+0020, skipped where `trim_start_matches(' ')` is.

const MAX_COMPARATORS = 32

class ReqParser {
  private readonly text: string
  private i = 0

  constructor(text: string) {
    this.text = text
  }

  fail(detail: string): never {
    throw new VersError(
      'INVALID_SYNTAX',
      `invalid cargo requirement ${JSON.stringify(this.text)}: ${detail}`,
    )
  }

  private peek(): string | undefined {
    return this.text[this.i]
  }

  private eat(c: string): boolean {
    if (this.text[this.i] !== c) return false
    this.i++
    return true
  }

  private spaces(): void {
    while (this.text[this.i] === ' ') this.i++
  }

  private wildcard(): boolean {
    const c = this.peek()
    if (c !== '*' && c !== 'x' && c !== 'X') return false
    this.i++
    return true
  }

  /** `numeric_identifier`: digits without a leading zero, at most u64::MAX. */
  private numeric(): string {
    const start = this.i
    while (/[0-9]/.test(this.peek() ?? '')) this.i++
    const digits = this.text.slice(start, this.i)
    if (digits === '') this.fail(`expected a number at position ${start}`)
    if (digits.length > 1 && digits.startsWith('0')) this.fail(`leading zero in ${digits}`)
    if (compareDigits(digits, U64_MAX) > 0) this.fail(`${digits} exceeds u64::MAX`)
    return digits
  }

  /** `identifier`: dot-separated runs of `[0-9A-Za-z-]`, or the empty string. */
  private identifier(pre: boolean): string {
    const start = this.i
    let segment = this.i
    for (;;) {
      const c = this.peek()
      if (c !== undefined && /[0-9A-Za-z-]/.test(c)) {
        this.i++
        continue
      }
      if (this.i === segment) {
        if (segment === start && c !== '.') return ''
        this.fail(`empty identifier at position ${this.i}`)
      }
      const s = this.text.slice(segment, this.i)
      if (pre && /^0[0-9]+$/.test(s)) this.fail(`leading zero in pre-release identifier ${s}`)
      if (c !== '.') return this.text.slice(start, this.i)
      this.i++
      segment = this.i
    }
  }

  /** `comparator`: an operator, a partial version, and the spaces after it. */
  private comparator(): Comparator {
    let op: Op = '^'
    const explicit = /^(?:[<>]=?|[=~^])/.exec(this.text.slice(this.i, this.i + 2))
    if (explicit) {
      op = explicit[0] as Op
      this.i += op.length
    }
    this.spaces()
    const major = this.numeric()
    let minor: string | undefined
    let patch: string | undefined
    let wildcard = false
    if (this.eat('.')) {
      if (this.wildcard()) wildcard = true
      else minor = this.numeric()
      if (this.eat('.')) {
        if (this.wildcard()) wildcard = true
        else if (wildcard) this.fail('a number after a wildcard')
        else patch = this.numeric()
      }
    }
    // `Op::Wildcard` (`1.*`, `1.2.*`) matches as `Op::Exact` does in `eval.rs`.
    if (wildcard && !explicit) op = '='
    let pre = ''
    if (patch !== undefined && this.eat('-')) {
      pre = this.identifier(true)
      if (pre === '') this.fail('empty pre-release')
    }
    if (patch !== undefined && this.eat('+') && this.identifier(false) === '') {
      this.fail('empty build metadata')
    }
    this.spaces()
    return {
      op,
      major,
      ...(minor !== undefined && { minor }),
      ...(patch !== undefined && { patch }),
      pre,
    }
  }

  /** `VersionReq::from_str`: a lone wildcard, or comparators joined with `,`. */
  parse(): Comparator[] | undefined {
    this.spaces()
    if (this.wildcard()) {
      this.spaces()
      if (this.i < this.text.length) this.fail('a wildcard must be the only comparator')
      return undefined
    }
    const comparators: Comparator[] = []
    for (;;) {
      comparators.push(this.comparator())
      if (this.i === this.text.length) return comparators
      if (!this.eat(',')) this.fail(`expected "," at position ${this.i}`)
      this.spaces()
      if (comparators.length === MAX_COMPARATORS) {
        this.fail(`more than ${MAX_COMPARATORS} comparators`)
      }
    }
  }
}

const U64_LIMIT = BigInt(U64_MAX)

/** The first version after every `major.*`, or undefined if the major number is u64::MAX. */
function nextMajor(major: string): string | undefined {
  const next = BigInt(major) + 1n
  return next > U64_LIMIT ? undefined : `${next}.0.0`
}

/** The first version after every `major.minor.*`. */
function nextMinor(major: string, minor: string): string | undefined {
  const next = BigInt(minor) + 1n
  return next > U64_LIMIT ? nextMajor(major) : `${major}.${next}.0`
}

/** `[lo, hi)`, or `[lo, hi]` if `inclusive`; no upper bound if `hi` is undefined. */
function between(lo: string, hi: string | undefined, inclusive = false): VersionSet {
  const from = comparatorSet('>=', lo)
  return hi === undefined
    ? from
    : intersect([from, comparatorSet(inclusive ? '<=' : '<', hi)], compare)
}

/**
 * The versions that `eval.rs` lets a comparator match, ignoring the pre-release rule. Every version
 * that `matches_impl` accepts is in the set, so the VERS range of a requirement contains every version
 * that `VersionReq::matches` accepts.
 */
function comparatorVersions({ op, major: M, minor: m, patch: p, pre }: Comparator): VersionSet {
  // The smallest release the partial version covers, and the first release after them. `-0` is the
  // smallest pre-release of a release.
  const floor = `${M}.${m ?? 0}.0`
  const next = m === undefined ? nextMajor(M) : nextMinor(M, m)
  if (m === undefined || p === undefined) {
    switch (op) {
      case '>':
        // `matches_greater` compares only the given numbers, so `>1` matches 2.0.0-beta.
        return next === undefined ? [] : comparatorSet('>=', `${next}-0`)
      case '>=':
        // `matches_exact` needs an empty pre-release, so `>=1.2` does not match 1.2.0-beta.
        return comparatorSet('>=', floor)
      case '<':
        return comparatorSet('<', floor)
      case '<=':
        return next === undefined ? ALL : comparatorSet('<', next)
      case '^':
        // `matches_caret` compares only the given numbers, so `^1.2` matches 1.2.0-beta. `^0.m` keeps
        // the minor number; `^M.m` with M > 0, and `^M`, keep the major number.
        return between(`${floor}-0`, M === '0' && m !== undefined ? next : nextMajor(M))
      default:
        // `=`, `~` and wildcards: every release that starts with the given numbers (`matches_exact`
        // and `matches_tilde` need an empty pre-release).
        return between(floor, next)
    }
  }
  const version = `${M}.${m}.${p}${pre === '' ? '' : `-${pre}`}`
  switch (op) {
    case '~':
      return between(version, nextMinor(M, m))
    case '^':
      if (M !== '0') return between(version, nextMajor(M))
      if (m !== '0') return between(version, nextMinor(M, m))
      // `^0.0.p` matches only 0.0.p and, with a pre-release, its later pre-releases.
      return between(version, `0.0.${p}`, true)
    default:
      return comparatorSet(op, version)
  }
}

function fromNative(range: string): Constraint[] {
  const comparators = new ReqParser(range).parse()
  if (comparators === undefined) return [{ comparator: '*' }]
  const set = intersect(comparators.map(comparatorVersions), compare)
  if (set.length === 0) {
    throw new VersError(
      'INVALID_CONSTRAINTS',
      `cargo requirement ${JSON.stringify(range)} matches no version`,
    )
  }
  return toConstraints(set, compare)
}

export const cargo: Scheme = {
  type: 'cargo',
  isValid: (version) => parseCargo(version) !== undefined,
  compare,
  fromNative,
}

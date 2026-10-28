/**
 * `gem`: RubyGems versions and requirements.
 *
 * Reference: https://guides.rubygems.org/patterns/#semantic-versioning and RubyGems
 * `lib/rubygems/version.rb` and `lib/rubygems/requirement.rb` (https://github.com/rubygems/rubygems,
 * MIT). This file mirrors `Gem::Version` from RubyGems 4.0.20, as bundled with Ruby 4.0.9 (the code is
 * unchanged in 4.0.23), and is tested against it as an oracle (testdata/oracle). Unlike RubyGems,
 * surrounding whitespace and the empty string (which RubyGems reads as `0`) are not accepted, because a
 * VERS version cannot contain them.
 *
 * A `-` is read as `.pre.`, and any letter makes a version a pre-release (`1.0.a < 1.0`). A version is
 * split into runs of digits and runs of letters (`1.0a1` is `1.0.a.1`). Letters sort before numbers and
 * compare case-sensitively by byte; trailing zeros, and zeros before the first letter, are ignored
 * (`1.0 == 1.0.0`, `1.0.a == 1.a`).
 *
 * Native ranges are RubyGems requirements (`~> 2.0.8`, `>= 1.0, < 2.0`), joined with `,`. A bare
 * version means `=`, as in `Gem::Requirement`. `~> V` is `>=V` and below the next release of V's
 * second-to-last number, as `Gem::Version#bump` computes it (`~>2.0.8` is `>=2.0.8|<2.1`). RubyGems
 * also rejects pre-releases of that bound (`2.1.a` does not satisfy `~>2.0.8`), which cannot be
 * expressed as a VERS interval because there is no smallest pre-release (`2.1.A.A < 2.1.A`); as in
 * vers-spec, the bound is written `<2.1`.
 */
import { VersError } from '../errors.ts'
import { comparatorSet, intersect, toConstraints } from '../intervals.ts'
import type { Comparator, Constraint } from '../vers.ts'
import type { Scheme } from './types.ts'
import { compareCodePoints, compareDigits, invalidVersion } from './util.ts'

// VERSION_PATTERN, anchored, with its atomic group made a plain group (equivalent here).
const VERSION_PATTERN = '[0-9]+(?:\\.[0-9a-zA-Z]+)*(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?'
const VERSION = new RegExp(`^${VERSION_PATTERN}$`)

/** A run of digits (a number) or of letters (a string). */
interface Segment {
  readonly num: boolean
  readonly value: string
}

function partitionSegments(version: string): Segment[] {
  return [...version.matchAll(/\d+|[a-z]+/gi)].map(([s]) => ({ num: /^\d/.test(s), value: s }))
}

/** The version as `Gem::Version#initialize` stores it, with `-` read as `.pre.`. */
function normalized(version: string): string {
  if (!VERSION.test(version)) throw invalidVersion('gem', version)
  return version.replaceAll('-', '.pre.')
}

const isLetter = (c: string | undefined): boolean => c !== undefined && /[a-zA-Z]/.test(c)
const isDotOrZero = (c: string | undefined): boolean => c === '.' || c === '0'

// The two regexes of `canonical_segments`, as loops: V8 backtracks through a long run of `.0` once
// per starting position, which takes quadratic time.

/** `sub(/(?<=[a-zA-Z.])[.0]+\z/, "")`: the match starts at the first position of the trailing run
 * of dots and zeros that follows a letter or dot. */
function stripTrailingZeros(v: string): string {
  let i = v.length
  while (i > 0 && isDotOrZero(v[i - 1])) i--
  for (let j = Math.max(i, 1); j < v.length; j++) {
    if (isLetter(v[j - 1]) || v[j - 1] === '.') return v.slice(0, j)
  }
  return v
}

/** `sub!(/(?<=\.|\A)[0.]+(?=[a-zA-Z])/, "")`: only the first match is removed. */
function stripZerosBeforeLetter(v: string): string {
  for (let i = 0; i < v.length; ) {
    if (!isDotOrZero(v[i])) {
      i++
      continue
    }
    let end = i
    while (isDotOrZero(v[end])) end++
    if (isLetter(v[end])) {
      // `i` follows neither a dot nor a zero, so it starts a match only at the start of the string.
      for (let j = i; j < end; j++) {
        if (j === 0 || v[j - 1] === '.') return v.slice(0, j) + v.slice(end)
      }
    }
    i = end
  }
  return v
}

/** `Gem::Version#canonical_segments`. */
function canonicalSegments(version: string): Segment[] {
  // Remove trailing zero segments, using a dot or letter as anchor.
  let v = stripTrailingZeros(normalized(version))
  // Remove zero segments before the first letter in a pre-release.
  if (/[a-zA-Z]/.test(v)) v = stripZerosBeforeLetter(v)
  return partitionSegments(v)
}

function compareSegment(a: Segment, b: Segment): number {
  if (a.num !== b.num) return a.num ? 1 : -1
  return a.num ? compareDigits(a.value, b.value) : compareCodePoints(a.value, b.value)
}

// When one version runs out, a letter in the rest of the other makes that one smaller, and a nonzero
// number makes it larger.
function compareTail(rest: readonly Segment[]): number {
  for (const s of rest) {
    if (!s.num) return -1
    if (!/^0+$/.test(s.value)) return 1
  }
  return 0
}

/** `Gem::Version#<=>`, without its fast path for short releases (which gives the same order). */
function compare(a: string, b: string): number {
  const l = canonicalSegments(a)
  const r = canonicalSegments(b)
  const limit = Math.min(l.length, r.length)
  for (let i = 0; i < limit; i++) {
    const c = compareSegment(l[i] as Segment, r[i] as Segment)
    if (c !== 0) return c
  }
  return compareTail(l.slice(limit)) - compareTail(r.slice(limit))
}

/** `Gem::Version#bump`: drop the pre-release part and the last number, then add 1 to the new last. */
function bump(version: string): string {
  const segments = partitionSegments(normalized(version))
  const first = segments.findIndex((s) => !s.num)
  const nums = (first === -1 ? segments : segments.slice(0, first)).map((s) => BigInt(s.value))
  if (nums.length > 1) nums.pop()
  nums.push((nums.pop() as bigint) + 1n)
  return nums.join('.')
}

function syntaxError(range: string, detail: string): VersError {
  return new VersError(
    'INVALID_SYNTAX',
    `invalid gem requirement ${JSON.stringify(range)}: ${detail}`,
  )
}

// Requirement::PATTERN for one requirement. Ruby's `\s` is ASCII-only, so JavaScript's `\s` and
// `trim()`, which also accept Unicode spaces, are not used. The optional operator takes its trailing
// whitespace with it, so that two whitespace runs never compete for the same spaces.
const WS = '[ \\t\\n\\v\\f\\r]*'
const REQUIREMENT = new RegExp(`^${WS}(?:(=|!=|>=|<=|>|<|~>)${WS})?(${VERSION_PATTERN})${WS}$`)

function fromNative(range: string): Constraint[] {
  const sets = range.split(',').map((part) => {
    const m = REQUIREMENT.exec(part)
    if (!m) throw syntaxError(range, `cannot parse ${JSON.stringify(part)}`)
    const op = m[1] ?? '='
    const version = m[2] as string
    if (op !== '~>') return comparatorSet(op as Comparator, version)
    return intersect([comparatorSet('>=', version), comparatorSet('<', bump(version))], compare)
  })
  const set = intersect(sets, compare)
  if (set.length === 0) {
    throw new VersError(
      'INVALID_CONSTRAINTS',
      `gem requirement ${JSON.stringify(range)} matches no version`,
    )
  }
  return toConstraints(set, compare)
}

export const gem: Scheme = {
  type: 'gem',
  isValid: (version) => VERSION.test(version),
  compare,
  fromNative,
}

/**
 * `nuget`: NuGet package versions and version ranges.
 *
 * Reference: https://learn.microsoft.com/en-us/nuget/concepts/package-versioning and NuGet.Versioning
 * 7.9.0 (https://github.com/NuGet/NuGet.Client/tree/977537e19c6be57fead1411e6cf05f936bf1baf4/src/NuGet.Core/NuGet.Versioning,
 * Apache-2.0). This file mirrors `NuGetVersion.TryParse` (validity), `VersionComparer.Default`
 * (order) and `VersionRange.TryParse` without floating versions (native ranges; the same as `Parse`
 * for ranges that do not float), and is tested against them as an oracle
 * (testdata/oracle). Unlike NuGet, whitespace is not accepted in a version: NuGet trims it and
 * ignores it around each number (`1 . 0`), but a VERS version cannot contain it.
 *
 * A version has one to four numbers, each at most 2147483647 (`int.MaxValue`), with leading zeros
 * allowed; a missing number is 0 (`1.0 == 1.0.0.0`). Then come optional pre-release labels after `-`
 * and build metadata after `+`, made of dot-separated ASCII letters, digits and `-`. A pre-release
 * sorts before its release; labels compare one by one, numbers numerically and before strings, and
 * strings ignoring case (`1.0.0-Beta == 1.0.0-beta`). A label is a number if `int.TryParse` reads
 * it, so `-1` is a number and `2147483648` a string. Build metadata is ignored.
 *
 * Native ranges are NuGet's interval notation (`[1.0,2.0)`, `(,1.0]`, `[1.0]`, `(1.0,)`) and a bare
 * version meaning `>=` that version, parsed as by `VersionRange.TryParse` without floating versions
 * (the same as `Parse` for ranges that do not float). Surrounding whitespace is
 * trimmed as .NET's `string.Trim` does, but a bound with whitespace inside is rejected. Floating
 * versions (`1.*`, `1.0.0-*`) select the newest matching version rather than a set of versions, so
 * they are rejected. `(1.0,1.0)`, which NuGet accepts and which matches no version, is rejected
 * because VERS cannot express an empty range.
 */
import { VersError } from '../errors.ts'
import { ALL, comparatorSet, intersect, toConstraints } from '../intervals.ts'
import type { Constraint } from '../vers.ts'
import type { Scheme } from './types.ts'
import { invalidVersion } from './util.ts'

interface Version {
  /** Major, minor, patch and revision. */
  readonly numbers: readonly number[]
  /** Pre-release labels, or `undefined` for a release. */
  readonly labels?: readonly string[]
}

const INT_MAX = 2147483647
const INT_MIN = -2147483648

/** .NET's `char.IsWhiteSpace`, which `string.Trim` uses: unlike JavaScript's `\s` and `trim()`, it
 * includes U+0085 and excludes U+FEFF. */
function isWhiteSpace(c: number): boolean {
  return (
    (c >= 0x09 && c <= 0x0d) ||
    c === 0x20 ||
    c === 0x85 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  )
}

/** .NET's `string.Trim()`. */
function dotnetTrim(s: string): string {
  let start = 0
  let end = s.length
  while (start < end && isWhiteSpace(s.charCodeAt(start))) start++
  while (end > start && isWhiteSpace(s.charCodeAt(end - 1))) end--
  return s.slice(start, end)
}

function hasWhiteSpace(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (isWhiteSpace(s.charCodeAt(i))) return true
  return false
}

const isDigit = (c: string): boolean => c >= '0' && c <= '9'

/** `SemanticVersion.IsValidPart`: a non-empty run of ASCII letters, digits and `-`. */
function isValidPart(s: string, allowLeadingZeros: boolean): boolean {
  if (s === '') return false
  if (!allowLeadingZeros && s.length > 1 && s[0] === '0' && [...s].every(isDigit)) return false
  return /^[0-9A-Za-z-]+$/.test(s)
}

/** One number of the version part, or `undefined` if it is not digits or exceeds `int.MaxValue`. */
function versionNumber(s: string): number | undefined {
  if (!/^[0-9]+$/.test(s)) return undefined
  const digits = s.replace(/^0+(?=.)/, '')
  if (digits.length > 10) return undefined
  const n = Number(digits)
  return n > INT_MAX ? undefined : n
}

/**
 * `NuGetVersion.TryParse` for a string without whitespace. `ParseSections` splits at the first `-` or
 * `+`; a separator at the very end stays in the part before it, which makes that part invalid.
 */
function parse(version: string): Version | undefined {
  if (version === '' || hasWhiteSpace(version)) return undefined
  const sep = version.search(/[-+]/)
  if (sep === version.length - 1) return undefined
  const numberPart = sep === -1 ? version : version.slice(0, sep)
  let labelPart: string | undefined
  let metadata: string | undefined
  if (sep !== -1) {
    const rest = version.slice(sep + 1)
    if (version[sep] === '+') {
      metadata = rest
    } else {
      const plus = rest.indexOf('+')
      if (plus === rest.length - 1) return undefined
      labelPart = plus === -1 ? rest : rest.slice(0, plus)
      if (plus !== -1) metadata = rest.slice(plus + 1)
    }
  }

  const parts = numberPart.split('.')
  if (parts.length > 4) return undefined
  const numbers = [0, 0, 0, 0]
  for (const [i, part] of parts.entries()) {
    const n = versionNumber(part)
    if (n === undefined) return undefined
    numbers[i] = n
  }
  const labels = labelPart?.split('.')
  if (labels && !labels.every((l) => isValidPart(l, false))) return undefined
  if (metadata !== undefined && !metadata.split('.').every((m) => isValidPart(m, true))) {
    return undefined
  }
  return labels ? { numbers, labels } : { numbers }
}

function parseOrThrow(version: string): Version {
  const v = parse(version)
  if (!v) throw invalidVersion('nuget', version)
  return v
}

/** `int.TryParse` with the invariant culture, for a label: an optional `-` and digits within Int32. */
function labelNumber(label: string): number | undefined {
  if (!/^-?[0-9]+$/.test(label)) return undefined
  const negative = label.startsWith('-')
  const digits = label.slice(negative ? 1 : 0).replace(/^0+(?=.)/, '')
  if (digits.length > 10) return undefined
  const n = negative ? -Number(digits) : Number(digits)
  return n > INT_MAX || n < INT_MIN ? undefined : n
}

/** `StringComparer.OrdinalIgnoreCase.Compare`: ASCII letters upper-cased, then by UTF-16 code unit. */
function compareIgnoreCase(a: string, b: string): number {
  const upper = (c: number): number => (c >= 0x61 && c <= 0x7a ? c - 0x20 : c)
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = upper(a.charCodeAt(i)) - upper(b.charCodeAt(i))
    if (d !== 0) return d
  }
  return a.length - b.length
}

/** `VersionComparer.CompareRelease`. */
function compareLabel(a: string, b: string): number {
  const x = labelNumber(a)
  const y = labelNumber(b)
  if (x !== undefined && y !== undefined) return x - y
  if (x !== undefined) return -1
  if (y !== undefined) return 1
  return compareIgnoreCase(a, b)
}

/** `VersionComparer.Default.Compare`. */
function compare(a: string, b: string): number {
  const x = parseOrThrow(a)
  const y = parseOrThrow(b)
  for (let i = 0; i < 4; i++) {
    const d = (x.numbers[i] as number) - (y.numbers[i] as number)
    if (d !== 0) return d
  }
  if (!x.labels || !y.labels) return (x.labels ? -1 : 0) + (y.labels ? 1 : 0)
  for (let i = 0; i < Math.max(x.labels.length, y.labels.length); i++) {
    const l = x.labels[i]
    const r = y.labels[i]
    if (l === undefined) return -1
    if (r === undefined) return 1
    const d = compareLabel(l, r)
    if (d !== 0) return d
  }
  return 0
}

function syntaxError(range: string, detail: string): VersError {
  return new VersError('INVALID_SYNTAX', `invalid nuget range ${JSON.stringify(range)}: ${detail}`)
}

/** A bound of a range: unbounded if empty or whitespace, else a version, trimmed. */
function bound(text: string): string | undefined {
  const version = dotnetTrim(text)
  if (version === '') return undefined
  parseOrThrow(version)
  return version
}

/** Converts a range as `VersionRangeFactory.TryParse` reads it. */
function fromNative(range: string): Constraint[] {
  const value = dotnetTrim(range)
  if (value === '') throw syntaxError(range, 'empty range')
  const bracketed = value.startsWith('[') || value.startsWith('(')
  const last = value[value.length - 1]
  if (bracketed && last !== ']' && last !== ')') {
    throw syntaxError(range, 'a range must end with ] or )')
  }
  if (value.includes('*')) {
    throw syntaxError(range, 'floating versions such as 1.* are not supported')
  }
  let lower: string | undefined
  let upper: string | undefined
  let loInclusive = true
  let hiInclusive = false
  if (bracketed) {
    loInclusive = value.startsWith('[')
    hiInclusive = last === ']'
    const parts = value.slice(1, -1).split(',')
    if (parts.length > 2) throw syntaxError(range, 'a range has at most two versions')
    if (parts.every((p) => p === '')) throw syntaxError(range, 'a range needs a version')
    if (parts.length === 1 && !(loInclusive && hiInclusive)) {
      throw syntaxError(range, `a single version must be in [], not ${JSON.stringify(value)}`)
    }
    lower = bound(parts[0] as string)
    upper = bound(parts[parts.length - 1] as string)
  } else {
    lower = bound(value)
  }
  if (lower !== undefined && upper !== undefined) {
    const c = compare(lower, upper)
    if (c > 0) throw syntaxError(range, 'the lower bound is above the upper bound')
    if (c === 0 && loInclusive !== hiInclusive) {
      throw syntaxError(range, 'equal bounds need [] on both sides')
    }
  }
  const set = intersect(
    [
      lower === undefined ? ALL : comparatorSet(loInclusive ? '>=' : '>', lower),
      upper === undefined ? ALL : comparatorSet(hiInclusive ? '<=' : '<', upper),
    ],
    compare,
  )
  return toConstraints(set, compare)
}

export const nuget: Scheme = {
  type: 'nuget',
  isValid: (version) => parse(version) !== undefined,
  compare,
  fromNative,
}

/**
 * `maven`: Maven artifact versions, ordered as by Maven's `ComparableVersion`.
 *
 * Reference: the POM version order specification
 * (https://maven.apache.org/pom.html#version-order-specification) and `ComparableVersion.java` in
 * maven-artifact 4.0.0-rc-7 (https://github.com/apache/maven/blob/6d8f301b38af7399b36b862969d520974944f0b9/compat/maven-artifact/src/main/java/org/apache/maven/artifact/versioning/ComparableVersion.java,
 * Apache-2.0), which this file mirrors item by item. Tested against that version as an oracle
 * (testdata/oracle). Maven 3.9 orders some unusual versions differently (`1.0-1` equals `1-1` in
 * 3.9 but is greater in 4.0): Maven 4 reads a qualifier followed by a number as one item (MNG-7714)
 * and removed cycles from the order (MNG-6568).
 *
 * A version is split at `.`, `-` and transitions between digits and letters into numbers and
 * qualifiers; a `-` or a qualifier starts a nested list. Known qualifiers sort
 * `alpha < beta < milestone < rc = cr < snapshot < "" = ga = final = release < sp`, then unknown ones
 * lexically, ignoring case. Trailing zeros and release qualifiers compare as if absent
 * (`1.0 == 1-ga == 1`). Maven accepts any string; a valid version here is printable ASCII without
 * spaces, at most 256 characters (the limit `ComparableVersion` enforces).
 *
 * Native ranges are Maven's bracket notation (`[1.0,2.0)`, `(,1.0],[1.2,)`, `[1.0]`), parsed as by
 * `VersionRange.createFromVersionSpec`, except that surrounding whitespace is trimmed and a bound
 * containing `[`, `]`, `(`, `)` or `,` is rejected. Maven reads a bare version such as `1.0` as a
 * soft requirement that any version satisfies; here it means `>=1.0`, as in the enforcer plugin's
 * range documentation that the VERS types list links to. Dependency resolution in Maven uses
 * maven-resolver's `GenericVersionScheme`, which orders a few versions differently; that is out of
 * scope.
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
import type { Constraint } from '../vers.ts'
import type { Scheme } from './types.ts'
import { compareDigits, invalidVersion } from './util.ts'

interface NumItem {
  readonly kind: 'num'
  /** Decimal digits without leading zeros. */
  readonly digits: string
}

interface StrItem {
  readonly kind: 'str'
  readonly value: string
}

/** A qualifier directly followed by a number, such as `rc1` or `alpha-1`. */
interface ComboItem {
  readonly kind: 'combo'
  readonly str: StrItem
  readonly num: NumItem
}

interface ListItem {
  readonly kind: 'list'
  readonly items: Item[]
}

type Item = NumItem | StrItem | ComboItem | ListItem

const MAX_LENGTH = 256
const QUALIFIERS = ['alpha', 'beta', 'milestone', 'rc', 'snapshot', '', 'sp']
const RELEASE_KEY = String(QUALIFIERS.indexOf(''))
const SHORT: Readonly<Record<string, string>> = { a: 'alpha', b: 'beta', m: 'milestone' }

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9'
}

function num(digits: string): NumItem {
  return { kind: 'num', digits: digits.replace(/^0+(?=.)/, '') }
}

// `a1`, `b1` and `m1` mean alpha-1, beta-1 and milestone-1, so the short forms count only before a number.
function str(value: string, followedByDigit: boolean): StrItem {
  const long = followedByDigit ? (SHORT[value] ?? value) : value
  return { kind: 'str', value: long === 'cr' ? 'rc' : long }
}

function combo(value: string): ComboItem {
  const i = value.search(/\d/)
  const at = i === -1 ? 0 : i
  return { kind: 'combo', str: str(value.slice(0, at), true), num: num(value.slice(at)) }
}

function parseItem(isCombination: boolean, digits: boolean, buf: string): Item {
  if (isCombination) return combo(buf.replaceAll('-', ''))
  return digits ? num(buf) : str(buf, false)
}

function isNull(item: Item): boolean {
  switch (item.kind) {
    case 'num':
      return item.digits === '0'
    case 'str':
      return item.value === ''
    case 'combo':
      return false
    case 'list':
      return item.items.length === 0
  }
}

// Drops trailing zeros and release qualifiers, and zeros before a qualifier (`1.0-rc` is `1-rc`).
function normalize(list: ListItem): void {
  const { items } = list
  for (let i = items.length - 1; i >= 0; i--) {
    if (!isNull(items[i] as Item)) continue
    const next = items[i + 1]
    if (next === undefined || next.kind === 'str') {
      items.splice(i, 1)
    } else if (next.kind === 'list') {
      const first = next.items[0]
      if (first?.kind === 'combo' || first?.kind === 'str') items.splice(i, 1)
    }
  }
  const only = items[0]
  if (items.length === 1 && only?.kind === 'list') items.splice(0, 1, ...only.items)
}

/** Parses a version as `ComparableVersion.parseVersion` does. */
function parse(version: string): ListItem | undefined {
  if (version === '' || version.length > MAX_LENGTH || /[^\x21-\x7e]/.test(version))
    return undefined
  const v = version.toLowerCase()
  const root: ListItem = { kind: 'list', items: [] }
  const stack = [root]
  let list = root
  let digits = false
  let isCombination = false
  let start = 0
  const open = (): void => {
    const sub: ListItem = { kind: 'list', items: [] }
    list.items.push(sub)
    list = sub
    stack.push(sub)
  }

  for (let i = 0; i < v.length; i++) {
    const c = v[i]
    if (c === '.') {
      list.items.push(i === start ? num('0') : parseItem(isCombination, digits, v.slice(start, i)))
      isCombination = false
      start = i + 1
    } else if (c === '-') {
      if (i === start) {
        list.items.push(num('0'))
      } else {
        // X-1 is read as X1.
        if (!digits && isDigit(v[i + 1])) {
          isCombination = true
          continue
        }
        list.items.push(parseItem(isCombination, digits, v.slice(start, i)))
      }
      start = i + 1
      if (list.items.length > 0) open()
      isCombination = false
    } else if (isDigit(c)) {
      if (!digits && i > start) {
        isCombination = true
        if (list.items.length > 0) open()
      }
      digits = true
    } else {
      if (digits && i > start) {
        list.items.push(parseItem(isCombination, true, v.slice(start, i)))
        start = i
        open()
        isCombination = false
      }
      digits = false
    }
  }
  if (v.length > start) {
    // A qualifier after a `.` is read as one after a `-`: 1.0.0.X1 < 1.0.0-X2.
    if (!digits && list.items.length > 0) open()
    list.items.push(parseItem(isCombination, digits, v.slice(start)))
  }
  for (let l = stack.pop(); l; l = stack.pop()) normalize(l)
  return root
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// Known qualifiers sort by position, release qualifiers as none, and unknown ones after all of them.
function qualifierKey(q: string): string {
  if (q === 'ga' || q === 'final' || q === 'release') return RELEASE_KEY
  const i = QUALIFIERS.indexOf(q)
  return i === -1 ? `${QUALIFIERS.length}-${q}` : String(i)
}

// Each function compares an item with another item, or with a missing one (`undefined`), following
// the compareTo method of the matching ComparableVersion item class.

function compareNum(a: NumItem, b: Item | undefined): number {
  if (b === undefined) return isNull(a) ? 0 : 1
  return b.kind === 'num' ? compareDigits(a.digits, b.digits) : 1
}

function compareStr(a: StrItem, b: Item | undefined): number {
  if (b === undefined) return compareStrings(qualifierKey(a.value), RELEASE_KEY)
  switch (b.kind) {
    case 'num':
      return -1
    case 'str':
      return compareStrings(qualifierKey(a.value), qualifierKey(b.value))
    case 'combo': {
      const r = compareStr(a, b.str)
      if (r !== 0) return r
      return compareStr(a, undefined) === 0 ? -compareNum(b.num, undefined) : -1
    }
    case 'list':
      return -compareList(b, a)
  }
}

function compareCombo(a: ComboItem, b: Item | undefined): number {
  if (b === undefined) return compareStr(a.str, undefined) || compareNum(a.num, undefined)
  switch (b.kind) {
    case 'num':
      return -1
    case 'str': {
      const r = compareStr(a.str, b)
      if (r !== 0) return r
      // X1 > X
      return compareStr(a.str, undefined) === 0 ? compareNum(a.num, undefined) : 1
    }
    case 'combo':
      return compareStr(a.str, b.str) || compareNum(a.num, b.num)
    case 'list':
      return -compareList(b, a)
  }
}

function compareList(a: ListItem, b: Item | undefined): number {
  const { items } = a
  if (b === undefined) {
    for (const item of items) {
      const r = compareItem(item, undefined)
      if (r !== 0) return r
    }
    return 0
  }
  switch (b.kind) {
    case 'num':
      return -1
    case 'str':
    case 'combo': {
      const [first, ...others] = items
      let r = first === undefined ? -compareItem(b, undefined) : compareItem(first, b)
      for (const item of others) {
        if (r !== 0) break
        r = compareItem(item, undefined)
      }
      return r
    }
    case 'list':
      for (let i = 0; i < Math.max(items.length, b.items.length); i++) {
        const l = items[i]
        const r = b.items[i]
        const c =
          l === undefined ? (r === undefined ? 0 : -compareItem(r, undefined)) : compareItem(l, r)
        if (c !== 0) return c
      }
      return 0
  }
}

function compareItem(a: Item, b: Item | undefined): number {
  switch (a.kind) {
    case 'num':
      return compareNum(a, b)
    case 'str':
      return compareStr(a, b)
    case 'combo':
      return compareCombo(a, b)
    case 'list':
      return compareList(a, b)
  }
}

function parseOrThrow(version: string): ListItem {
  const v = parse(version)
  if (!v) throw invalidVersion('maven', version)
  return v
}

function compare(a: string, b: string): number {
  // `|| 0` turns a negated zero into 0.
  return compareList(parseOrThrow(a), parseOrThrow(b)) || 0
}

function syntaxError(range: string, detail: string): VersError {
  return new VersError('INVALID_SYNTAX', `invalid maven range ${JSON.stringify(range)}: ${detail}`)
}

// A version inside a range. Maven would read `[1,2,3]` as the range from 1 to the version `2,3`;
// a bound containing range punctuation is rejected instead.
function bound(text: string, range: string): string {
  if (/[[\](),]/.test(text)) throw syntaxError(range, `unexpected ${JSON.stringify(text)}`)
  if (!parse(text)) throw invalidVersion('maven', text)
  return text
}

/** One bracketed restriction, as `VersionRange.parseRestriction` reads it. */
function restriction(
  spec: string,
  range: string,
): { set: VersionSet; lower?: string; upper?: string } {
  const loInclusive = spec.startsWith('[')
  const hiInclusive = spec.endsWith(']')
  const inner = spec.slice(1, -1).trim()
  const comma = inner.indexOf(',')
  if (comma === -1) {
    if (!loInclusive || !hiInclusive) {
      throw syntaxError(range, `a single version must be in [], not ${JSON.stringify(spec)}`)
    }
    const version = bound(inner, range)
    return { set: comparatorSet('=', version), lower: version, upper: version }
  }
  const lo = inner.slice(0, comma).trim()
  const hi = inner.slice(comma + 1).trim()
  const lower = lo === '' ? undefined : bound(lo, range)
  const upper = hi === '' ? undefined : bound(hi, range)
  if (lower !== undefined && upper !== undefined) {
    const c = compare(upper, lower)
    if (c < 0 || (c === 0 && !(loInclusive && hiInclusive))) {
      throw syntaxError(range, `${JSON.stringify(spec)} is empty`)
    }
  }
  const set = intersect(
    [
      lower === undefined ? ALL : comparatorSet(loInclusive ? '>=' : '>', lower),
      upper === undefined ? ALL : comparatorSet(hiInclusive ? '<=' : '<', upper),
    ],
    compare,
  )
  return { set, ...(lower !== undefined && { lower }), ...(upper !== undefined && { upper }) }
}

/** Converts a range as `VersionRange.createFromVersionSpec` reads it. */
function fromNative(range: string): Constraint[] {
  let rest = range.trim()
  if (rest === '') throw syntaxError(range, 'empty range')
  if (!rest.startsWith('[') && !rest.startsWith('(')) {
    return toConstraints(comparatorSet('>=', bound(rest, range)), compare)
  }
  const sets: VersionSet[] = []
  let previousUpper: string | undefined
  while (rest.startsWith('[') || rest.startsWith('(')) {
    const close = rest.search(/[)\]]/)
    if (close === -1) throw syntaxError(range, 'unclosed bracket')
    const r = restriction(rest.slice(0, close + 1), range)
    // Like Maven, a restriction must start after the previous one ends, unless that one is unbounded.
    if (
      previousUpper !== undefined &&
      (r.lower === undefined || compare(r.lower, previousUpper) < 0)
    ) {
      throw syntaxError(range, 'restrictions overlap or are out of order')
    }
    sets.push(r.set)
    previousUpper = r.upper
    rest = rest.slice(close + 1).trim()
    if (rest.startsWith(',')) rest = rest.slice(1).trim()
  }
  if (rest !== '')
    throw syntaxError(range, `unexpected ${JSON.stringify(rest)} after a restriction`)
  return toConstraints(union(sets, compare), compare)
}

export const maven: Scheme = {
  type: 'maven',
  isValid: (version) => parse(version) !== undefined,
  compare,
  fromNative,
}

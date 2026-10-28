/**
 * `composer`: Composer (Packagist) versions and constraints.
 *
 * Reference: https://getcomposer.org/doc/articles/versions.md and composer/semver
 * (https://github.com/composer/semver, MIT) `src/VersionParser.php` and `src/Constraint/Constraint.php`,
 * which compares versions with PHP's `version_compare` (`ext/standard/versioning.c` in
 * https://github.com/php/php-src). This file mirrors composer/semver 3.5.2 on PHP 8.5.12 and is tested
 * against them as an oracle (testdata/oracle).
 *
 * A version is valid if `VersionParser::normalize` accepts it, except that `dev-` branches
 * (`dev-main`, `dev-feature/x`, and `master`, `trunk` and `default`, which Composer reads as `dev-`
 * branches) are rejected, because Composer gives them no order: a branch only equals itself. Versions
 * with whitespace, which Composer trims or reads as an alias (`1.0 as 2.0`), are also rejected.
 * Normalization pads a version to four numbers (`1.2` is `1.2.0.0`), drops a leading `v`, build
 * metadata (`+build`) and a stability flag (`@dev`), spells out stabilities (`1.0b2` is
 * `1.0.0.0-beta2`), and turns branch aliases into numbers (`1.x-dev` is
 * `1.9999999.9999999.9999999-dev`). Date versions such as `20100102` and `2010-01-02` keep their
 * shape. Two versions are compared as `version_compare` compares their normalized forms:
 * `dev < alpha < beta < RC < (release) < patch`, numbers compared as C `long`s, so numbers above
 * 2^63 - 1 are all equal.
 *
 * Native ranges are Composer constraints, converted as `VersionParser::parseConstraints` reads them:
 * `^`, `~`, wildcards, hyphen ranges, comparisons, `,` or space for AND and `||` or `|` for OR. The
 * VERS bounds are the versions Composer compares against, including its `-dev` bounds (`^1.2` is
 * `>=1.2.0.0-dev|<2.0.0.0-dev`). Constraints on `dev-` branches cannot be expressed and throw. Unlike
 * Composer, a line break inside a constraint is rejected (Composer ignores the text after it).
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
import type { Scheme } from './types.ts'
import { compareDigits, invalidVersion } from './util.ts'

// PHP's trim() strips these; PCRE's `\s` (without UTF mode) is ASCII-only and includes \f, not \0.
const PHP_TRIM = ' \t\n\r\0\v'
const S = '[ \\t\\n\\v\\f\\r]'
const NOT_S = '[^ \\t\\n\\v\\f\\r]'
const NOT_COMMA_S = '[^, \\t\\n\\v\\f\\r]'

function phpTrim(s: string): string {
  let i = 0
  let j = s.length
  while (i < j && PHP_TRIM.includes(s[i] as string)) i++
  while (j > i && PHP_TRIM.includes(s[j - 1] as string)) j--
  return s.slice(i, j)
}

// VersionParser::$modifierRegex. Its possessive `((?:[.-]?\d+)*+)` is written `((?:[.-]?\d)*)`,
// which matches the same strings without the exponential backtracking that the nested quantifier
// causes in V8. Nothing after the group can take a digit back, so the captured text is the same.
const MODIFIER = '[._-]?(?:(stable|beta|b|RC|alpha|a|patch|pl|p)((?:[.-]?\\d)*))?([.-]?dev)?'
const STABILITIES = 'stable|RC|beta|alpha|dev'

const ALIAS = new RegExp(`^(${NOT_COMMA_S}+) +as +(${NOT_COMMA_S}+)$`)
const FLAG = new RegExp(`@(?:${STABILITIES})$`, 'i')
const BUILD = new RegExp(`^([^,+ \\t\\n\\v\\f\\r]+)\\+${NOT_S}+$`)
const CLASSICAL = new RegExp(`^v?(\\d{1,5})(\\.\\d+)?(\\.\\d+)?(\\.\\d+)?${MODIFIER}$`, 'i')
const DATE = new RegExp(`^v?(\\d{4}(?:[.:-]?\\d{2}){1,6}(?:[.:-]?\\d{1,3}){0,2})${MODIFIER}$`, 'i')
// PCRE's `.` matches anything but \n.
const DEV_SUFFIX = /^([^\n]*?)[.-]?dev$/i
const BRANCH = /^v?(\d+)(\.(?:\d+|[xX*]))?(\.(?:\d+|[xX*]))?(\.(?:\d+|[xX*]))?$/i

function expandStability(stability: string): string {
  const s = stability.toLowerCase()
  if (s === 'a') return 'alpha'
  if (s === 'b') return 'beta'
  if (s === 'p' || s === 'pl') return 'patch'
  if (s === 'rc') return 'RC'
  return s
}

/** `VersionParser::normalizeBranch`. */
function normalizeBranch(name: string): string {
  const m = BRANCH.exec(phpTrim(name))
  if (!m) return `dev-${phpTrim(name)}`
  const parts = [1, 2, 3, 4].map((i) => m[i]?.replace(/[*X]/g, 'x') ?? '.x')
  return `${parts.join('').replaceAll('x', '9999999')}-dev`
}

/**
 * `VersionParser::normalize`: the normalized version, a `dev-` branch name, or `undefined` where
 * Composer throws.
 */
export function normalize(input: string): string | undefined {
  let version = phpTrim(input)
  const alias = ALIAS.exec(version)
  if (alias) version = alias[1] as string
  const flag = FLAG.exec(version)
  if (flag) version = version.slice(0, flag.index)
  if (version === 'master' || version === 'trunk' || version === 'default')
    version = `dev-${version}`
  if (version.slice(0, 4).toLowerCase() === 'dev-') return `dev-${version.slice(4)}`
  const build = BUILD.exec(version)
  if (build) version = build[1] as string

  let m = CLASSICAL.exec(version)
  let index = 5
  if (m) {
    version = (m[1] as string) + (m[2] || '.0') + (m[3] || '.0') + (m[4] || '.0')
  } else {
    m = DATE.exec(version)
    index = 2
    if (m) version = (m[1] as string).replace(/\D/g, '.')
  }
  if (m) {
    const stability = m[index]
    if (stability) {
      if (stability === 'stable') return version
      version += `-${expandStability(stability)}${(m[index + 1] ?? '').replace(/^[.-]+/, '')}`
    }
    if (m[index + 2]) version += '-dev'
    return version
  }

  const dev = DEV_SUFFIX.exec(version)
  if (dev) {
    const normalized = normalizeBranch(dev[1] as string)
    if (!normalized.includes('dev-')) return normalized
  }
  return undefined
}

// The order of the special forms in PHP's compare_special_version_forms, matched as prefixes; any
// other word is -1, and a number counts as `#`.
const SPECIAL_FORMS: readonly (readonly [string, number])[] = [
  ['dev', 0],
  ['alpha', 1],
  ['a', 1],
  ['beta', 2],
  ['b', 2],
  ['RC', 3],
  ['rc', 3],
  ['#', 4],
  ['pl', 5],
  ['p', 5],
]

function specialForm(form: string): number {
  for (const [name, order] of SPECIAL_FORMS) if (form.startsWith(name)) return order
  return -1
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9'
const isAlnum = (c: string): boolean => /^[0-9A-Za-z]$/.test(c)

/** php_canonicalize_version: `-`, `_`, `+` and other non-alphanumerics become `.`, and a `.` goes
 * between a digit and a non-digit. */
function canonicalize(version: string): string {
  if (version === '') return ''
  const out = [version[0] as string]
  let lp = out[0] as string
  for (const c of version.slice(1)) {
    const sep = out[out.length - 1] === '.' ? [] : ['.']
    if (c === '-' || c === '_' || c === '+') out.push(...sep)
    else if (lp !== '.' && c !== '.' && isDigit(lp) !== isDigit(c)) out.push(...sep, c)
    else if (!isAlnum(c)) out.push(...sep)
    else out.push(c)
    lp = c
  }
  if (out[out.length - 1] === '.') out.pop()
  return out.join('')
}

const LONG_MAX = '9223372036854775807'

/** C `strtol` on a run of digits: the value, saturated at LONG_MAX on 64-bit platforms. */
function strtol(digits: string): string {
  const run = (/^\d*/.exec(digits) as RegExpExecArray)[0].replace(/^0+(?=\d)/, '')
  return compareDigits(run, LONG_MAX) > 0 ? LONG_MAX : run
}

/** php_version_compare, which PHP's `version_compare` and Composer's Comparator use. */
function phpVersionCompare(orig1: string, orig2: string): number {
  if (orig1 === '' || orig2 === '') return orig1 === orig2 ? 0 : orig1 === '' ? -1 : 1
  const v1 = orig1[0] === '#' ? orig1 : canonicalize(orig1)
  const v2 = orig2[0] === '#' ? orig2 : canonicalize(orig2)
  let p1 = 0
  let p2 = 0
  // Where the current part ends, or -1 after the last part (C's `strchr` returning NULL).
  let n1 = 0
  let n2 = 0
  let compare = 0
  while (p1 < v1.length && p2 < v2.length && n1 !== -1 && n2 !== -1) {
    n1 = v1.indexOf('.', p1)
    n2 = v2.indexOf('.', p2)
    const a = v1.slice(p1, n1 === -1 ? undefined : n1)
    const b = v2.slice(p2, n2 === -1 ? undefined : n2)
    if (isDigit(a[0]) && isDigit(b[0])) compare = Math.sign(compareDigits(strtol(a), strtol(b)))
    else if (!isDigit(a[0]) && !isDigit(b[0])) compare = Math.sign(specialForm(a) - specialForm(b))
    else if (isDigit(a[0])) compare = Math.sign(specialForm('#N#') - specialForm(b))
    else compare = Math.sign(specialForm(a) - specialForm('#N#'))
    if (compare !== 0) break
    if (n1 !== -1) p1 = n1 + 1
    if (n2 !== -1) p2 = n2 + 1
  }
  if (compare === 0) {
    if (n1 !== -1) compare = isDigit(v1[p1]) ? 1 : phpVersionCompare(v1.slice(p1), '#N#')
    else if (n2 !== -1) compare = isDigit(v2[p2]) ? -1 : phpVersionCompare('#N#', v2.slice(p2))
  }
  return compare
}

// Characters PHP trims, and the rest of PCRE's `\s`: a version containing one is not accepted.
const WHITESPACE = /[ \t\n\r\0\v\f]/

function normalized(version: string): string {
  const n = WHITESPACE.test(version) ? undefined : normalize(version)
  if (n === undefined || n.startsWith('dev-')) throw invalidVersion('composer', version)
  return n
}

function isValid(version: string): boolean {
  if (WHITESPACE.test(version)) return false
  const n = normalize(version)
  return n !== undefined && !n.startsWith('dev-')
}

/** `Comparator::compare` on the normalized versions, as `Semver::sort` and constraints use it. */
function compare(a: string, b: string): number {
  return phpVersionCompare(normalized(a), normalized(b))
}

// --- Constraints (VersionParser::parseConstraints) ---

function syntaxError(range: string, detail: string): VersError {
  return new VersError(
    'INVALID_SYNTAX',
    `invalid composer constraint ${JSON.stringify(range)}: ${detail}`,
  )
}

type Op = '==' | '!=' | '<' | '<=' | '>' | '>='

/** A Composer `Constraint` (an operator and a normalized version), or `MatchAllConstraint`. */
type Atom = { readonly op: Op; readonly version: string } | 'all'

const OPS: Readonly<Record<string, Op>> = {
  '=': '==',
  '==': '==',
  '<>': '!=',
  '!=': '!=',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
}

// The constraint regexes of parseConstraint, with PCRE's `\s` and `.` spelled out and the modifier
// regex as above. VERSION has 8 groups: 4 numbers, the stability, its number, `dev`, and `x-dev`.
const CONSTRAINT_FLAG = new RegExp(`^(${NOT_COMMA_S}*?)@(${STABILITIES})$`, 'i')
const REF = /^(dev-[^,@ \t\n\v\f\r]+?|[^,@ \t\n\v\f\r]+?\.x-dev)#[^\n]+$/i
const WILDCARD = /^(v)?[xX*](\.[xX*])*$/i
const VERSION = `v?(\\d+)(?:\\.(\\d+))?(?:\\.(\\d+))?(?:\\.(\\d+))?(?:${MODIFIER}|\\.([xX*][.-]?dev))(?:\\+${NOT_S}+)?`
const TILDE = new RegExp(`^~>?${VERSION}$`, 'i')
const CARET = new RegExp(`^\\^${VERSION}($)`, 'i')
const X_RANGE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.[xX*])+$/
const HYPHEN = new RegExp(`^(${VERSION}) +- +(${VERSION})($)`, 'i')
const BASIC = new RegExp(`^(<>|!=|>=?|<=?|==?)?${S}*([^\\n]*)`)
const HAS_MODIFIER = new RegExp(`-${MODIFIER}$`, 'i')
const MODIFIER_AT_END = new RegExp(`${MODIFIER}(?:\\+[^\\n]*)?$`, 'i')

/** `VersionParser::parseStability`. */
function parseStability(version: string): string {
  const v = version.replace(/#[^\n]+$/, '')
  if (v.startsWith('dev-') || v.endsWith('-dev')) return 'dev'
  const m = MODIFIER_AT_END.exec(v.toLowerCase()) as RegExpExecArray
  if (m[3]) return 'dev'
  if (m[1] === 'beta' || m[1] === 'b') return 'beta'
  if (m[1] === 'alpha' || m[1] === 'a') return 'alpha'
  if (m[1] === 'rc') return 'RC'
  return 'stable'
}

const present = (s: string | undefined): s is string => s !== undefined && s !== ''

/**
 * `manipulateVersionString` with a non-negative increment: the parts after `position` become 0 and
 * the part at `position` is incremented. PHP would turn a sum above PHP_INT_MAX into a float.
 */
function manipulate(
  parts: readonly (string | undefined)[],
  position: number,
  increment: number,
  range: string,
): string {
  const out: string[] = []
  for (let i = 1; i <= 4; i++) {
    if (i > position) out.push('0')
    else if (i === position && increment) {
      const n = BigInt(parts[i] || '0') + BigInt(increment)
      if (n > BigInt(LONG_MAX)) throw syntaxError(range, `${parts[i]} is too large`)
      out.push(String(n))
    } else out.push(parts[i] ?? '')
  }
  return out.join('.')
}

function normalizeOrThrow(version: string, range: string): string {
  const n = normalize(version)
  if (n === undefined) throw syntaxError(range, `invalid version ${JSON.stringify(version)}`)
  return n
}

/** `VersionParser::parseConstraint` for one AND part. */
function parseConstraint(text: string, range: string): Atom[] {
  let constraint = text
  if (constraint.includes('\n')) throw syntaxError(range, 'a constraint contains a line break')
  const alias = ALIAS.exec(constraint)
  if (alias) constraint = alias[1] as string

  let stabilityModifier: string | undefined
  const flag = CONSTRAINT_FLAG.exec(constraint)
  if (flag) {
    constraint = flag[1] || '*'
    if (flag[2] !== 'stable') stabilityModifier = flag[2]
  }
  const ref = REF.exec(constraint)
  if (ref) constraint = ref[1] as string

  const wildcard = WILDCARD.exec(constraint)
  if (wildcard) return wildcard[1] || wildcard[2] ? [{ op: '>=', version: '0.0.0.0-dev' }] : ['all']

  let m = TILDE.exec(constraint)
  if (m) {
    if (constraint.startsWith('~>')) throw syntaxError(range, 'invalid operator "~>"')
    let position = present(m[4]) ? 4 : present(m[3]) ? 3 : present(m[2]) ? 2 : 1
    if (m[8]) position++
    const suffix = !m[5] && !m[7] && !m[8] ? '-dev' : ''
    return [
      { op: '>=', version: normalizeOrThrow((constraint + suffix).slice(1), range) },
      { op: '<', version: `${manipulate(m, Math.max(1, position - 1), 1, range)}-dev` },
    ]
  }

  m = CARET.exec(constraint)
  if (m) {
    const position = m[1] !== '0' || !present(m[2]) ? 1 : m[2] !== '0' || !present(m[3]) ? 2 : 3
    const suffix = !m[5] && !m[7] && !m[8] ? '-dev' : ''
    return [
      { op: '>=', version: normalizeOrThrow((constraint + suffix).slice(1), range) },
      { op: '<', version: `${manipulate(m, position, 1, range)}-dev` },
    ]
  }

  m = X_RANGE.exec(constraint)
  if (m) {
    const position = present(m[3]) ? 3 : present(m[2]) ? 2 : 1
    const low = `${manipulate(m, position, 0, range)}-dev`
    const high = `${manipulate(m, position, 1, range)}-dev`
    if (low === '0.0.0.0-dev') return [{ op: '<', version: high }]
    return [
      { op: '>=', version: low },
      { op: '<', version: high },
    ]
  }

  m = HYPHEN.exec(constraint)
  if (m) {
    // Groups 1 and 10 are the two versions; 2-9 and 11-18 are their VERSION groups.
    const lowSuffix = !m[6] && !m[8] && !m[9] ? '-dev' : ''
    const low = normalizeOrThrow(m[1] as string, range) + lowSuffix
    // PHP's empty(), except that '0' counts as present.
    const empty = (x: string | undefined): boolean => x !== '0' && !x
    if ((!empty(m[12]) && !empty(m[13])) || m[15] || m[17] || m[18]) {
      return [
        { op: '>=', version: low },
        { op: '<=', version: normalizeOrThrow(m[10] as string, range) },
      ]
    }
    normalizeOrThrow(m[10] as string, range)
    const high = manipulate(['', m[11], m[12], m[13], m[14]], empty(m[12]) ? 1 : 2, 1, range)
    return [
      { op: '>=', version: low },
      { op: '<', version: `${high}-dev` },
    ]
  }

  m = BASIC.exec(constraint) as RegExpExecArray
  const text2 = m[2] as string
  let version = normalize(text2)
  if (version === undefined) {
    // Composer reads `foo-dev` as the branch `dev-foo`.
    if (!(text2.endsWith('-dev') && /^[0-9a-zA-Z\-./]+$/.test(text2))) {
      throw syntaxError(range, `cannot parse ${JSON.stringify(text)}`)
    }
    version = `dev-${text2.slice(0, -4)}`
  }
  const op = m[1] || '='
  if (version.startsWith('dev-')) {
    throw syntaxError(
      range,
      `the branch ${version} has no order, so it cannot be expressed in VERS`,
    )
  }
  if (op !== '==' && op !== '=' && stabilityModifier && parseStability(version) === 'stable') {
    version += `-${stabilityModifier}`
  } else if ((op === '<' || op === '>=') && !HAS_MODIFIER.test(text2)) {
    version += '-dev'
  }
  return [{ op: OPS[op] as Op, version }]
}

/** `VersionParser::parseConstraints` splits on `\s*\|\|?\s*`; written as a loop to stay linear. */
function splitOr(s: string): string[] {
  const isSpace = (c: string | undefined): boolean => c !== undefined && ' \t\n\v\f\r'.includes(c)
  const parts: string[] = []
  let start = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '|') continue
    let a = i
    while (a > start && isSpace(s[a - 1])) a--
    let b = s[i + 1] === '|' ? i + 2 : i + 1
    while (isSpace(s[b])) b++
    parts.push(s.slice(start, a))
    start = b
    i = b - 1
  }
  parts.push(s.slice(start))
  return parts
}

/**
 * Splits an OR part into AND parts as `preg_split('{(?<!^|as|[=>< ,]) *(?<!-)[, ](?!-) *(?!,|as|$)}')`
 * does, with the same backtracking order, as a loop: V8 would retry the space runs from every
 * position.
 */
function splitAnd(s: string): string[] {
  // spaceEnd[i]: the end of the run of spaces starting at i.
  const spaceEnd: number[] = new Array(s.length + 1)
  spaceEnd[s.length] = s.length
  for (let i = s.length - 1; i >= 0; i--)
    spaceEnd[i] = s[i] === ' ' ? (spaceEnd[i + 1] as number) : i
  const after = (t: number): boolean => t < s.length && s[t] !== ',' && !s.startsWith('as', t)

  // The end of a match starting at q, or -1.
  const matchAt = (q: number): number => {
    if (q === 0 || s.slice(q - 2, q) === 'as' || '=>< ,'.includes(s[q - 1] as string)) return -1
    for (let r = spaceEnd[q] as number; r >= q; r--) {
      if (s[r - 1] === '-' || (s[r] !== ',' && s[r] !== ' ') || s[r + 1] === '-') continue
      for (let t = spaceEnd[r + 1] as number; t >= r + 1; t--) if (after(t)) return t
    }
    return -1
  }

  const parts: string[] = []
  let start = 0
  for (let q = 0; q < s.length; q++) {
    const end = matchAt(q)
    if (end === -1) continue
    parts.push(s.slice(start, q))
    start = end
    q = end - 1
  }
  parts.push(s.slice(start))
  return parts
}

/** MultiConstraint::create's merge of `[>= a < b] || [>= b < c]` into `[>= a < c]`. */
function mergeContiguous(groups: Atom[][]): Atom[][] {
  const mergeable = (left: Atom[], right: Atom[]): boolean => {
    const [l0, l1] = left
    const [r0, r1] = right
    return (
      left.length === 2 &&
      right.length === 2 &&
      typeof l0 === 'object' &&
      l0.op === '>=' &&
      typeof l1 === 'object' &&
      l1.op === '<' &&
      typeof r0 === 'object' &&
      r0.op === '>=' &&
      typeof r1 === 'object' &&
      (r1.op === '<' || r1.op === '<=') &&
      l1.version === r0.version
    )
  }
  if (groups.length < 2) return groups
  const merged: Atom[][] = []
  let left = groups[0] as Atom[]
  let optimized = false
  for (const right of groups.slice(1)) {
    if (mergeable(left, right)) {
      optimized = true
      left = [left[0] as Atom, right[1] as Atom]
    } else {
      merged.push(left)
      left = right
    }
  }
  merged.push(left)
  return optimized ? merged : groups
}

/**
 * The VERS version for a version Composer compares against. Composer compares the raw string, which
 * is not always the normalized form of itself: a stability flag keeps its case (`>=1.0@BETA` gives
 * `1.0.0.0-BETA`, which PHP orders as an unknown word, below `dev`), and `1.0-STABLE` normalizes to
 * `1.0.0.0-stable`, also an unknown word. Such a word is written `STABLE`, which normalizes to an
 * unknown word too. Versions that no Composer version orders like, such as `1.0.0.0-patch1-beta`,
 * throw.
 */
function bound(version: string, range: string): string {
  const candidates = [version, version.replace(/-([A-Za-z]+)((?:-dev)?)$/, '-STABLE$2')]
  for (const c of candidates) {
    const n = WHITESPACE.test(c) ? undefined : normalize(c)
    if (n !== undefined && !n.startsWith('dev-') && phpVersionCompare(n, version) === 0) return c
  }
  throw syntaxError(range, `Composer compares against ${version}, which is not a valid version`)
}

function atomSet(atom: Atom, range: string): VersionSet {
  if (atom === 'all') return ALL
  const comparator = atom.op === '==' ? '=' : atom.op
  return comparatorSet(comparator as Comparator, bound(atom.version, range))
}

function fromNative(range: string): Constraint[] {
  const groups = splitOr(phpTrim(range)).map((or) =>
    splitAnd(or).flatMap((and) => parseConstraint(and, range)),
  )
  const set = union(
    mergeContiguous(groups).map((g) =>
      intersect(
        g.map((a) => atomSet(a, range)),
        compare,
      ),
    ),
    compare,
  )
  if (set.length === 0) {
    throw new VersError(
      'INVALID_CONSTRAINTS',
      `composer constraint ${JSON.stringify(range)} matches no version`,
    )
  }
  return toConstraints(set, compare)
}

export const composer: Scheme = {
  type: 'composer',
  isValid,
  compare,
  fromNative,
}

/**
 * `pypi`: Python package versions and version specifiers (PEP 440).
 *
 * Reference: https://packaging.python.org/en/latest/specifications/version-specifiers/ and pypa/packaging
 * `src/packaging/version.py` (https://github.com/pypa/packaging, dual-licensed BSD-2-Clause or
 * Apache-2.0; Copyright (c) Donald Stufft and individual contributors). `VERSION_PATTERN` and the
 * ordering of `_cmpkey` are ported from packaging 26.3. Unlike packaging, surrounding whitespace is not
 * accepted, because a VERS version cannot contain it.
 *
 * Native specifiers (`>=1.0,<2.0`, `~=1.4.5`, `==1.*`, `!=1.3`) are joined with `,` (intersection) and
 * `||` (union, as in the vers-spec pypi examples). PEP 440's extra rules for exclusive ordered
 * comparisons (`>1.7` does not match `1.7.post1`, `<1.7` does not match `1.7a1`) and for local versions
 * cannot be expressed as VERS intervals and are not applied, as in vers-spec's own mapping. Arbitrary
 * equality (`===`) cannot be ordered and is rejected.
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

// packaging's VERSION_PATTERN without its possessive quantifiers (as packaging itself uses on older
// Pythons), compiled case-insensitively and anchored.
const VERSION =
  /^v?(?:(?:([0-9]+)!)?([0-9]+(?:\.[0-9]+)*)(?:[._-]?(alpha|a|beta|b|preview|pre|c|rc)[._-]?([0-9]+)?)?(?:-([0-9]+)|[._-]?(post|rev|r)[._-]?([0-9]+)?)?(?:[._-]?(dev)[._-]?([0-9]+)?)?)(?:\+([a-z0-9]+(?:[._-][a-z0-9]+)*))?$/i

interface Pep440 {
  readonly epoch: string
  readonly release: readonly string[]
  /** Pre-release rank (dev-only = -1, a = 0, b = 1, rc = 2, none = 3) and number. */
  readonly pre: readonly [number, string]
  readonly post?: string
  readonly dev?: string
  readonly local?: readonly string[]
}

const PRE_RANK: Readonly<Record<string, number>> = {
  a: 0,
  alpha: 0,
  b: 1,
  beta: 1,
  c: 2,
  pre: 2,
  preview: 2,
  rc: 2,
}

function parse(version: string): Pep440 | undefined {
  const m = VERSION.exec(version)
  if (!m) return undefined
  const [, epoch = '0', release = '', preL, preN, postN1, postL, postN2, devL, devN, local] = m
  const post = postN1 ?? (postL === undefined ? undefined : (postN2 ?? '0'))
  const dev = devL === undefined ? undefined : (devN ?? '0')
  let pre: [number, string] = [3, '0']
  if (preL !== undefined) pre = [PRE_RANK[preL.toLowerCase()] as number, preN ?? '0']
  else if (post === undefined && dev !== undefined) pre = [-1, '0']
  return {
    epoch,
    release: release.split('.'),
    pre,
    ...(post !== undefined && { post }),
    ...(dev !== undefined && { dev }),
    ...(local !== undefined && { local: local.toLowerCase().split(/[._-]/) }),
  }
}

function parseOrThrow(version: string): Pep440 {
  const v = parse(version)
  if (!v) throw invalidVersion('pypi', version)
  return v
}

// Release segments with trailing zeros removed, so that 1.0.0 == 1.
function trimmed(release: readonly string[]): string[] {
  const out = [...release]
  while (out.length > 0 && /^0+$/.test(out[out.length - 1] as string)) out.pop()
  return out
}

function compareSegments(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = compareDigits(a[i] as string, b[i] as string)
    if (c !== 0) return c
  }
  return a.length - b.length
}

// Local segments: strings sort before integers, integers compare numerically, strings lexically, and
// a shorter prefix sorts first. No local segment sorts before any.
function compareLocal(a: readonly string[] | undefined, b: readonly string[] | undefined): number {
  if (!a || !b) return (a ? 1 : 0) - (b ? 1 : 0)
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] as string
    const y = b[i] as string
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn !== yn) return xn ? 1 : -1
    const c = xn ? compareDigits(x, y) : x < y ? -1 : x > y ? 1 : 0
    if (c !== 0) return c
  }
  return a.length - b.length
}

function compareParsed(a: Pep440, b: Pep440): number {
  return (
    compareDigits(a.epoch, b.epoch) ||
    compareSegments(trimmed(a.release), trimmed(b.release)) ||
    a.pre[0] - b.pre[0] ||
    compareDigits(a.pre[1], b.pre[1]) ||
    // No post-release sorts before any post-release.
    Number(a.post !== undefined) - Number(b.post !== undefined) ||
    compareDigits(a.post ?? '0', b.post ?? '0') ||
    // A dev release sorts before the same version without one.
    Number(a.dev === undefined) - Number(b.dev === undefined) ||
    compareDigits(a.dev ?? '0', b.dev ?? '0') ||
    compareLocal(a.local, b.local)
  )
}

function compare(a: string, b: string): number {
  return compareParsed(parseOrThrow(a), parseOrThrow(b))
}

function syntaxError(range: string, detail: string): VersError {
  return new VersError(
    'INVALID_SYNTAX',
    `invalid pypi specifier ${JSON.stringify(range)}: ${detail}`,
  )
}

// The versions that start with the release prefix `epoch!r1.r2...`: [prefix.dev0, next.dev0).
function prefixSet(prefix: Pep440): VersionSet {
  const epoch = prefix.epoch === '0' ? '' : `${prefix.epoch}!`
  const release = [...prefix.release]
  const last = release.pop() as string
  const lo = `${epoch}${[...release, last].join('.')}.dev0`
  const hi = `${epoch}${[...release, String(BigInt(last) + 1n)].join('.')}.dev0`
  return intersect([comparatorSet('>=', lo), comparatorSet('<', hi)], compare)
}

const SPECIFIER = /^(~=|===|==|!=|<=|>=|<|>)\s*(\S+)$/

function specifierSet(text: string, range: string): VersionSet {
  const m = SPECIFIER.exec(text)
  if (!m) throw syntaxError(range, `cannot parse ${JSON.stringify(text)}`)
  const op = m[1] as string
  const version = m[2] as string
  if (op === '===') throw syntaxError(range, 'arbitrary equality (===) cannot be expressed in VERS')

  if (version.endsWith('.*')) {
    const prefix = parse(version.slice(0, -2))
    if (
      !prefix ||
      (op !== '==' && op !== '!=') ||
      /[^0-9.!]/.test(version.slice(0, -2).replace(/^v/i, ''))
    ) {
      throw syntaxError(
        range,
        `${JSON.stringify(text)}: a wildcard needs == or != and a release prefix`,
      )
    }
    const set = prefixSet(prefix)
    return op === '==' ? set : invert(set)
  }
  const parsed = parse(version)
  if (!parsed) throw invalidVersion('pypi', version)
  if (parsed.local && op !== '==' && op !== '!=') {
    throw syntaxError(range, `${JSON.stringify(text)}: a local version needs == or !=`)
  }
  if (op === '~=') {
    if (parsed.release.length < 2) {
      throw syntaxError(range, `${JSON.stringify(text)}: ~= needs a release with two or more parts`)
    }
    const prefix = { ...parsed, release: parsed.release.slice(0, -1) }
    return intersect([comparatorSet('>=', version), prefixSet(prefix)], compare)
  }
  return comparatorSet(op === '==' ? '=' : (op as Comparator), version)
}

// The complement of a single interval, as produced by prefixSet.
function invert(set: VersionSet): VersionSet {
  const [{ lo, hi } = {}] = set
  return [
    ...(lo ? [{ hi: { ...lo, inclusive: !lo.inclusive } }] : []),
    ...(hi ? [{ lo: { ...hi, inclusive: !hi.inclusive } }] : []),
  ]
}

function fromNative(range: string): Constraint[] {
  const alternatives = range.split('||')
  const set = union(
    alternatives.map((alt) => {
      const specs = alt
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
      // Only a wholly empty specifier set matches every version; an empty `||` alternative is a typo.
      if (specs.length === 0 && alternatives.length > 1) {
        throw syntaxError(range, 'empty alternative')
      }
      return specs.length === 0
        ? ALL
        : intersect(
            specs.map((s) => specifierSet(s, range)),
            compare,
          )
    }),
    compare,
  )
  if (set.length === 0) {
    throw new VersError(
      'INVALID_CONSTRAINTS',
      `pypi specifier ${JSON.stringify(range)} matches no version`,
    )
  }
  return toConstraints(set, compare)
}

export const pypi: Scheme = {
  type: 'pypi',
  isValid: (version) => VERSION.test(version),
  compare,
  fromNative,
}

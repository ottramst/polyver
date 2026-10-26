import { describe, expect, it } from 'vitest'
import {
  contains,
  fromNative,
  getScheme,
  type Scheme,
  stringifyVers,
  VersError,
} from '../../src/index.ts'
import { loadComparisonPairs, readTestdata } from '../support/vectors.ts'

const s = getScheme('npm') as Scheme

describe('npm', () => {
  it.each(['1.2.3', 'v1.2.3', '1.2.3-beta.1+build', `${Number.MAX_SAFE_INTEGER}.0.0`])(
    'accepts %s',
    (v) => expect(s.isValid(v)).toBe(true),
  )

  it.each([
    '1.2',
    '=1.2.3',
    'vv1.2.3',
    'V1.2.3',
    '01.2.3',
    `${Number.MAX_SAFE_INTEGER + 2}.0.0`,
    `1.2.3-${'a'.repeat(251)}`,
  ])('rejects %s', (v) => expect(s.isValid(v)).toBe(false))

  it('ignores a leading v and build metadata', () => {
    expect(s.compare('v1.2.3', '1.2.3')).toBe(0)
    expect(s.compare('1.2.3+a', '1.2.3+b')).toBe(0)
    expect(s.compare('1.2.3-beta', '1.2.3')).toBeLessThan(0)
  })

  it('compares large numeric pre-release identifiers exactly', () => {
    expect(s.compare('1.0.0-9007199254740993', '1.0.0-9007199254740992')).toBeGreaterThan(0)
  })

  it('throws on invalid versions', () => {
    expect(() => s.compare('latest', '1.0.0')).toThrow(VersError)
  })

  it('passes the osv-scalibr vectors that are valid npm versions', () => {
    let used = 0
    for (const { a, op, b, line } of loadComparisonPairs('osv-scalibr/semver-versions.txt')) {
      if (!s.isValid(a) || !s.isValid(b)) continue
      used++
      expect(Math.sign(s.compare(a, b)), `line ${line}: ${a} ${op} ${b}`).toBe(
        { '<': -1, '=': 0, '>': 1 }[op],
      )
    }
    expect(used).toBeGreaterThan(70)
  })
})

// node-semver's own test fixtures (testdata/node-semver), restricted to its default options: loose
// parsing and includePrerelease are not npm VERS semantics.
type Fixture = [string, string | null, unknown?]

function fixtures(name: string): Fixture[] {
  return (JSON.parse(readTestdata(`node-semver/${name}.json`)) as Fixture[]).filter(
    ([, , options]) => {
      if (options === undefined || options === false || options === null) return true
      return typeof options === 'object' && !Object.values(options as object).some(Boolean)
    },
  )
}

function outcome(range: string): string {
  try {
    return stringifyVers(fromNative('npm', range))
  } catch (e) {
    if (e instanceof VersError) return `error ${e.code}`
    throw e
  }
}

describe('npm node-semver fixtures', () => {
  it.each(fixtures('comparisons'))('%s > %s', (a, b) => {
    expect(s.compare(a, b as string)).toBeGreaterThan(0)
    expect(s.compare(b as string, a)).toBeLessThan(0)
  })

  it.each(fixtures('equality').filter(([a, b]) => s.isValid(a) && s.isValid(b as string)))(
    '%s == %s',
    (a, b) => expect(s.compare(a, b as string)).toBe(0),
  )

  // The fixture gives node-semver's desugared form; both must convert to the same VERS. node-semver
  // writes upper bounds as `<X-0`, polyver as `<X`.
  it.each(fixtures('range-parse'))('fromNative(%j) matches node-semver %j', (range, desugared) => {
    if (desugared === null) {
      expect(outcome(range)).toMatch(/^error /)
    } else if (desugared === '<0.0.0-0') {
      // node-semver's "null set": VERS cannot express a range that matches nothing.
      expect(outcome(range)).toBe('error INVALID_CONSTRAINTS')
    } else {
      expect(outcome(range)).toBe(outcome(desugared.replace(/<(\S+)-0\b/g, '<$1')))
    }
  })

  const isRelease = (version: string): boolean => !/^v?\d+\.\d+\.\d+-/.test(version)
  it.each(fixtures('range-include').filter(([, v]) => isRelease(v as string)))(
    '%j includes %s',
    (range, version) => expect(contains(fromNative('npm', range), version as string)).toBe(true),
  )
  it.each(
    fixtures('range-exclude').filter(
      ([, v]) => typeof v === 'string' && s.isValid(v) && isRelease(v),
    ),
  )('%j excludes %s', (range, version) => {
    expect(
      outcome(range) !== 'vers:npm/*' && contains(fromNative('npm', range), version as string),
    ).toBe(false)
  })
})

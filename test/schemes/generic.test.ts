import { describe, expect, it } from 'vitest'
import { getScheme, type Scheme, supportedSchemes, VersError } from '../../src/index.ts'
import { loadComparisonPairs } from '../support/vectors.ts'

function scheme(type: string): Scheme {
  const s = getScheme(type)
  if (!s) throw new Error(`missing scheme ${type}`)
  return s
}

/** Asserts that `versions` is in strictly ascending order under `type`, checking every pair. */
function expectAscending(type: string, versions: string[]): void {
  const s = scheme(type)
  for (let i = 0; i < versions.length; i++) {
    for (let j = 0; j < versions.length; j++) {
      expect(
        Math.sign(s.compare(versions[i] as string, versions[j] as string)),
        `${versions[i]} vs ${versions[j]}`,
      ).toBe(Math.sign(i - j))
    }
  }
}

it('lists the supported schemes', () => {
  expect(supportedSchemes()).toEqual([
    'all',
    'apk',
    'datetime',
    'deb',
    'intdot',
    'lexicographic',
    'none',
    'npm',
    'pypi',
    'rpm',
    'semver',
  ])
  expect(getScheme('SemVer')).toBe(getScheme('semver'))
  expect(getScheme('nosuchtype')).toBeUndefined()
})

describe('semver', () => {
  const s = scheme('semver')

  it.each([
    '0.0.0',
    '1.2.3',
    '1.0.0-alpha.1',
    '1.0.0-0.3.7',
    '1.0.0-x-y-z.--',
    '1.0.0+21AF26D3----117B344092BD',
    '99999999999999999999.0.0',
  ])('accepts %s', (v) => expect(s.isValid(v)).toBe(true))

  it.each([
    '1',
    '1.2',
    'v1.2.3',
    '01.2.3',
    '1.2.3-01',
    '1.2.3-',
    '1.2.3+',
    '1.2.3.4',
    ' 1.2.3',
    '1.2.3-a..b',
  ])('rejects %s', (v) => expect(s.isValid(v)).toBe(false))

  it('orders by precedence (SemVer 2.0.0 §11)', () => {
    expectAscending('semver', [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '2.0.0',
      '2.1.0',
      '2.1.1',
      '10.0.0',
      '99999999999999999999.0.0',
      '100000000000000000000.0.0',
    ])
  })

  it('ignores build metadata', () => {
    expect(s.compare('1.0.0+a', '1.0.0+b')).toBe(0)
  })

  it('throws on invalid versions', () => {
    expect(() => s.compare('1.0', '1.0.0')).toThrow(VersError)
  })

  it('passes the osv-scalibr vectors that are valid SemVer 2.0.0', () => {
    let used = 0
    for (const { a, op, b, line } of loadComparisonPairs('osv-scalibr/semver-versions.txt')) {
      if (!s.isValid(a) || !s.isValid(b)) continue
      used++
      expect(Math.sign(s.compare(a, b)), `line ${line}: ${a} ${op} ${b}`).toBe(
        { '<': -1, '=': 0, '>': 1 }[op],
      )
    }
    expect(used).toBeGreaterThan(40)
  })
})

describe('intdot', () => {
  const s = scheme('intdot')

  it.each(['0', '1.2.3', '01.002', '1.2beta', '10.234.5.12'])('accepts %s', (v) =>
    expect(s.isValid(v)).toBe(true),
  )
  it.each(['', 'beta', '.1', 'v1.2'])('rejects %s', (v) => expect(s.isValid(v)).toBe(false))

  it('compares segments numerically, ignoring leading zeros and suffixes', () => {
    expectAscending('intdot', [
      '0',
      '1',
      '1.2',
      '1.2.1',
      '1.10',
      '2',
      '10.0.0.1',
      '99999999999999999999',
    ])
    expect(s.compare('01.002.0003', '1.2.3')).toBe(0)
    expect(s.compare('1.2', '1.2.0.0')).toBe(0)
    expect(s.compare('1.2beta', '1.2rc1')).toBe(0)
  })
})

describe('lexicographic', () => {
  const s = scheme('lexicographic')

  it('compares in UTF-8 byte order, not UTF-16 code unit order', () => {
    // U+FFFD sorts before U+1F600 in UTF-8, but its UTF-16 code unit is larger than the high surrogate.
    expect(s.compare('�', '\u{1F600}')).toBeLessThan(0)
    expectAscending('lexicographic', ['A', 'Z', 'a', 'aa', 'b', 'é', '€', '�', '😀'])
  })

  it('rejects empty strings and lone surrogates', () => {
    expect(s.isValid('')).toBe(false)
    expect(s.isValid('a\uD800')).toBe(false)
    expect(s.isValid('\uDC00a')).toBe(false)
    expect(() => s.compare('\uD800', 'a')).toThrow(VersError)
  })
})

describe('datetime', () => {
  const s = scheme('datetime')

  it.each([
    '2024-01-01T00:00:00Z',
    '2024-02-29T23:59:59.999999999+14:00',
    '2000-02-29T00:00:00-12:00',
    '0001-01-01T00:00:00Z',
    '2016-12-31T23:59:60Z',
  ])('accepts %s', (v) => expect(s.isValid(v)).toBe(true))

  it.each([
    '2024-01-01t00:00:00z',
    '2024-01-01 00:00:00Z',
    '2024-01-01T00:00:00',
    '2024-01-01',
    '2023-02-29T00:00:00Z',
    '1900-02-29T00:00:00Z',
    '2024-13-01T00:00:00Z',
    '2024-04-31T00:00:00Z',
    '2024-01-01T24:00:00Z',
    '2024-01-01T00:60:00Z',
    '2024-01-01T00:00:61Z',
    '2024-01-01T00:00:00+24:00',
    '2024-01-01T00:00:00.Z',
  ])('rejects %s', (v) => expect(s.isValid(v)).toBe(false))

  it('compares instants with exact fractional seconds', () => {
    expectAscending('datetime', [
      '0001-01-01T00:00:00Z',
      '1969-12-31T23:59:59Z',
      '1970-01-01T00:00:00Z',
      '1970-01-01T00:00:00.0000000001Z',
      '1970-01-01T00:00:00.1Z',
      '2024-01-01T00:00:00+02:00',
      '2023-12-31T23:00:00Z',
      '2024-01-01T00:00:00Z',
    ])
    expect(s.compare('2024-01-01T00:00:00Z', '2023-12-31T19:00:00-05:00')).toBe(0)
  })

  it('orders a leap second between its minute and the next', () => {
    expectAscending('datetime', [
      '2016-12-31T23:59:59.999Z',
      '2016-12-31T23:59:60Z',
      '2016-12-31T23:59:60.5Z',
      '2017-01-01T00:00:00Z',
    ])
    expect(s.compare('2016-12-31T23:59:60Z', '2017-01-01T00:59:60+01:00')).toBe(0)
    expect(s.compare('2024-01-01T00:00:00Z', '2024-01-01T00:00:00.000Z')).toBe(0)
  })
})

describe('all and none', () => {
  it('accept any version but have no order', () => {
    for (const type of ['all', 'none']) {
      const s = scheme(type)
      expect(s.isValid('anything')).toBe(true)
      expect(s.isValid('')).toBe(false)
      expect(() => s.compare('1', '2')).toThrow(VersError)
    }
  })
})

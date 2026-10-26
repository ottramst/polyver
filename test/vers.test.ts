import { describe, expect, it } from 'vitest'
import {
  contains,
  normalizeVers,
  parseVers,
  stringifyVers,
  VersError,
  type VersErrorCode,
  type VersRange,
} from '../src/index.ts'

function errorCode(fn: () => unknown): VersErrorCode | undefined {
  try {
    fn()
  } catch (e) {
    if (e instanceof VersError) return e.code
    throw e
  }
  return undefined
}

describe('parseVers', () => {
  it.each([
    [
      'vers:npm/>=1.0.0|<2.0.0',
      [
        { comparator: '>=', version: '1.0.0' },
        { comparator: '<', version: '2.0.0' },
      ],
    ],
    ['vers:npm/1.0.0', [{ comparator: '=', version: '1.0.0' }]],
    ['vers:npm/*', [{ comparator: '*' }]],
    ['vers:lexicographic/%C3%A9', [{ comparator: '=', version: 'é' }]],
    ['vers:lexicographic/a%7Cb%20c', [{ comparator: '=', version: 'a|b c' }]],
    ['vers:lexicographic/100%25', [{ comparator: '=', version: '100%' }]],
    ['vers:none/*', [{ comparator: '*' }]],
  ])('%s', (input, constraints) => {
    expect(parseVers(input)).toEqual({ type: input.slice(5, input.indexOf('/')), constraints })
  })

  it.each<[string, VersErrorCode]>([
    // Syntax (Clause 5.1 to 5.3)
    ['npm/1.0.0', 'INVALID_SYNTAX'],
    ['VERS:npm/1.0.0', 'INVALID_SYNTAX'],
    ['vers:npm', 'INVALID_SYNTAX'],
    ['vers:NPM/1.0.0', 'INVALID_SYNTAX'],
    ['vers:1npm/1.0.0', 'INVALID_SYNTAX'],
    ['vers:npm/', 'INVALID_SYNTAX'],
    ['vers:npm/|1.0.0', 'INVALID_SYNTAX'],
    ['vers:npm/1.0.0|', 'INVALID_SYNTAX'],
    ['vers:npm/>=1.0.0||<2.0.0', 'INVALID_SYNTAX'],
    ['vers:npm/>=1.0.0| <2.0.0', 'INVALID_SYNTAX'],
    ['vers:npm/>=1.0.0\t', 'INVALID_SYNTAX'],
    ['vers:npm/=1.0.0', 'INVALID_SYNTAX'],
    ['vers:npm/==1.0.0', 'INVALID_SYNTAX'],
    ['vers:npm/>==1.0.0', 'INVALID_SYNTAX'],
    ['vers:npm/>=', 'INVALID_SYNTAX'],
    ['vers:npm/1.0%2G0', 'INVALID_SYNTAX'],
    ['vers:npm/1.0.0%', 'INVALID_SYNTAX'],
    ['vers:lexicographic/%C3', 'INVALID_SYNTAX'],
    ['vers:lexicographic/%c3%a9', 'INVALID_SYNTAX'],
    ['vers:lexicographic/é', 'INVALID_SYNTAX'],
    ['vers:lexicographic/1%092', 'INVALID_SYNTAX'],
    ['vers:lexicographic/1%002', 'INVALID_SYNTAX'],
    ['vers:lexicographic/%41', 'INVALID_SYNTAX'],
    ['vers:datetime/2024-01-01T00%3A00%3A00Z', 'INVALID_SYNTAX'],
    // Unknown types
    ['vers:nosuchtype/1.0', 'UNSUPPORTED_SCHEME'],
    // Type-specific version validation
    ['vers:npm/not-a-version', 'INVALID_VERSION'],
    ['vers:datetime/2024-01-01t00:00:00z', 'INVALID_VERSION'],
    // Validation rules (Clause 5.4)
    ['vers:npm/>=2.0.0|<1.0.0', 'INVALID_CONSTRAINTS'],
    ['vers:npm/1.0.0|1.0.0', 'INVALID_CONSTRAINTS'],
    ['vers:npm/1.0.0|v1.0.0', 'INVALID_CONSTRAINTS'],
    ['vers:npm/1.0.0|!=1.0.0', 'INVALID_CONSTRAINTS'],
    ['vers:npm/*|1.0.0', 'INVALID_CONSTRAINTS'],
    ['vers:npm/1.0.0|*', 'INVALID_CONSTRAINTS'],
    ['vers:all/1.0', 'INVALID_CONSTRAINTS'],
    ['vers:none/1.0', 'INVALID_CONSTRAINTS'],
    ['vers:npm/1.0.0|<2.0.0', 'INVALID_CONSTRAINTS'],
    ['vers:npm/1.0.0|!=1.5.0|<=2.0.0', 'INVALID_CONSTRAINTS'],
    ['vers:npm/>=1.0.0|>2.0.0', 'INVALID_CONSTRAINTS'],
    ['vers:npm/<1.0.0|<=2.0.0', 'INVALID_CONSTRAINTS'],
    ['vers:npm/<1.0.0|1.5.0|<2.0.0', 'INVALID_CONSTRAINTS'],
  ])('rejects %s with %s', (input, code) => {
    expect(errorCode(() => parseVers(input))).toBe(code)
  })

  it.each([
    'vers:npm/<1.0.0|>=2.0.0',
    'vers:npm/!=1.0.0|<2.0.0',
    'vers:npm/1.0.0|!=1.5.0|>=2.0.0',
    'vers:npm/1.0.0|1.1.0|>2.0.0|<3.0.0|!=3.5.0|>=4.0.0',
    'vers:npm/<1.0.0|1.5.0|>2.0.0',
    // Clause 5.4 lets an equality follow ">" or ">=" (normalizeVers removes it as redundant).
    'vers:npm/>=1.0.0|1.5.0',
  ])('accepts %s', (input) => {
    expect(stringifyVers(parseVers(input))).toBe(input)
  })
})

describe('normalizeVers', () => {
  it.each([
    [' VERS:NPM/ <2.0.0 | >= 1.0.0 ', 'vers:npm/>=1.0.0|<2.0.0'],
    ['vers:npm/=1.0.0', 'vers:npm/1.0.0'],
    ['vers:npm/==1.0.0', 'vers:npm/1.0.0'],
    ['vers:npm/|1.0.0||2.0.0|', 'vers:npm/1.0.0|2.0.0'],
    ['vers:lexicographic/%c3%a9', 'vers:lexicographic/%C3%A9'],
    ['vers:lexicographic/%41', 'vers:lexicographic/A'],
    ['vers:lexicographic/1 2', 'vers:lexicographic/1%202'],
    ['vers:npm/1.0.0|1.0.0', 'vers:npm/1.0.0'],
    ['vers:npm/2.0.0|1.0.0', 'vers:npm/1.0.0|2.0.0'],
    ['vers:npm/>=1.0.0|>=2.0.0', 'vers:npm/>=1.0.0'],
    ['vers:npm/<1.0.0|<2.0.0', 'vers:npm/<2.0.0'],
    ['vers:npm/1.0.0|<2.0.0', 'vers:npm/<2.0.0'],
    ['vers:npm/>1.0.0|1.5.0|<2.0.0', 'vers:npm/>1.0.0|<2.0.0'],
    ['vers:npm/!=1.5.0|>=1.0.0', 'vers:npm/>=1.0.0|!=1.5.0'],
    ['vers:npm/1.0.0|*', 'vers:npm/*'],
  ])('%s -> %s', (input, expected) => {
    expect(stringifyVers(normalizeVers(input))).toBe(expected)
  })

  it.each<[string, VersErrorCode]>([
    ['npm/1.0.0', 'INVALID_SYNTAX'],
    ['vers:npm/', 'INVALID_SYNTAX'],
    ['vers:npm/1.0%2G0', 'INVALID_SYNTAX'],
    ['vers:lexicographic/a\tb', 'INVALID_SYNTAX'],
    ['vers:npm/not-a-version', 'INVALID_VERSION'],
    ['vers:nosuchtype/1.0', 'UNSUPPORTED_SCHEME'],
    // The same version with different comparators cannot be repaired without guessing.
    ['vers:npm/1.0.0|>=1.0.0', 'INVALID_CONSTRAINTS'],
    ['vers:npm/>=1.0.0|1.0.0', 'INVALID_CONSTRAINTS'],
    ['vers:npm/1.0.0|>1.0.0', 'INVALID_CONSTRAINTS'],
    ['vers:npm/>1.0.0|1.0.0', 'INVALID_CONSTRAINTS'],
    ['vers:npm/1.0.0|<1.0.0', 'INVALID_CONSTRAINTS'],
    ['vers:npm/<1.0.0|1.0.0', 'INVALID_CONSTRAINTS'],
    ['vers:npm/<=1.0.0|<1.0.0', 'INVALID_CONSTRAINTS'],
    ['vers:npm/>1.0.0|>=1.0.0', 'INVALID_CONSTRAINTS'],
    ['vers:npm/1.0.0|!=1.0.0', 'INVALID_CONSTRAINTS'],
    ['vers:npm/1.0.0+a|>1.0.0+b', 'INVALID_CONSTRAINTS'],
  ])('rejects %s with %s', (input, code) => {
    expect(errorCode(() => normalizeVers(input))).toBe(code)
  })
})

describe('stringifyVers', () => {
  it('percent-encodes versions canonically', () => {
    const range: VersRange = {
      type: 'lexicographic',
      constraints: [
        { comparator: '<', version: 'a|b c' },
        { comparator: '>=', version: 'é%' },
      ],
    }
    expect(stringifyVers(range)).toBe('vers:lexicographic/<a%7Cb%20c|>=%C3%A9%25')
    expect(parseVers(stringifyVers(range))).toEqual(range)
  })

  it.each<[VersRange, VersErrorCode]>([
    [{ type: 'npm', constraints: [] }, 'INVALID_SYNTAX'],
    [{ type: 'npm', constraints: [{ comparator: '=', version: '' }] }, 'INVALID_SYNTAX'],
    [
      { type: 'npm', constraints: [{ comparator: '==' as '=', version: '1.0.0' }] },
      'INVALID_SYNTAX',
    ],
    [
      { type: 'lexicographic', constraints: [{ comparator: '=', version: 'a\tb' }] },
      'INVALID_SYNTAX',
    ],
    [
      { type: 'lexicographic', constraints: [{ comparator: '=', version: '\uD800' }] },
      'INVALID_VERSION',
    ],
    [
      {
        type: 'npm',
        constraints: [
          { comparator: '=', version: '2.0.0' },
          { comparator: '=', version: '1.0.0' },
        ],
      },
      'INVALID_CONSTRAINTS',
    ],
    // Not a VersRange, but JavaScript callers can pass one.
    [{ type: 'npm' } as unknown as VersRange, 'INVALID_SYNTAX'],
  ])('rejects %j with %s', (range, code) => {
    expect(errorCode(() => stringifyVers(range))).toBe(code)
  })
})

describe('contains', () => {
  it.each([
    // A single bound (https://github.com/package-url/vers-spec/issues/54)
    ['vers:npm/>=1.0.0', '2.0.0', true],
    ['vers:npm/>=1.0.0', '1.0.0', true],
    ['vers:npm/>=1.0.0', '0.5.0', false],
    ['vers:npm/>1.0.0', '1.0.0', false],
    ['vers:npm/<1.0.0', '0.5.0', true],
    ['vers:npm/<1.0.0', '1.0.0', false],
    ['vers:npm/<=1.0.0', '1.0.0', true],
    // Several intervals
    ...[
      ['0.5.0', true],
      ['1.0.0', false],
      ['1.5.0', false],
      ['2.0.0', true],
      ['2.5.0', true],
      ['3.0.0', false],
      ['4.0.0', false],
      ['4.5.0', true],
    ].map(([v, r]) => ['vers:npm/<1.0.0|>=2.0.0|<3.0.0|>4.0.0', v, r]),
    // Equalities and exclusions
    ...[
      ['1.0.0', true],
      ['1.5.0', false],
      ['2.0.0', true],
      ['2.5.0', false],
      ['2.7.0', true],
      ['3.0.0', false],
    ].map(([v, r]) => ['vers:npm/1.0.0|>=2.0.0|!=2.5.0|<3.0.0', v, r]),
    ['vers:npm/1.0.0|2.0.0', '2.0.0', true],
    ['vers:npm/1.0.0|2.0.0', '1.5.0', false],
    // Only exclusions: everything else is in the range
    ['vers:npm/!=1.0.0', '2.0.0', true],
    ['vers:npm/!=1.0.0', '1.0.0', false],
    ['vers:npm/!=1.0.0|!=2.0.0', '2.0.0', false],
    // Equality is the scheme's equality
    ['vers:npm/1.0.0', 'v1.0.0', true],
    ['vers:npm/1.0.0', '1.0.0+build', true],
    ['vers:intdot/1.2', '1.2.0', true],
    // Star
    ['vers:npm/*', '1.0.0', true],
    ['vers:all/*', 'anything', true],
    ['vers:none/*', 'anything', false],
  ] as [string, string, boolean][])('%s contains %s: %s', (range, version, expected) => {
    expect(contains(range, version)).toBe(expected)
    expect(contains(parseVers(range), version)).toBe(expected)
  })

  it('rejects an invalid version', () => {
    expect(errorCode(() => contains('vers:npm/>=1.0.0', 'latest'))).toBe('INVALID_VERSION')
    expect(errorCode(() => contains('vers:npm/*', 'latest'))).toBe('INVALID_VERSION')
  })

  it('rejects an invalid range', () => {
    expect(errorCode(() => contains('vers:npm/<2.0.0|>=1.0.0', '1.5.0'))).toBe(
      'INVALID_CONSTRAINTS',
    )
    const unsorted: VersRange = {
      type: 'npm',
      constraints: [
        { comparator: '<', version: '2.0.0' },
        { comparator: '>=', version: '1.0.0' },
      ],
    }
    expect(errorCode(() => contains(unsorted, '1.5.0'))).toBe('INVALID_CONSTRAINTS')
  })
})

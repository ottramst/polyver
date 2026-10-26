/**
 * Sets of versions as sorted unions of disjoint intervals, used to turn native range syntaxes into
 * canonical VERS constraints. Internal; not exported from the package.
 */
import { VersError } from './errors.ts'
import type { Comparator, Constraint } from './vers.ts'

type Compare = (a: string, b: string) => number

interface Bound {
  readonly version: string
  readonly inclusive: boolean
}

/** An interval of versions; a missing bound is unbounded. */
export interface Interval {
  readonly lo?: Bound
  readonly hi?: Bound
}

/** A union of intervals. After {@link normalize}, sorted and disjoint. */
export type VersionSet = readonly Interval[]

export const ALL: VersionSet = [{}]

/** The set of versions that satisfy a single comparator. */
export function comparatorSet(comparator: Comparator, version: string): VersionSet {
  switch (comparator) {
    case '=':
      return [{ lo: { version, inclusive: true }, hi: { version, inclusive: true } }]
    case '!=':
      return [{ hi: { version, inclusive: false } }, { lo: { version, inclusive: false } }]
    case '<':
      return [{ hi: { version, inclusive: false } }]
    case '<=':
      return [{ hi: { version, inclusive: true } }]
    case '>':
      return [{ lo: { version, inclusive: false } }]
    case '>=':
      return [{ lo: { version, inclusive: true } }]
  }
}

// Orders lower bounds: unbounded first, then by version, inclusive before exclusive.
function compareLo(a: Bound | undefined, b: Bound | undefined, compare: Compare): number {
  if (!a || !b) return (a ? 1 : 0) - (b ? 1 : 0)
  return compare(a.version, b.version) || Number(b.inclusive) - Number(a.inclusive)
}

// Orders upper bounds: by version, exclusive before inclusive, then unbounded last.
function compareHi(a: Bound | undefined, b: Bound | undefined, compare: Compare): number {
  if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1)
  return compare(a.version, b.version) || Number(a.inclusive) - Number(b.inclusive)
}

function isEmpty({ lo, hi }: Interval, compare: Compare): boolean {
  if (!lo || !hi) return false
  const c = compare(lo.version, hi.version)
  return c > 0 || (c === 0 && !(lo.inclusive && hi.inclusive))
}

// Whether `b` (starting no earlier than `a`) overlaps or touches `a`, so the two can be merged.
function joins(a: Interval, b: Interval, compare: Compare): boolean {
  if (!a.hi || !b.lo) return true
  const c = compare(a.hi.version, b.lo.version)
  return c > 0 || (c === 0 && (a.hi.inclusive || b.lo.inclusive))
}

function bounds(lo: Bound | undefined, hi: Bound | undefined): Interval {
  return { ...(lo && { lo }), ...(hi && { hi }) }
}

/** Sorts, drops empty intervals and merges overlapping or touching ones. */
export function normalize(set: VersionSet, compare: Compare): VersionSet {
  const sorted = set
    .filter((i) => !isEmpty(i, compare))
    .sort((a, b) => compareLo(a.lo, b.lo, compare))
  const out: Interval[] = []
  for (const i of sorted) {
    const last = out[out.length - 1]
    if (last && joins(last, i, compare)) {
      out[out.length - 1] = bounds(last.lo, compareHi(last.hi, i.hi, compare) >= 0 ? last.hi : i.hi)
    } else {
      out.push(i)
    }
  }
  return out
}

export function union(sets: readonly VersionSet[], compare: Compare): VersionSet {
  return normalize(sets.flat(), compare)
}

export function intersect(sets: readonly VersionSet[], compare: Compare): VersionSet {
  let result: VersionSet = ALL
  for (const set of sets) {
    const next: Interval[] = []
    for (const a of result) {
      for (const b of set) {
        next.push(
          bounds(
            compareLo(a.lo, b.lo, compare) >= 0 ? a.lo : b.lo,
            compareHi(a.hi, b.hi, compare) <= 0 ? a.hi : b.hi,
          ),
        )
      }
    }
    result = normalize(next, compare)
  }
  return result
}

/**
 * Renders a normalized set as canonical VERS constraints. Two intervals separated by a single excluded
 * version become one span with a `!=` constraint. Throws if the set is empty, which VERS cannot express
 * for a versioned type.
 */
export function toConstraints(set: VersionSet, compare: Compare): Constraint[] {
  if (set.length === 0) throw new VersError('INVALID_CONSTRAINTS', 'the range matches no version')
  const out: Constraint[] = []
  for (let i = 0; i < set.length; i++) {
    const { lo } = set[i] as Interval
    const excluded: string[] = []
    let hi = (set[i] as Interval).hi
    for (let next = set[i + 1]; hi && next?.lo; next = set[i + 1]) {
      if (hi.inclusive || next.lo.inclusive || compare(hi.version, next.lo.version) !== 0) break
      excluded.push(hi.version)
      hi = next.hi
      i++
    }
    if (lo && hi && lo.inclusive && hi.inclusive && compare(lo.version, hi.version) === 0) {
      out.push({ comparator: '=', version: lo.version })
      continue
    }
    if (lo) out.push({ comparator: lo.inclusive ? '>=' : '>', version: lo.version })
    for (const version of excluded) out.push({ comparator: '!=', version })
    if (hi) out.push({ comparator: hi.inclusive ? '<=' : '<', version: hi.version })
  }
  return out.length === 0 ? [{ comparator: '*' }] : out
}

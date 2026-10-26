/**
 * VERS ("version range specifier") parsing, validation and containment.
 *
 * Spec: https://github.com/package-url/vers-spec (Clause 5, and docs/specification/how-to-parse.md).
 * The core spec defines only the syntax, the comparators, validation and the containment algorithm; how
 * versions compare is delegated to each versioning scheme (see ./schemes).
 */
import { VersError } from './errors.ts'
import { getScheme, type Scheme } from './schemes/index.ts'

export { VersError, type VersErrorCode } from './errors.ts'

/** A comparator. `=` stands for the implicit equality of a bare version and is never written out. */
export type Comparator = '=' | '!=' | '<' | '<=' | '>' | '>='

export type Constraint =
  | { readonly comparator: Comparator; readonly version: string }
  | { readonly comparator: '*' }

export interface VersRange {
  /** VERS type (the versioning scheme), e.g. `npm`, `pypi`, `deb`. Lowercase. */
  readonly type: string
  /** Constraints in canonical order (sorted by version, per the scheme's comparison). */
  readonly constraints: readonly Constraint[]
}

type VersionConstraint = Extract<Constraint, { version: string }>

const TYPE = /^[a-z][a-z0-9.-]*$/
const PRINTABLE_ASCII = /^[\x21-\x7e]*$/
const WHITESPACE = /[\t\n\v\f\r ]/
// Longest first, so that `>=` is not read as `>` followed by a version starting with `=`.
const PREFIXES = ['>=', '<=', '!=', '<', '>'] as const
const COMPARATORS: ReadonlySet<string> = new Set(['=', '!=', '<', '<=', '>', '>='])
// Characters that are printable ASCII but must still be percent-encoded in a version.
const RESERVED = '><=!*|%'
// Types whose only valid form is `vers:<type>/*`.
const STAR_ONLY: ReadonlySet<string> = new Set(['all', 'none'])

function syntaxError(message: string): VersError {
  return new VersError('INVALID_SYNTAX', message)
}

function constraintsError(message: string): VersError {
  return new VersError('INVALID_CONSTRAINTS', message)
}

function percent(byte: number): string {
  return `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
}

/** Percent-encodes a version canonically: reserved characters, space, controls and non-ASCII. */
function encodeVersion(version: string): string {
  let out = ''
  for (const ch of version) {
    const cp = ch.codePointAt(0) as number
    if (cp >= 0x21 && cp <= 0x7e) out += RESERVED.includes(ch) ? percent(cp) : ch
    else if (cp < 0x80) out += percent(cp)
    else {
      try {
        out += encodeURIComponent(ch)
      } catch (cause) {
        throw new VersError('INVALID_VERSION', 'version contains a lone surrogate', { cause })
      }
    }
  }
  return out
}

function decodeVersion(encoded: string): string {
  try {
    return decodeURIComponent(encoded)
  } catch (cause) {
    throw new VersError('INVALID_SYNTAX', 'invalid percent-encoding in version', { cause })
  }
}

function checkCharacters(version: string): void {
  if (WHITESPACE.test(version.replaceAll(' ', ''))) throw syntaxError('whitespace is not permitted')
  for (let i = 0; i < version.length; i++) {
    const c = version.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) throw syntaxError('control characters are not permitted')
  }
}

function parseStrictConstraint(raw: string): Constraint {
  if (raw === '*') throw constraintsError('"*" must be used alone')
  if (raw.startsWith('=')) {
    throw syntaxError('explicit equality comparator is not permitted; use a bare version')
  }
  const comparator: Comparator = PREFIXES.find((p) => raw.startsWith(p)) ?? '='
  const encoded = comparator === '=' ? raw : raw.slice(comparator.length)
  if (encoded === '') throw syntaxError(`empty version in constraint ${JSON.stringify(raw)}`)
  for (const m of encoded.matchAll(/%(.{0,2})/g)) {
    const hex = m[1] as string
    if (!/^[0-9A-Fa-f]{2}$/.test(hex)) throw syntaxError('invalid percent-encoding in version')
    if (hex !== hex.toUpperCase()) throw syntaxError('percent-encoding in version is not canonical')
  }
  const version = decodeVersion(encoded)
  checkCharacters(version)
  if (encodeVersion(version) !== encoded) {
    throw syntaxError(`version ${JSON.stringify(encoded)} is not canonically percent-encoded`)
  }
  return { comparator, version }
}

function parseLenientConstraint(raw: string): Constraint {
  const m = /^(==|>=|<=|!=|=|<|>)?\s*(.*)$/s.exec(raw) as RegExpExecArray
  const comparator: Comparator = m[1] === undefined || m[1] === '==' ? '=' : (m[1] as Comparator)
  const encoded = (m[2] as string).trim()
  if (encoded === '') throw syntaxError(`empty version in constraint ${JSON.stringify(raw)}`)
  const version = decodeVersion(encoded)
  checkCharacters(version)
  return { comparator, version }
}

function lookupScheme(type: string): Scheme {
  if (!TYPE.test(type)) {
    throw syntaxError(
      `invalid type ${JSON.stringify(type)}: use lowercase ASCII letters, digits, "." and "-", starting with a letter`,
    )
  }
  const scheme = getScheme(type)
  if (!scheme) throw new VersError('UNSUPPORTED_SCHEME', `unsupported VERS type: ${type}`)
  return scheme
}

function format(c: Constraint): string {
  if (c.comparator === '*') return '*'
  return (c.comparator === '=' ? '' : c.comparator) + c.version
}

/** Applies the validation rules of Clause 5.4 and returns the range's scheme. */
function validate(type: string, constraints: readonly Constraint[]): Scheme {
  const scheme = lookupScheme(type)
  if (constraints.length === 0) throw syntaxError('constraints must not be empty')
  if (constraints.some((c) => c.comparator === '*')) {
    if (constraints.length !== 1) throw constraintsError('"*" must be used alone')
    return scheme
  }
  if (STAR_ONLY.has(type)) throw constraintsError(`vers:${type}/* is the only valid form`)

  const cs = constraints as readonly VersionConstraint[]
  for (const c of cs) {
    if (!COMPARATORS.has(c.comparator)) {
      throw syntaxError(`invalid comparator ${JSON.stringify(c.comparator)}`)
    }
    if (typeof c.version !== 'string' || c.version === '') throw syntaxError('empty version')
    checkCharacters(c.version)
    if (!scheme.isValid(c.version)) {
      throw new VersError(
        'INVALID_VERSION',
        `invalid ${type} version: ${JSON.stringify(c.version)}`,
      )
    }
  }
  for (let i = 1; i < cs.length; i++) {
    const prev = cs[i - 1] as VersionConstraint
    const cur = cs[i] as VersionConstraint
    const order = scheme.compare(prev.version, cur.version)
    if (order === 0) {
      throw constraintsError(`duplicate version: ${format(prev)} and ${format(cur)}`)
    }
    if (order > 0) {
      throw constraintsError(
        `constraints are not sorted by version: ${format(prev)} before ${format(cur)}`,
      )
    }
  }

  // Ignoring "!=", an equality may be followed only by "=", ">" or ">="; ignoring "=" as well, the
  // remaining comparators must alternate between ">"/">=" and "<"/"<=".
  let prev: VersionConstraint | undefined
  let prevBound: VersionConstraint | undefined
  for (const c of cs) {
    if (c.comparator === '!=') continue
    if (prev?.comparator === '=' && c.comparator.startsWith('<')) {
      throw constraintsError(`${format(c)} cannot follow the equality ${format(prev)}`)
    }
    prev = c
    if (c.comparator === '=') continue
    if (prevBound && prevBound.comparator[0] === c.comparator[0]) {
      throw constraintsError(`${format(prevBound)} and ${format(c)}: "<" and ">" must alternate`)
    }
    prevBound = c
  }
  return scheme
}

function parse(input: string): { range: VersRange; scheme: Scheme } {
  if (!PRINTABLE_ASCII.test(input)) {
    throw syntaxError(
      /\s/.test(input) ? 'whitespace is not permitted' : 'only printable ASCII is permitted',
    )
  }
  const colon = input.indexOf(':')
  if (colon === -1 || input.slice(0, colon) !== 'vers') {
    throw syntaxError('a VERS must start with "vers:"')
  }
  const slash = input.indexOf('/', colon + 1)
  if (slash === -1) throw syntaxError('missing "/" between the type and the constraints')
  const type = input.slice(colon + 1, slash)
  lookupScheme(type)

  const body = input.slice(slash + 1)
  if (body === '') throw syntaxError('constraints must not be empty')
  if (body.startsWith('|')) throw syntaxError('leading pipe is not permitted')
  if (body.endsWith('|')) throw syntaxError('trailing pipe is not permitted')
  if (body.includes('||')) throw syntaxError('consecutive pipes are not permitted')
  const constraints: Constraint[] =
    body === '*' ? [{ comparator: '*' }] : body.split('|').map(parseStrictConstraint)
  const scheme = validate(type, constraints)
  return { range: { type, constraints }, scheme }
}

/**
 * Parses a canonical `vers:<type>/<constraints>` string.
 *
 * Parsing is strict, as Clause 5 requires: non-canonical input (unsorted or duplicate versions, an
 * explicit `=`, whitespace, non-canonical percent-encoding, ...) is rejected rather than repaired. Use
 * {@link normalizeVers} to accept such input. Throws {@link VersError}.
 */
export function parseVers(input: string): VersRange {
  return parse(input).range
}

function isLower(c: Constraint): boolean {
  return c.comparator === '<' || c.comparator === '<='
}

function isUpper(c: Constraint): boolean {
  return c.comparator === '>' || c.comparator === '>='
}

// The "Simplifying constraints" procedure of how-to-parse.md, on constraints sorted by version.
function simplify(cs: VersionConstraint[], scheme: Scheme): VersionConstraint[] {
  const unequal = cs.filter((c) => c.comparator === '!=')
  const out: VersionConstraint[] = []
  for (const c of cs) {
    if (c.comparator === '!=') continue
    out.push(c)
    while (out.length >= 2) {
      const prev = out[out.length - 2] as VersionConstraint
      const cur = out[out.length - 1] as VersionConstraint
      if (isUpper(prev) && (cur.comparator === '=' || isUpper(cur))) {
        // Already inside the range opened by `prev`.
        out.pop()
      } else if ((prev.comparator === '=' || isLower(prev)) && isLower(cur)) {
        // `cur` extends the range below it, which covers `prev`.
        out.splice(out.length - 2, 1)
      } else {
        break
      }
    }
  }
  return [...unequal, ...out].sort((a, b) => scheme.compare(a.version, b.version))
}

/**
 * Parses a possibly non-canonical VERS string and returns it in canonical form.
 *
 * Accepts what {@link parseVers} rejects but can be repaired without guessing: any case in `vers:`
 * and the type, whitespace around constraints and comparators, an explicit `=` or `==`, unsorted
 * constraints, exact duplicates, redundant constraints (removed as described in the spec's
 * how-to-parse.md) and any valid percent-encoding. Still throws {@link VersError} if the result breaks
 * a validation rule, for example the same version with two different comparators.
 */
export function normalizeVers(input: string): VersRange {
  const s = input.trim()
  const colon = s.indexOf(':')
  if (colon === -1 || s.slice(0, colon).trim().toLowerCase() !== 'vers') {
    throw syntaxError('a VERS must start with "vers:"')
  }
  const slash = s.indexOf('/', colon + 1)
  if (slash === -1) throw syntaxError('missing "/" between the type and the constraints')
  const type = s
    .slice(colon + 1, slash)
    .trim()
    .toLowerCase()
  const scheme = lookupScheme(type)

  const segments = s
    .slice(slash + 1)
    .split('|')
    .map((x) => x.trim())
    .filter((x) => x !== '')
  if (segments.length === 0) throw syntaxError('constraints must not be empty')
  if (segments.includes('*')) return { type, constraints: [{ comparator: '*' }] }
  if (STAR_ONLY.has(type)) throw constraintsError(`vers:${type}/* is the only valid form`)

  const parsed = segments.map(parseLenientConstraint) as VersionConstraint[]
  for (const c of parsed) {
    if (!scheme.isValid(c.version)) {
      throw new VersError(
        'INVALID_VERSION',
        `invalid ${type} version: ${JSON.stringify(c.version)}`,
      )
    }
  }
  parsed.sort((a, b) => scheme.compare(a.version, b.version))
  const unique = parsed.filter((c, i) => {
    const prev = parsed[i - 1]
    return !(
      prev &&
      prev.comparator === c.comparator &&
      scheme.compare(prev.version, c.version) === 0
    )
  })
  const constraints = simplify(unique, scheme)
  validate(type, constraints)
  return { type, constraints }
}

/** Serializes a range to its canonical `vers:` string. Throws {@link VersError} if it is invalid. */
export function stringifyVers(range: VersRange): string {
  validate(range.type, range.constraints)
  const body = range.constraints
    .map((c) => (c.comparator === '*' ? '*' : format({ ...c, version: encodeVersion(c.version) })))
    .join('|')
  return `vers:${range.type}/${body}`
}

/**
 * Reports whether `version` is contained in `range`, using the range's versioning scheme.
 *
 * Implements the containment algorithm of the spec's how-to-parse.md, with the correction from
 * https://github.com/package-url/vers-spec/issues/54: a single `<` or `>` bound is honoured. A range
 * made only of `!=` constraints contains every other version. A string range is parsed with
 * {@link parseVers}. Throws {@link VersError} if the range or the version is invalid.
 */
export function contains(range: VersRange | string, version: string): boolean {
  const { range: r, scheme } =
    typeof range === 'string'
      ? parse(range)
      : { range, scheme: validate(range.type, range.constraints) }
  if (typeof version !== 'string' || !scheme.isValid(version)) {
    throw new VersError('INVALID_VERSION', `invalid ${r.type} version: ${JSON.stringify(version)}`)
  }
  if (r.constraints[0]?.comparator === '*') return r.type !== 'none'

  const cs = r.constraints as readonly VersionConstraint[]
  for (const c of cs) {
    if (scheme.compare(version, c.version) !== 0) continue
    if (c.comparator === '=' || c.comparator === '<=' || c.comparator === '>=') return true
    if (c.comparator === '!=') return false
  }

  const bounds = cs.filter((c) => c.comparator !== '=' && c.comparator !== '!=')
  const first = bounds[0]
  const last = bounds[bounds.length - 1]
  if (!first || !last) return !cs.some((c) => c.comparator === '=')
  if (isLower(first) && scheme.compare(version, first.version) < 0) return true
  if (isUpper(last) && scheme.compare(version, last.version) > 0) return true
  for (let i = 0; i + 1 < bounds.length; i++) {
    const lo = bounds[i] as VersionConstraint
    const hi = bounds[i + 1] as VersionConstraint
    if (
      isUpper(lo) &&
      isLower(hi) &&
      scheme.compare(version, lo.version) > 0 &&
      scheme.compare(version, hi.version) < 0
    ) {
      return true
    }
  }
  return false
}

/**
 * Converts a range in an ecosystem's native syntax to a canonical VERS range, for example
 * `fromNative('npm', '^1.2.3 || >=2.0.1')` to `vers:npm/>=1.2.3|<2.0.0|>=2.0.1`.
 *
 * Throws {@link VersError}: `UNSUPPORTED_SCHEME` if the type has no native range syntax support,
 * `INVALID_SYNTAX` or `INVALID_VERSION` for an invalid native range, and `INVALID_CONSTRAINTS` if the
 * range matches no version (VERS cannot express an empty range).
 */
export function fromNative(type: string, native: string): VersRange {
  const scheme = lookupScheme(type)
  if (!scheme.fromNative) {
    throw new VersError('UNSUPPORTED_SCHEME', `converting native ${type} ranges is not supported`)
  }
  const constraints = scheme.fromNative(native)
  validate(type, constraints)
  return { type, constraints }
}

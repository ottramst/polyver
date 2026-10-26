/**
 * `apk`: Alpine Linux package versions.
 *
 * Reference: the behaviour of apk-tools 3 (https://gitlab.alpinelinux.org/alpine/apk-tools), measured
 * with `apk version -t` and `apk version -c` as an oracle (testdata/oracle), and the osv-scalibr
 * comparator (https://github.com/google/osv-scalibr/blob/main/semantic/version-alpine.go, Apache-2.0).
 * apk-tools 2.x (Alpine 3.22 and older) differs for `~hash` and for components with leading zeros.
 * Numbers have unlimited precision; apk-tools wraps them at 2^64.
 *
 * A version is `number(.number)*[letter](_suffix[number])*[~hash][-rN]`, for example `1.2.3a_rc1-r2`.
 * Suffixes sort `_alpha < _beta < _pre < _rc < (none) < _cvs < _svn < _git < _hg < _p`.
 */
import type { Scheme } from './types.ts'
import { compareDigits, invalidVersion } from './util.ts'

const VERSION =
  /^(\d+(?:\.\d+)*)([a-z])?((?:_(?:alpha|beta|pre|rc|cvs|svn|git|hg|p)\d*)*)(?:~([0-9a-f]+))?(?:-r(\d+))?$/

const SUFFIXES = ['alpha', 'beta', 'pre', 'rc', '', 'cvs', 'svn', 'git', 'hg', 'p']
const NO_SUFFIX = SUFFIXES.indexOf('')

interface ApkVersion {
  readonly numbers: readonly string[]
  readonly letter: string
  readonly suffixes: readonly (readonly [number, string])[]
  readonly hash: string
  readonly revision: string
}

function parse(version: string): ApkVersion | undefined {
  const m = VERSION.exec(version)
  if (!m) return undefined
  const suffixes = [...(m[3] as string).matchAll(/_([a-z]+)(\d*)/g)].map(
    ([, name, n]) => [SUFFIXES.indexOf(name as string), n as string] as const,
  )
  return {
    numbers: (m[1] as string).split('.'),
    letter: m[2] ?? '',
    suffixes,
    hash: m[4] ?? '',
    revision: m[5] ?? '',
  }
}

// After the first number, a component with a leading zero compares as a decimal fraction, which is
// the same as comparing the digit strings.
function compareNumber(a: string, b: string, index: number): number {
  if (index > 0 && (a.startsWith('0') || b.startsWith('0'))) return a < b ? -1 : a > b ? 1 : 0
  return compareDigits(a, b)
}

// A missing revision sorts before any number, even 0: `1.0 < 1.0-r0`.
function compareOptional(a: string, b: string): number {
  if (a === '' || b === '') return Number(a !== '') - Number(b !== '')
  return compareDigits(a, b)
}

function compareParsed(a: ApkVersion, b: ApkVersion): number {
  const n = Math.min(a.numbers.length, b.numbers.length)
  for (let i = 0; i < n; i++) {
    const d = compareNumber(a.numbers[i] as string, b.numbers[i] as string, i)
    if (d !== 0) return d
  }
  if (a.numbers.length !== b.numbers.length) return a.numbers.length - b.numbers.length
  if (a.letter !== b.letter) return a.letter < b.letter ? -1 : 1
  for (let i = 0; i < Math.max(a.suffixes.length, b.suffixes.length); i++) {
    const [x, xn] = a.suffixes[i] ?? [NO_SUFFIX, '']
    const [y, yn] = b.suffixes[i] ?? [NO_SUFFIX, '']
    if (x !== y) return x - y
    if ((xn === '') !== (yn === '')) {
      // apk-tools compares the side without a number by its next token: a post-release suffix such
      // as `_p` makes it greater (`1.0_rc_p > 1.0_rc1`), anything else makes it smaller.
      const next = (xn === '' ? a : b).suffixes[i + 1]?.[0]
      const greater = next !== undefined && next > NO_SUFFIX
      return (greater ? 1 : -1) * (xn === '' ? 1 : -1)
    }
    const d = compareOptional(xn, yn)
    if (d !== 0) return d
  }
  if (a.hash !== b.hash) return a.hash < b.hash ? -1 : 1
  return compareOptional(a.revision, b.revision)
}

function parseOrThrow(version: string): ApkVersion {
  const v = parse(version)
  if (!v) throw invalidVersion('apk', version)
  return v
}

export const apk: Scheme = {
  type: 'apk',
  isValid: (version) => parse(version) !== undefined,
  compare: (a, b) => compareParsed(parseOrThrow(a), parseOrThrow(b)),
}

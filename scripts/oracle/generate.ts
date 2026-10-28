// Builds the oracle inputs for one ecosystem, deterministically, from committed files only:
// - scripts/oracle/cases/<eco>.txt: hand-written edge cases,
// - testdata/oracle/<eco>-index.txt: versions sampled from the distribution's package index,
// - grammar-based random versions and single-edit mutations, from a fixed-seed PRNG.
// Writes <out>/versions.txt (for validity) and <out>/pairs.txt (`a b` per line, for comparison). For
// gem, also <out>/requirements.txt: `version<TAB>requirement` for every version in cases/gem.txt and
// every requirement in cases/gem-requirements.txt. For nuget, also <out>/ranges.txt (the ranges in
// cases/nuget-ranges.txt) and <out>/range-rows.txt (`version<TAB>range` for every version in
// cases/nuget.txt and every range).
// Usage: node scripts/oracle/generate.ts deb|rpm|apk|maven|golang|gem|nuget <out-dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

type Eco = 'deb' | 'rpm' | 'apk' | 'maven' | 'golang' | 'gem' | 'nuget'
const [eco, out] = process.argv.slice(2) as [Eco, string]
if (!['deb', 'rpm', 'apk', 'maven', 'golang', 'gem', 'nuget'].includes(eco) || !out) {
  throw new Error('usage: generate.ts deb|rpm|apk|maven|golang|gem|nuget <out-dir>')
}

const root = new URL('../../', import.meta.url)
function lines(path: string): string[] {
  return readFileSync(new URL(path, root), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
}

// mulberry32: a small, well-distributed PRNG, so that the output only depends on the seed.
let seed = 0x5eed1e55
function random(): number {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (n: number): number => Math.floor(random() * n)
const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)] as T
const chance = (p: number): boolean => random() < p
const digits = (): string =>
  pick(['0', '1', '2', '9', '10', '01', '00', '99', '123', String(int(100000))])
const repeat = (n: number, f: () => string): string => Array.from({ length: n }, f).join('')

const GRAMMAR: Record<Eco, () => string> = {
  deb: () =>
    (chance(0.2) ? `${int(4)}:` : '') +
    digits() +
    repeat(
      int(5),
      () =>
        pick(['.', '+', '~', '~~', '', '-']) +
        pick([digits(), pick(['a', 'b', 'Z', 'rc', 'dfsg', 'git', 'ubuntu'])]),
    ) +
    (chance(0.6)
      ? `-${repeat(1 + int(3), () => pick([digits(), 'a', 'b', '.', '+', '~', 'deb12u', 'bpo']))}`
      : ''),
  rpm: () =>
    (chance(0.2) ? `${int(4)}:` : '') +
    digits() +
    repeat(
      int(5),
      () =>
        pick(['.', '_', '+', '~', '^', '', '..']) +
        pick([digits(), pick(['a', 'B', 'rc', 'git', 'pre', 'fc'])]),
    ) +
    (chance(0.6)
      ? `-${repeat(1 + int(3), () => pick([digits(), 'fc39', 'el9', '.', '_', '~', '^', 'a']))}`
      : ''),
  apk: () =>
    [digits(), ...Array.from({ length: int(4) }, digits)].join('.') +
    (chance(0.2) ? pick(['a', 'b', 'z']) : '') +
    repeat(
      int(3),
      () =>
        `_${pick(['alpha', 'beta', 'pre', 'rc', 'cvs', 'svn', 'git', 'hg', 'p'])}${chance(0.6) ? digits() : ''}`,
    ) +
    (chance(0.1) ? `~${pick(['abc123', '0f', 'deadbeef', '123abc'])}` : '') +
    (chance(0.5) ? `-r${digits()}` : ''),
  // An empty separator makes a transition between digits and letters, as in `1.0rc1`.
  maven: () =>
    digits() +
    repeat(
      int(5),
      () =>
        pick(['.', '-', '.', '-', '']) +
        pick([
          digits(),
          pick(['alpha', 'a', 'beta', 'B', 'milestone', 'm', 'rc', 'CR', 'snapshot', 'SNAPSHOT']),
          pick(['ga', 'final', 'Final', 'release', 'RELEASE', 'sp', 'jre', 'foo', 'x', 'sec']),
        ]),
    ),
  // Mostly vMAJOR.MINOR.PATCH, sometimes a shorthand, and the three pseudo-version forms.
  golang: () =>
    (chance(0.9) ? 'v' : '') +
    Array.from({ length: pick([1, 2, 3, 3, 3, 3, 4]) }, digits).join('.') +
    (chance(0.5)
      ? `-${pick([
          () =>
            repeat(
              1 + int(3),
              () => `${pick([digits(), 'alpha', 'beta', 'rc', 'pre', '-', 'x-y'])}.`,
            ).slice(0, -1),
          () =>
            `${pick(['', '0.', 'rc.1.0.', 'pre.0.'])}${timestamp()}-${pick(['abcdef123456', '0123456789ab', 'deadbeef'])}`,
        ])()}`
      : '') +
    (chance(0.15) ? pick(['+incompatible', '+meta.1', '+build-5', '+']) : ''),
  // Dot-separated numbers and letters, sometimes joined (`0a1`), and a `-` part (read as `.pre.`).
  gem: () =>
    digits() +
    repeat(
      int(5),
      () =>
        pick(['.', '.', '.', '']) +
        pick([digits(), digits(), pick(['a', 'b', 'A', 'z', 'pre', 'rc', 'RC', 'beta', 'alpha'])]),
    ) +
    (chance(0.2)
      ? `-${repeat(1 + int(3), () => pick([digits(), 'a', 'rc', 'beta', '.', '-']))}`
      : ''),
  // One to five numbers (four is the most NuGet accepts), some near int.MaxValue, then optional
  // pre-release labels (numeric, negative, SemVer 1.0 style such as `beta1`) and build metadata.
  nuget: () =>
    Array.from({ length: pick([1, 2, 3, 3, 3, 4, 4, 5]) }, () =>
      chance(0.05) ? pick(['2147483647', '2147483648', '4294967296']) : digits(),
    ).join('.') +
    (chance(0.5)
      ? `-${repeat(
          1 + int(3),
          () =>
            `${pick([digits(), 'alpha', 'beta', 'BETA', 'Beta1', 'rc', 'pre', '-', '-1', 'a-b', '0a', '2147483648'])}.`,
        ).slice(0, -1)}`
      : '') +
    (chance(0.2) ? `+${pick(['meta', 'build.5', '007', 'sha.abc123', 'A-B', '', 'a..b'])}` : ''),
}

/** A pseudo-version timestamp, yyyymmddhhmmss. */
function timestamp(): string {
  return `20${10 + int(17)}${repeat(5, () => String(10 + int(18)))}`
}

const EDITS: Record<Eco, readonly string[]> = {
  deb: ['~', '~rc1', '+', 'a', '.0', '-1', '-0', '+b1', '~bpo', '1:'],
  rpm: ['~', '~rc1', '^', '^git1', '.0', 'a', '-1', '_1', '.', '1:'],
  apk: ['_rc1', '_p1', '_alpha', 'a', '.0', '-r1', '~abc', '_git1', '.01', '0'],
  maven: ['-SNAPSHOT', '.0', '-0', '-rc1', '.RC1', '-sp1', 'a1', '-final', '-1', '.'],
  golang: ['-0', '-rc.1', '.0', '+incompatible', '-pre', '.01', 'v', '-', '+', '.'],
  gem: ['.0', '.a', '-rc1', '.pre', '0', 'A', '-', '.b2', 'a', '.'],
  nuget: ['.0', '-0', '-beta', '-BETA.1', '+meta', '.', '-', '+', '01', '.-1'],
}

/** A single random edit: bump a digit, insert or append a token, or drop a character. */
function mutate(v: string): string {
  const edit = pick(EDITS[eco])
  switch (int(5)) {
    case 0: {
      const ds = [...v.matchAll(/\d+/g)]
      const m = ds.length > 0 ? pick(ds) : undefined
      if (!m) return v + edit
      const bumped = String(BigInt(m[0]) + BigInt(pick([1, -1, 9])))
      return v.slice(0, m.index) + bumped.replace('-', '') + v.slice(m.index + m[0].length)
    }
    case 1:
      return edit.endsWith(':') ? edit + v : v + edit
    case 2: {
      const at = int(v.length + 1)
      return v.slice(0, at) + edit + v.slice(at)
    }
    case 3:
      return v.length > 1 ? v.slice(0, -1) : v + edit
    default: {
      const seps = [...v.matchAll(/[.\-_+~^]/g)]
      const m = seps.length > 0 ? pick(seps) : undefined
      return m
        ? v.slice(0, m.index) + pick(['.', '-', '_', '+', '~']) + v.slice(m.index + 1)
        : v + edit
    }
  }
}

// Shell-safe, line-safe candidates: no whitespace, `#` or quotes.
const usable = (v: string): boolean => v !== '' && /^[\x21-\x7e]+$/.test(v) && !/[#'"\\`$]/.test(v)

const cases = lines(`scripts/oracle/cases/${eco}.txt`)
const index = lines(`testdata/oracle/${eco}-index.txt`)
const generated = Array.from({ length: 400 }, GRAMMAR[eco])

const pairs: [string, string][] = []
for (let i = 0; i < cases.length; i++) {
  for (let j = i + 1; j < cases.length; j++) pairs.push([cases[i] as string, cases[j] as string])
}
for (const pool of [index, generated]) {
  for (const v of pool) {
    pairs.push([v, mutate(v)], [v, pick(pool)], [mutate(v), pick(cases)])
  }
}

const seen = new Set<string>()
const unique = pairs.filter(([a, b]) => {
  const key = `${a} ${b}`
  if (a === b || !usable(a) || !usable(b) || seen.has(key)) return false
  seen.add(key)
  return true
})
const versions = [...new Set(unique.flat())]

mkdirSync(out, { recursive: true })
writeFileSync(`${out}/versions.txt`, `${versions.join('\n')}\n`)
writeFileSync(`${out}/pairs.txt`, `${unique.map((p) => p.join(' ')).join('\n')}\n`)
console.log(`${eco}: ${versions.length} versions, ${unique.length} pairs`)

if (eco === 'gem') {
  const rows = lines('scripts/oracle/cases/gem-requirements.txt').flatMap((r) =>
    cases.map((v) => `${v}\t${r}`),
  )
  writeFileSync(`${out}/requirements.txt`, `${rows.join('\n')}\n`)
  console.log(`gem: ${rows.length} requirement rows`)
}

if (eco === 'nuget') {
  const ranges = lines('scripts/oracle/cases/nuget-ranges.txt')
  const rows = ranges.flatMap((r) => cases.map((v) => `${v}\t${r}`))
  writeFileSync(`${out}/ranges.txt`, `${ranges.join('\n')}\n`)
  writeFileSync(`${out}/range-rows.txt`, `${rows.join('\n')}\n`)
  console.log(`nuget: ${ranges.length} ranges, ${rows.length} range rows`)
}

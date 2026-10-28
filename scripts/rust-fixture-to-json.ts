// Extracts the version and requirement cases from dtolnay/semver's tests as JSON, without running
// them. Usage: node scripts/rust-fixture-to-json.ts <test_version.rs> <test_version_req.rs> <out-dir>
// Writes <out-dir>/test_version.json ({parse: [{in, valid}], compare: [{a, op, b, holds}]}, where `op`
// is a Rust comparison operator applied to two `Version`s) and <out-dir>/test_version_req.json ({parse:
// [{in, valid}], matches: [{req, version, matches}], equal: [{a, b, equal}]}).
//
// The sources are split into statements at `;` outside string literals. Every statement must match one
// of the rules below, either as a case or as test scaffolding to skip, so a pin bump that adds a new
// kind of assertion fails here instead of being dropped.
import { readFileSync, writeFileSync } from 'node:fs'

const [versionTest, reqTest, out] = process.argv.slice(2)
if (!versionTest || !reqTest || !out) {
  throw new Error(
    'usage: rust-fixture-to-json.ts <test_version.rs> <test_version_req.rs> <out-dir>',
  )
}

/** Decodes the body of a Rust string literal. */
function unescapeRust(body: string, path: string): string {
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|x[0-7][0-9a-fA-F]|.)/g, (_, e: string) => {
    if (e.startsWith('u{')) return String.fromCodePoint(Number.parseInt(e.slice(2, -1), 16))
    if (e.startsWith('x')) return String.fromCharCode(Number.parseInt(e.slice(1), 16))
    const simple: Record<string, string> = { '0': '\0', n: '\n', r: '\r', t: '\t', '\\': '\\' }
    if (e in simple) return simple[e] as string
    if (e === '"' || e === "'") return e
    throw new Error(`${path}: unsupported escape \\${e}`)
  })
}

interface Statement {
  /** The statement with each string literal replaced by `$` and no whitespace next to punctuation. */
  readonly shape: string
  readonly strings: readonly string[]
}

/**
 * Splits Rust source into statements. `//` comments are dropped; whitespace runs collapse to one
 * space, which is then removed next to anything but two word characters, and trailing commas go.
 */
function statements(path: string): Statement[] {
  const source = readFileSync(path, 'utf8')
  const result: Statement[] = []
  let shape = ''
  let strings: string[] = []
  const flush = (): void => {
    const s = shape
      .replace(/\s+/g, ' ')
      .replace(/ (?=\W)|(?<=\W) /g, '')
      .replace(/,(?=[)\]}])/g, '')
      .trim()
    // Attributes, closing braces, function headers and a block's tail expression (`hasher.finish()`)
    // in front of the first statement after them.
    const stripped = s.replace(
      /^(?:\}|#!?\[[^\]]*\]|(?:pub )?fn \w+\([^)]*\)(?:->\w+)?\{|mod \w+|use .*|hasher\.finish\(\)\})*/,
      '',
    )
    if (stripped !== '') result.push({ shape: stripped, strings })
    shape = ''
    strings = []
  }
  for (let i = 0; i < source.length; i++) {
    const c = source[i] as string
    if (c === '"') {
      let j = i + 1
      while (source[j] !== '"') {
        if (j >= source.length) throw new Error(`${path}: unterminated string`)
        j += source[j] === '\\' ? 2 : 1
      }
      strings.push(unescapeRust(source.slice(i + 1, j), path))
      shape += '$'
      i = j
    } else if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
      shape += ' '
    } else if (c === ';') {
      flush()
    } else {
      shape += c
    }
  }
  flush()
  return result
}

type Row = Record<string, string | boolean>

/** A statement pattern and what to do with its match and string literals. */
type Rule = readonly [RegExp, (m: RegExpExecArray, strings: readonly string[]) => void]
const skip = (): void => {}

function extract(path: string, rules: readonly Rule[]): void {
  for (const s of statements(path)) {
    const rule = rules.find(([re]) => re.test(s.shape))
    if (!rule) {
      throw new Error(
        `${path}: unexpected statement ${JSON.stringify(s.shape)} ${JSON.stringify(s.strings)}`,
      )
    }
    rule[1](rule[0].exec(s.shape) as RegExpExecArray, s.strings)
  }
}

/** `$,$,...`, as in `&[$,$]`. */
const LIST = '\\$(?:,\\$)*'

function versionCases(path: string): { parse: Row[]; compare: Row[] } {
  const parse = new Map<string, boolean>()
  const compare: Row[] = []
  const valid = (...vs: readonly string[]): void => {
    for (const v of vs) parse.set(v, true)
  }
  extract(path, [
    [/^let err=version_err\(\$\)$/, (_, [v = '']) => parse.set(v, false)],
    [/^let (?:parsed|version)=version\(\$\)$/, (_, [v = '']) => valid(v)],
    [/^assert_to_string\(version\(\$\),\$\)$/, (_, [v = '']) => valid(v)],
    [
      /^assert_(eq|ne)!\(version\(\$\),version\(\$\)\)$/,
      (m, [a = '', b = '']) => {
        valid(a, b)
        compare.push({ a, op: m[1] === 'eq' ? '==' : '!=', b, holds: true })
      },
    ],
    [
      /^assert!\((!\()?version\(\$\)(<=?|>=?)version\(\$\)\)?\)$/,
      (m, [a = '', b = '']) => {
        valid(a, b)
        compare.push({ a, op: m[2] as string, b, holds: m[1] === undefined })
      },
    ],
    [
      // test_spec_order: each version is less than the next.
      new RegExp(`^let vs=\\[${LIST}\\]$`),
      (_, vs) => {
        valid(...vs)
        for (let i = 1; i < vs.length; i++) {
          compare.push({ a: vs[i - 1] as string, op: '<', b: vs[i] as string, holds: true })
        }
      },
    ],
    [/^assert_to_string\(err,\$\)$/, skip],
    [/^assert_eq!\(parsed,expected\)$/, skip],
    [/^let expected=Version(?:::new\(\d+,\d+,\d+\)|\{[^}]*\})$/, skip],
    // test_spec_order's loop over `vs`, and test_align's formatting checks.
    [/^let mut i=1$/, skip],
    [/^while i<vs\.len\(\)\{let a=version\(vs\[i-1\]\)$/, skip],
    [/^let b=version\(vs\[i\]\)$/, skip],
    [/^assert!\(a<b,\$,a,b\)$/, skip],
    [/^i\+=1$/, skip],
    [/^assert_eq!\(\$,format!\(\$,version\)\)$/, skip],
  ])
  return { parse: [...parse].map(([v, ok]) => ({ in: v, valid: ok })), compare }
}

function reqCases(path: string): { parse: Row[]; matches: Row[]; equal: Row[] } {
  const parse = new Map<string, boolean>()
  const matches: Row[] = []
  const equal: Row[] = []
  // The requirement that `r` names: `*` for VersionReq::STAR, undefined for VersionReq::default().
  let current: string | undefined
  // The operators of test_leading_digit_in_pre_and_build's `for op in &[...]` loop.
  let ops: readonly string[] = []
  const valid = (...rs: readonly string[]): void => {
    for (const r of rs) parse.set(r, true)
  }
  const named = (): string => {
    if (current === undefined) throw new Error(`${path}: no requirement named r`)
    return current
  }
  extract(path, [
    [
      /^let ref r=(?:req\(\$\)|VersionReq::(STAR|default\(\)))$/,
      (m, [r = '']) => {
        current = m[1] === undefined ? r : m[1] === 'STAR' ? '*' : undefined
        if (m[1] === undefined) valid(r)
      },
    ],
    [
      new RegExp(`^assert_match_(all|none)\\(r,&\\[${LIST}\\]\\)$`),
      (m, vs) => {
        const req = named()
        for (const version of vs) matches.push({ req, version, matches: m[1] === 'all' })
      },
    ],
    // Every comparator that Comparator::parse rejects is also rejected as a VersionReq.
    [/^let err=(?:req_err|comparator_err)\(\$\)$/, (_, [r = '']) => parse.set(r, false)],
    [/^let parsed=comparator\(\$\)$/, (_, [r = '']) => valid(r)],
    [
      new RegExp(`^for s in&\\[${LIST}\\]\\{assert_eq!\\(\\*r,req\\(s\\)\\)$`),
      (_, rs) => {
        const a = named()
        valid(...rs)
        for (const b of rs) equal.push({ a, b, equal: true })
      },
    ],
    [
      /^assert(?:_(eq|ne)!\(req\(\$\),|!\(req\(\$\)(==|!=))req\(\$\)\)$/,
      (m, [a = '', b = '']) => {
        valid(a, b)
        equal.push({ a, b, equal: m[1] === 'eq' || m[2] === '==' })
      },
    ],
    [
      new RegExp(`^for op in&\\[${LIST}\\]\\{req\\(&format!\\(\\$,op\\)\\)$`),
      (_, strings) => {
        ops = strings.slice(0, -1)
        for (const op of ops) valid((strings.at(-1) as string).replace('{}', op))
      },
    ],
    [
      /^req\(&format!\(\$,op\)\)$/,
      (_, [format = '']) => {
        if (ops.length === 0) throw new Error(`${path}: format! outside the loop over op`)
        for (const op of ops) valid(format.replace('{}', op))
      },
    ],
    [/^assert_to_string\((?:err|r|parsed),\$\)$/, skip],
    [/^assert_eq!\(r,&VersionReq::STAR\)$/, skip],
    // The helpers and test_eq_hash's hashing.
    [/^for string in versions\{let parsed=version\(string\)$/, skip],
    [/^assert!\(!?req\.matches\(&parsed\),\$,string\)$/, skip],
    [/^let mut hasher=DefaultHasher::new\(\)$/, skip],
    [/^value\.hash\(&mut hasher\)$/, skip],
    [
      /^assert(?:_eq!\(|!\()calculate_hash\(req\(\$\)\)(?:,|==)calculate_hash\(req\(\$\)\)\)$/,
      skip,
    ],
  ])
  return { parse: [...parse].map(([r, ok]) => ({ in: r, valid: ok })), matches, equal }
}

// One entry per line, so that a pin bump gives a readable diff.
function write(path: string, sections: Record<string, Row[]>): void {
  const body = Object.entries(sections).map(
    ([name, rows]) =>
      `  ${JSON.stringify(name)}: [\n${rows.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]`,
  )
  writeFileSync(path, `{\n${body.join(',\n')}\n}\n`)
}

write(`${out}/test_version.json`, versionCases(versionTest))
write(`${out}/test_version_req.json`, reqCases(reqTest))

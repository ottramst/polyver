# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

polyver is a zero-dependency TypeScript library (published to npm as ESM) that compares package versions and
evaluates [VERS](https://github.com/package-url/vers-spec) version ranges across ecosystems. It must run in
Node.js 22+, browsers, Deno and Bun, so `src/` uses no Node.js APIs. Background research, prior art, spec
status and per-ecosystem references are in `docs/RESEARCH.md`; read it before adding a scheme.

## Common Commands

```bash
pnpm test            # vitest (single file: pnpm test test/vers.test.ts)
pnpm check           # biome check + tsc (no emit)
pnpm format          # biome check --write
pnpm build           # tsdown -> dist/ (ESM + .d.mts)
pnpm check:package   # publint + attw on the packed package
```

## Architecture

- `src/vers.ts`: VERS syntax, canonicalization, validation and containment (spec Clause 5). Scheme-agnostic.
- `src/schemes/`: one file per versioning scheme implementing `Scheme` (`isValid`, `compare`), registered in
  `src/schemes/index.ts`. Each mirrors one reference implementation, linked at the top of the file.
- `testdata/`: vendored vectors and oracle output, with provenance in `testdata/README.md`.

## Rules

- Zero runtime dependencies. Do not add any without asking.
- Never copy code from Renovate (AGPL-3.0) or vectors from GPL test suites (dpkg, rpm, apk-tools, parts of
  univers). Permissive sources and oracles only; record provenance.
- `isolatedDeclarations` is on: exported functions need explicit return types.
- Style is enforced by Biome: single quotes, no semicolons, 2-space indent, 100 columns.
- Add a `CHANGELOG.md` entry under `## Unreleased` for user-visible changes.
- Supported Node.js majors are the non-EOL ones; keep `engines`, `.node-version`, the CI matrix and the
  `@types/node` major (oldest supported) in sync.

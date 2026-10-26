# Contributing

Thanks for your interest in improving polyver. Bug reports, feature requests and pull requests are all
welcome. By participating you agree to follow the [Code of Conduct](.github/CODE_OF_CONDUCT.md).

## Reporting issues

Use the [issue templates](https://github.com/ottramst/polyver/issues/new/choose). For a wrong comparison,
include the scheme, both versions, the result you got, and what the ecosystem's own tool says (for example
`dpkg --compare-versions 1.0~rc1 lt 1.0; echo $?`). Report security vulnerabilities privately, as described
in [SECURITY.md](SECURITY.md).

## Development setup

Requirements: [Node.js](https://nodejs.org/) 22 or newer and [pnpm](https://pnpm.io/) (the version in
`packageManager` in `package.json`).

```shell
pnpm install
pnpm test        # vitest
pnpm check       # biome lint + format check, tsc
pnpm format      # apply biome fixes and formatting
pnpm build       # bundle to dist/ with tsdown
pnpm check:package  # publint + are-the-types-wrong on the built package
```

## Adding or fixing a scheme

1. Follow the ecosystem's reference implementation, not another port. Link it at the top of the file.
2. Add test vectors from a permissive source or a reference-tool oracle, never from GPL test suites or
   files copied from them. Fetch vendored files with `scripts/vendor-testdata.sh` (pin the commit there;
   it needs `curl`, Node.js 22.18 or newer for its `.ts` helpers, and `python3`) and record where they came from in
   [testdata/README.md](testdata/README.md).
3. For ecosystems with a command-line tool (deb, rpm, apk), regenerate the oracle vectors with Docker:
   `pnpm oracle <eco>` (reads only committed inputs; byte-identical on rerun) and, to refresh the
   real-world sample, `pnpm oracle:harvest <eco>`. Images are pinned in `scripts/oracle/images.env`.
4. If polyver deliberately disagrees with an upstream vector, add the case and the reason to
   `test/support/divergences.ts` rather than skipping it.
5. Never copy code from Renovate (AGPL-3.0) or other copyleft projects.

## Pull requests

- Keep each pull request focused on one change, and add or update tests for it.
- Add an entry to `CHANGELOG.md` under `## Unreleased` (`FEATURES`, `BUG FIXES` or `NOTES`).
- CI must pass: the `CI gate` check covers lint, typecheck, tests on every supported Node.js version, and
  the package build.

## Releases

Maintainers release by bumping `version` in `package.json`, moving the `## Unreleased` entries in
`CHANGELOG.md` under a new `## vX.Y.Z` heading, and pushing a matching `vX.Y.Z` tag. The release workflow
checks that the tag matches `package.json`, runs the full check suite, publishes to npm through trusted
publishing (with provenance), and creates a GitHub release from that `CHANGELOG.md` section.

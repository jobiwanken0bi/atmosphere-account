# Contributing to Atmosphere Account

Thanks for helping make portable AT Protocol accounts easier to use. Small,
focused pull requests are easiest to review, and documentation, translation,
accessibility, testing, and example improvements are all welcome.

By participating, you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Choose a forge

- [GitHub](https://github.com/jobiwanken0bi/atmosphere-account) is the canonical
  issue, security-advisory, and CI surface.
- [Tangled](https://tangled.org/@joebasser.com/atmosphere-account) is a
  first-class source mirror. Tangled issues, forks, and pull requests are
  welcome.

Maintainers mirror accepted commits so both `main` branches remain identical.
Please open the same change on only one forge and link any related conversation
on the other forge instead of duplicating review threads.

## Before coding

Use the relevant issue form for bugs, features, or translations. For a small,
obvious correction, a pull request without a prior issue is fine. Discuss large
protocol, schema, database, authentication, or product-boundary changes first.

Never report a vulnerability publicly; follow [SECURITY.md](./SECURITY.md).

## Local setup

```sh
deno install
cp .env.example .env
deno task dev:local
```

Use `deno task dev:seed` for representative local data. Keep production
credentials out of local fixtures and test output. Do not commit generated
`_fresh/`, dependency `node_modules/`, local databases, or environment files.

## Development workflow

1. Branch from current `main`.
2. Keep the change focused and include tests for behavior changes.
3. Preserve the security boundaries in [Architecture](./docs/ARCHITECTURE.md).
4. Put public user-facing copy in the typed message catalog. Follow
   [Internationalization](./docs/INTERNATIONALIZATION.md).
5. Update documentation and examples when a public contract changes.
6. Run the checks below before submitting.

```sh
deno task check
deno task test
deno task host:conformance:smoke
deno task build
```

Changes to account selection, signed handoffs, or OAuth start behavior should
also run `deno task e2e:login`. Changes to deployment or readiness behavior
should explain the production validation plan, but contributors do not need
production credentials.

## Pull request checklist

- Explain the user or operator problem and the chosen solution.
- Call out migrations, environment variables, compatibility changes, and
  security implications.
- Add screenshots for visible UI changes when practical.
- List the exact checks run.
- Keep generated output and unrelated formatting out of the diff.
- Confirm new dependencies are necessary and represented in `deno.lock`.

Maintainers may squash a pull request. Submitted contributions are licensed
under the repository's [MIT License](./LICENSE).

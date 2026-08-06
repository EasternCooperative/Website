# Contributing

Thanks for your interest in improving the ECRS website.

This repository is [proprietary](./LICENSE.md); code contributions are limited to ECRS maintainers and explicitly invited collaborators. Bug reports and feature suggestions from anyone are welcome via [Issues](https://github.com/EasternCooperative/Website/issues).

## Reporting bugs / suggesting features

Open an issue using the appropriate template. Include steps to reproduce, expected vs. actual behavior, and screenshots where relevant.

For security vulnerabilities, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.

## Development setup

See the [README](./README.md) for install/run commands and [AGENTS.md](./AGENTS.md) for architecture, conventions, and project structure.

```bash
npm install
npm run dev
```

## Before opening a pull request

1. `npm run check` — type-check, lint, and format check
2. `npm test` — unit tests
3. `npm run test:e2e` — for changes touching event pages or UI
4. `npm run build` — confirm the production build succeeds

## Pull requests

- Keep PRs focused on a single change
- Describe the "why," not just the "what," in the PR description
- Link any related issue

## Code of Conduct

This project follows the [Code of Conduct](./CODE_OF_CONDUCT.md).

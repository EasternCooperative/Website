# Security Policy

## Supported Versions

This repository powers the live [ecrs.org](https://ecrs.org) website. Only the `main` branch, which is deployed automatically, is supported with security fixes.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report it privately using one of the following methods:

1. **Preferred:** Use GitHub's [private vulnerability reporting](https://github.com/EasternCooperative/Website/security/advisories/new) (Security tab → "Report a vulnerability").
2. **Fallback:** Email **security@ecrs.org** with a description of the issue, steps to reproduce, and any relevant details.

We'll acknowledge your report as soon as possible and aim to keep you updated as we investigate and address the issue. Please give us a reasonable amount of time to fix the issue before disclosing it publicly.

## Scope

In scope:

- The Astro site source in this repository (`src/`, `functions/`, `scripts/`, config files).
- The Cloudflare Pages deployment of `ecrs.org`.
- The Sveltia CMS integration and its GitHub OAuth proxy Worker, to the extent they're covered by this repository.

Out of scope:

- Third-party services and dependencies (report these to their respective maintainers).
- Denial-of-service and volumetric attacks against Cloudflare Pages infrastructure itself.

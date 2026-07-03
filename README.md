# ECRS Website

[![CI](https://github.com/EasternCooperative/Website/actions/workflows/actions.yaml/badge.svg?branch=main)](https://github.com/EasternCooperative/Website/actions/workflows/actions.yaml)
[![Coverage](https://codecov.io/gh/EasternCooperative/Website/graph/badge.svg)](https://codecov.io/gh/EasternCooperative/Website)
[![Deployed on Cloudflare Pages](https://img.shields.io/badge/deployed-Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white)](https://ecrs.org)

Website for the Eastern Cooperative Recreation School (ECRS). Built with [Astro](https://astro.build/) + [Tailwind CSS](https://tailwindcss.com/), deployed on Cloudflare Pages, content managed via Sveltia CMS.

## Commands

| Command            | Action                               |
| :----------------- | :----------------------------------- |
| `npm install`      | Install dependencies                 |
| `npm run dev`      | Start dev server at `localhost:4321` |
| `npm run build`    | Build production site to `./dist/`   |
| `npm run preview`  | Preview production build locally     |
| `npm run check`    | Type-check and lint                  |
| `npm run fix`      | Auto-fix lint and formatting issues  |
| `npm test`         | Run unit tests (Vitest)              |
| `npm run test:e2e` | Run E2E tests (Playwright)           |

## CMS

Content is managed via [Sveltia CMS](https://github.com/sveltia/sveltia-cms) at `/admin/`. Authentication uses GitHub OAuth proxied through a Cloudflare Worker (`sveltia-cms-auth`). Changes are committed directly to `main` and trigger an automatic Cloudflare Pages deployment.

## Deployment

Pushes to `main` trigger CI (build, unit tests, E2E tests, type check) and an automatic Cloudflare Pages deployment. No manual steps required.

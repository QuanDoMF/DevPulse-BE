# CLAUDE.md

## Build & Development Commands

- `npm run dev` — start Express server with hot-reload (tsx watch, port 3001)
- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run compiled server
- `npm run prisma:generate` — regenerate Prisma client
- `npm run prisma:migrate` — create and apply migrations
- `npm run prisma:studio` — open Prisma Studio GUI

## Architecture

**Stack:** Express 5 + TypeScript + Prisma 5 (SQLite) + JWT Auth

**Structure:**
- `src/index.ts` — Express app entry point
- `src/config.ts` — environment config (validates required vars)
- `src/routes/` — route handlers (auth, github)
- `src/middleware/` — auth guard, Zod validation
- `src/lib/` — Prisma client, JWT helpers, AES-256-GCM crypto
- `prisma/schema.prisma` — database schema

**Auth flow:** JWT access token (15min, httpOnly cookie) + refresh token (7d, httpOnly cookie, rotation on use). Passwords hashed with bcrypt (12 rounds).

**GitHub token:** Encrypted at rest with AES-256-GCM. Decrypted only server-side when proxying GitHub API calls. Never sent to the client.

**Frontend:** DevPulse FE repo (separate). Vite proxies `/api/*` to this server in development.

## Security

- **Secrets in `.env` only** — JWT secrets, encryption key, DB URL must be in `.env`. Never hardcode.
- **No secrets in git** — `.env` is gitignored. Commit `.env.example` as template.
- **httpOnly cookies** — Tokens stored in httpOnly cookies, never in localStorage/headers.
- **Input validation** — All request bodies validated with Zod schemas.
- **Rate limiting** — Login 10/15min, register 5/15min, GitHub proxy 60/min.
- **Helmet** — Security headers enabled.
- **Token never exposed** — GitHub PAT encrypted in DB, decrypted only in server memory during proxy calls.

## Conventions

- File naming: kebab-case
- Commit messages: Conventional Commits, in English
- API responses: `{ user: {...} }` for success, `{ error: "message" }` for errors

## Important

- Do NOT commit `.env`
- Run `prisma:generate` after every schema change
- `secure` cookie flag is conditional on `NODE_ENV=production`

## Git Workflow

**Branching model:**
- `main` — stable, production-ready code only. Do NOT commit directly to main.
- `develop` — primary development branch. All feature work merges here.
- `feature/short-name` or `fix/short-name` — created from `develop`, merged back into `develop`.
- **Release:** merge `develop` into `main` when ready for production.

**Rules:**
- Do NOT commit directly to `develop` or `main`. Always use feature/fix branches.
- Commit after the task is completed and tested OK
- Commit message: Conventional Commits, in English
- After committing, always push the branch to remote
- Always push both `develop` and the feature branch

**Automation (Claude handles entirely):**
- Create feature/fix branches from `develop`
- Commit, push, create PR, and merge into `develop` via GitHub MCP
- Delete feature branch after merge
- User only reviews — all git operations are automated

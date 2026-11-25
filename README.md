# HandleMyDesk

A self-hosted office workspace for projects, clients, tasks and team collaboration, kept open all day on desktop, tablet and phone. It's clean, fast and simple enough that everyone in the office can use it.

![Node 22.16+](https://img.shields.io/badge/node-22.16%2B-339933) ![React 19](https://img.shields.io/badge/react-19-61dafb) ![SQLite](https://img.shields.io/badge/database-SQLite-003b57)

## Features

**Projects**
- All projects are listed in the left sidebar. Each project opens its tabs on the right: Overview, Tasks, Board, Timeline, Calendar, Deliverables, Files, Links, Notes, Chat, Team, Activity and Settings.
- The project lead writes a description and keeps the project's links in one place: GitHub, live site, domain, staging, docs and design.
- Projects move through stages: planning, in progress, review, delivered. Milestones and deliverables can be signed off.
- Each project can produce a summary you print or save as a PDF for the client.
- New projects can start from a template.

**Work**
- Tasks have assignees, due dates, priorities, comments and @mentions. You can view them as a list, a Kanban board or on a calendar.
- My tasks shows your work across all projects.
- Live updates: changes made by colleagues appear without refreshing.
- In-app notifications cover assignments, mentions and due dates.
- Quick search, a project switcher and keyboard shortcuts (press `?`).

**People and clients**
- A client directory, plus a team page with roles: admin, project manager, member.
- Admins add people with a temporary password, and each person chooses their own at first sign-in.
- Optional company sign-in (SSO) through any OpenID Connect provider, such as Microsoft Entra ID, Google Workspace or Okta.
- Each browser tab or device keeps its own sign-in. There is no sign-in rate limit, so staff are never locked out during the day.

**Design**
- A white-first light theme and a matching dark theme.
- Designed for phones first, and also comfortable on tablet and desktop.
- CSV exports for tasks and projects.

**Running it**
- Automatic daily backups, plus `npm run backup` and `npm run restore`.
- A single-instance lock, so two copies can never overwrite each other's data.
- Security headers, a strict Content Security Policy and request logging with request IDs.

## Quick start (development)

Requires **Node.js 22.16 or newer**.

```sh
npm ci
npm run dev
```

Open http://localhost:5173. The API runs on port 3001.

The development database is seeded with demo accounts. They all use the password `handlemydesk123`:

| Account | Role |
| --- | --- |
| `sarah.connor@handlemydesk.internal` | Admin |
| `marcus.vance@handlemydesk.internal` | Project manager |
| `maya.patel@handlemydesk.internal` | Member |

## Running in the office (production)

```sh
npm ci
npm run build
cp .env.example .env   # then set JWT_SECRET and the first admin
npm start
```

[SETUP.md](SETUP.md) is the full guide. It covers configuration, HTTPS, backups and restoring, updating, company sign-in, logs and troubleshooting.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the API and the web app with live reload |
| `npm run build` | Builds the web app into `dist/` |
| `npm start` | Runs the server, which also serves the built app |
| `npm test` | Runs the test suite (Vitest + Supertest) |
| `npm run typecheck` | Type-checks the whole project |
| `npm run backup` | Saves a backup now; safe while the server runs |
| `npm run restore` | Restores a backup; stop the server first |

## Tech stack

- **Web app:** React 19, Vite, Tailwind CSS v4, lucide icons
- **Server:** Node.js, Express 5, helmet
- **Data:** SQLite through Node's built-in `node:sqlite`, with versioned migrations and backups taken automatically before each migration
- **Sign-in:** bcrypt passwords and JWT sessions that can be revoked; OpenID Connect via `jose`
- **Live updates:** Server-Sent Events with a heartbeat

## Project layout

```
src/
  client/        React app: views, project workspace, shared UI
  server/        Express API, database, auth, live events, backups
scripts/         backup and restore commands
tests/           API and workflow tests
public/          static files
data/            database, uploads and backups (created at runtime, not committed)
```

## License

ISC (see `package.json`).

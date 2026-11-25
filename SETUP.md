# NovaDesk: setup and running guide

For the person who installs and looks after the NovaDesk server for the office.

NovaDesk is one Node.js program. It serves the website and the API on one port, keeps all data in a single SQLite file, and backs that file up once a day. Everyone in the office uses it from their browser.

## Requirements

- Node.js **22.13 or newer** (it includes the SQLite module NovaDesk uses). Check with `node -v`.
- One always-on computer or server on the office network.
- About 200 MB of disk space, plus room for uploaded files and backups.

## 1. Install

```sh
npm ci
npm run build
```

`npm run build` creates the website in `dist/`. Run it again after every update.

## 2. Configure

Copy `.env.example` to `.env` and fill it in:

| Setting | What to put |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | Port to serve on, e.g. `3001` |
| `JWT_SECRET` | A long random value. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Changing it later signs everyone out. |
| `INITIAL_ADMIN_NAME`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` | The first administrator. Used only on the very first start, when the database is empty. They must choose a new password when they first sign in. |

Optional: `DATA_DIR` and `BACKUP_DIR` (where data and backups live; default `./data` and `./data/backups`), `BACKUP_KEEP` (daily backups to keep; default 30).

Keep `.env` private: it holds the secret that protects every sign-in.

## 3. Start

```sh
npm start
```

Open `http://<server-name>:3001` and sign in as the first administrator. Then go to **Team → Add person** for each colleague. Each new person gets a temporary password that you pass on to them in person or by phone; they choose their own password at first sign-in.

To keep NovaDesk running after the server restarts, start `npm start` from a Windows scheduled task ("At system startup"), or use a service manager such as [NSSM](https://nssm.cc/) on Windows or systemd on Linux.

**Run only one copy.** NovaDesk refuses to start a second copy on the same data and says which process is already running. That's deliberate: two copies would overwrite each other's changes.

### Moving from a development install

If this server was previously run with `npm run dev`, it contains the demo company, and every demo account uses the password `novadesk123`. Before real use, either:

- start fresh: stop NovaDesk, move the `data` folder aside, set the `INITIAL_ADMIN_*` settings and start again; or
- keep the data: sign in as an admin and, on the **Team** page, reset or deactivate every demo account.

## 4. HTTPS (recommended)

Passwords travel over the network at sign-in, so serve NovaDesk over HTTPS once it's used beyond a single test computer. The simplest way is [Caddy](https://caddyserver.com/) in front of NovaDesk. A `Caddyfile`:

```
novadesk.office.example {
    reverse_proxy localhost:3001 {
        # Live updates (chat, notifications) must not be buffered
        flush_interval -1
    }
}
```

For a name that's only on the office network, add `tls internal` inside the block. Caddy then makes its own certificate, which each computer has to trust once.

Then add to `.env`:

```
HTTPS=true
TRUST_PROXY=true
```

and restart NovaDesk. Firewall the NovaDesk port (3001) so people can only reach it through Caddy.

## 5. Backups

- **Automatic:** one backup a day in `data/backups/`, taken when NovaDesk starts and then every 24 hours. The newest 30 are kept.
- **On demand:** **Admin → Back up now** in the app, or `npm run backup` on the server. Both are safe while NovaDesk is running.
- **Keep copies elsewhere.** Backups on the same disk don't survive that disk failing. Copy `data/backups` (or download backups from the Admin page) to another disk or cloud storage regularly.
- Uploaded files live in `data/uploads/` and are **not** inside the database backup. Copy that folder too.

### Restoring a backup

```sh
# 1. Stop NovaDesk
# 2. List the backups
npm run restore
# 3. Restore one
npm run restore -- novadesk-2026-11-25T02-00-00.db
# 4. Start NovaDesk again
npm start
```

The restore saves the current data first as a `-prerestore` backup, so a mistaken restore can be undone the same way. It refuses to run while NovaDesk is running.

## 6. Updating

```sh
npm run backup        # just in case
# stop NovaDesk, replace the code with the new version
npm ci
npm run build
npm start
```

Database changes are applied automatically at start-up, once each. Before changing existing data, NovaDesk saves a `-premigrate` backup and logs what it updated. `/api/health` shows the current database version (`schemaVersion`).

## 7. Company sign-in (optional)

People can sign in with their Microsoft 365 / Entra ID, Google Workspace or other OpenID Connect account instead of a NovaDesk password. Accounts are matched by email address, so add people on the Team page first (or turn on automatic accounts below). Passwords keep working alongside.

1. Register an app with your provider:
   - **Microsoft Entra ID:** App registrations → New registration. Redirect URI (Web): `https://<your NovaDesk address>/api/auth/sso/callback`. Under Certificates & secrets, create a client secret.
   - **Google Workspace:** Google Cloud console → APIs & Services → Credentials → OAuth client ID (Web application), with the same redirect URI.
2. Add to `.env`:

   ```
   SSO_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0   # Google: https://accounts.google.com
   SSO_CLIENT_ID=<application (client) id>
   SSO_CLIENT_SECRET=<client secret>
   SSO_REDIRECT_URL=https://<your NovaDesk address>/api/auth/sso/callback
   SSO_LABEL=Microsoft                                              # text on the sign-in button
   # SSO_AUTO_CREATE=true   # give people without an account one (as Members) at first sign-in
   ```

3. Restart NovaDesk. The sign-in page shows **Continue with Microsoft** (or your label); **Admin → Sign-in** confirms it's on.

Deactivated people are refused even if the provider accepts them. Use your tenant-specific issuer for Microsoft (not `common`), so only your organisation can sign in.

## 8. Logs

NovaDesk writes one line per request to its output: time, method, path, status, duration and user, for example `09:41:07 GET /api/projects 200 4ms emp-3`. Set `LOG_FORMAT=json` for JSON lines that log tools can read. Each response carries an `X-Request-Id` header, and server errors show a reference id to the person; search the log for that id to find the error.

To keep logs, redirect the output to a file in your start-up task, for example `npm start >> logs
ovadesk.log 2>&1`.

## People and access

| Role | Can do |
| --- | --- |
| Member | Works on the projects they're added to |
| Project manager | Creates projects and manages the ones they lead |
| Admin | Everything, including people, roles and backups |

- **Someone leaves:** Team → ⋯ → **Deactivate**. They're signed out at once and can't sign in again; their work stays in place.
- **Forgotten password:** Team → ⋯ → **Reset password**. Their sessions end, and they get a new temporary password.
- **Templates:** New project → Start from offers built-in templates (website, client onboarding, internal improvement). A project lead can turn any project into a template under Settings → Save as template. Admins see and delete them under Admin → Project templates.
- **Lost or shared device:** in **Account**, anyone can choose **Sign out of all devices**. Changing your password does the same for your other devices.
- There is always at least one active admin; the last one can't be removed or demoted.
- There's no limit on sign-in attempts, so nobody gets locked out. Keep NovaDesk on the office network (or behind a VPN) and don't expose it directly to the internet.

## Troubleshooting

| Message | What to do |
| --- | --- |
| `Another NovaDesk server (process N) is already running` | A copy is already running. Use that one, or stop it (`taskkill /PID N /T /F` on Windows) and start again. |
| `Port 3001 is already in use` | Another program uses the port. Stop it or set a different `PORT`. |
| `JWT_SECRET must be set` | Add `JWT_SECRET` to `.env`. |
| `This is a new installation with an empty database` | Fill in the `INITIAL_ADMIN_*` settings in `.env`. |
| `No built app found in dist/` | Run `npm run build`. |
| Live updates don't arrive behind a proxy | Turn off response buffering for the proxy (`flush_interval -1` in Caddy). |
| Company sign-in says there's no account | Add the person on the Team page with the same email, or set `SSO_AUTO_CREATE=true`. |
| "Something went wrong… Reference: …" | Search the server log for that reference id to see the error. |

Which copy is answering? `http://<server>:3001/api/health` shows its process number and uptime.

## For developers

```sh
npm run dev        # API on 3001 and the site on 5173, with the demo company (password novadesk123)
npm test
npm run typecheck
```

Only one `npm run dev` can run at a time. Close the old terminal before starting another one.

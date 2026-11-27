# Putting HandleMyDesk online (Render + Vercel)

Render runs the server and stores the data. Vercel serves the website and forwards every
`/api/...` request to Render. People only ever use the Vercel address.

```
Browser ──► https://handlemydesk.vercel.app ──(/api/*)──► https://<name>.onrender.com
              Vercel: the website                          Render: server + database
```

Do the steps in this order: **1 → 2 → 3 → 4 → 5**. You need Render's address before you set up Vercel.

---

## Step 1. Push the code to GitHub

The repo already contains `vercel.json` and a Node version setting (`"engines"` in
`package.json`). Commit and push them:

```sh
git add vercel.json DEPLOY.md package.json
git commit -m "Add Render + Vercel deployment setup"
git push origin main
```

---

## Step 2. Create the server on Render

1. Sign in at <https://render.com> with your GitHub account.
2. Click **+ New → Web Service**.
3. **Source Code:** choose **Git Provider → GitHub** and pick `Vyom1912/HandleMyDesk`. If it isn't
   listed, click **Configure GitHub** and give Render access to the repo.
4. Fill in the form:

   | Field | What to enter |
   | --- | --- |
   | Name | `handlemydesk`. This becomes your address, e.g. `handlemydesk.onrender.com`. If the name is taken, Render adds a suffix. |
   | Project | Leave empty |
   | Language | `Node` |
   | Branch | `main` |
   | Region | The one closest to your office |
   | Root Directory | Leave empty |
   | Build Command | `npm ci --include=dev` |
   | Start Command | `npm start` |
   | Instance Type | **Starter** (paid). See the note below. |

   > **Why not Free?** The Free type has no disk. The database is wiped every time the server
   > restarts or redeploys, and the server sleeps after 15 minutes without visitors. That's fine to
   > try things out, not for real work. A disk (next step) needs a paid instance type.

5. **Environment Variables:** click **Add Environment Variable** for each row:

   | Key | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | Click **Generate**, or paste a long random string (see below) |
   | `DATA_DIR` | `/var/data` |
   | `HTTPS` | `true` |
   | `TRUST_PROXY` | `true` |
   | `INITIAL_ADMIN_NAME` | Your full name, e.g. `Vyom Patel` |
   | `INITIAL_ADMIN_EMAIL` | The email you'll sign in with |
   | `INITIAL_ADMIN_PASSWORD` | A temporary password of 8+ characters. You'll choose a new one at first sign-in. |

   To make a random `JWT_SECRET` yourself:
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

   *Optional:* to fill the app with the demo company and projects for a showcase, add `SEED_DEMO` = `true`.
   The demo accounts all use the public password `handlemydesk123`, so **don't** do this if real people
   will use it.

6. Open **Advanced**:

   | Field | What to enter |
   | --- | --- |
   | Health Check Path | `/api/health` |
   | Disk → **Add Disk** → Name | `handlemydesk-data` |
   | Disk → Mount Path | `/var/data` (must match `DATA_DIR`) |
   | Disk → Size | `1` GB is plenty to start. You can grow it later but not shrink it. |
   | Auto-Deploy | `On Commit` |

7. Click **Deploy Web Service**. The first deploy takes a few minutes. Wait for **Live** at the top.
8. Copy the address shown under the service name, e.g. `https://handlemydesk.onrender.com`.
9. Check it: open `https://<your-render-address>/api/health` in a browser. You should see a small
   JSON reply. If the page says the database is empty or the deploy failed, open the **Logs** tab
   (see Troubleshooting).

---

## Step 3. Point `vercel.json` at Render

Open `vercel.json` and replace `YOUR-RENDER-SERVICE.onrender.com` with your Render address from
step 2.8. Keep `/api/:path*` at the end. For example:

```json
"destination": "https://handlemydesk.onrender.com/api/:path*"
```

Commit and push:

```sh
git add vercel.json
git commit -m "Point Vercel at the Render server"
git push origin main
```

(Render redeploys on this push. That's harmless.)

---

## Step 4. Create the website on Vercel

1. Sign in at <https://vercel.com> with your GitHub account.
2. Click **Add New… → Project**.
3. Under **Import Git Repository**, find `HandleMyDesk` and click **Import**. If it isn't listed,
   click **Adjust GitHub App Permissions** and allow the repo.
4. Fill in **Configure Project**:

   | Field | What to enter |
   | --- | --- |
   | Project Name | `handlemydesk`. Your address becomes `handlemydesk.vercel.app`, or similar if taken. |
   | Framework Preset | `Vite` (detected automatically) |
   | Root Directory | `./` |
   | Build and Output Settings | Leave as they are. `vercel.json` already sets `npm run build` and `dist`. |
   | Environment Variables | **None needed.** The server's secrets belong only on Render. |

5. Click **Deploy** and wait for the confetti screen, then click the preview to open your site.
6. Optional: in **Settings → General → Node.js Version**, choose `22.x` to match Render.

---

## Step 5. First sign-in

1. Open your Vercel address, e.g. `https://handlemydesk.vercel.app`.
2. Sign in with `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` from step 2.
3. Choose your own password when asked.
4. Go to the Team page and add your colleagues. Each gets a temporary password and picks their own
   at first sign-in.
5. On Render, you can now delete `INITIAL_ADMIN_PASSWORD` (Environment tab). It's only used when the
   database is brand new.

Optional: add the live address to GitHub. On the repo page, click the ⚙ next to **About** and paste
the Vercel address into **Website**.

---

## Updating the app later

Push to `main`. Render and Vercel both redeploy automatically. Your data on the Render disk is kept.

## Custom domain (optional)

Add it in **Vercel → Project → Settings → Domains** and follow the DNS instructions there. Nothing
changes on Render.

## Company sign-in (SSO, optional)

Add the `SSO_*` variables from `.env.example` to **Render**, and set
`SSO_REDIRECT_URL` = `https://<your-vercel-address>/api/auth/sso/callback`. Use the Vercel address,
not Render's. Register the same URL in your identity provider (Microsoft Entra, Google, Okta…).

## Offices and the owner console

Each customer company is an **office** with its own database, uploads and backups. Offices never
see each other. You, the HandleMyDesk owner, see all of them.

1. On Render → **Environment**, add `OWNER_NAME`, `OWNER_EMAIL` and `OWNER_PASSWORD` (8+ characters).
   Optionally `MAIN_OFFICE_NAME` for the first office's name. Use an email that isn't used inside any office.
2. Sign in on the normal sign-in screen with that email. You get the **owner console**:
   - **Offices:** add an office (you get its administrator's temporary password to send them),
     pause or resume it, rename it, and **Open office** to work inside it as "HandleMyDesk Support".
     The office's admins get a notification when you go in.
   - **Problems:** what people sent with **Report a problem** (sidebar menu → Report a problem).
     Only the person who reported it and you can see it. Your replies notify them.
   - **Log:** everything owners did.
3. Each person signs in with just their email and password; the app finds their office.
   The same email may be used in different offices (offices never learn about each other's people);
   if someone has the same email and password in two offices, they choose which office to open.

Company sign-in (SSO) works for the first office only in this version.

### Branding and exports (office administrators: Admin page)

- **Branding:** upload the office logo, pick its colour, and copy its own sign-in link
  (`https://<your-site>/?office=<name>`). That page shows the logo, name and colour; the device then
  remembers it. You can copy each office's link from its card in the owner console too.
- **Export:** download the office's activity (who did what, when, for any date range), people with
  their workload, projects and tasks, as spreadsheets that open in Excel or Google Sheets.

### Passwords

- **Adding an office or a person:** type a password, or leave it empty for a random temporary one.
  With a typed password you can tick whether they must choose their own at first sign-in.
- **"Forgot password?"** (sign-in screen) never sends email. It asks whoever can reset it:
  - staff → their office's administrators get a notification → **Team → person → Reset password**;
  - an office administrator (or an office with no other admin) → you get it in **Problems** →
    **Reset their password**. You can also reset any office admin from the office card (**Admin password**).
- **Let people reset their own password by email (recommended).** Then "Forgot password?" emails a
  link instead of asking an administrator:
  1. Sign up free at <https://www.brevo.com> (300 emails a day).
  2. **Senders, domains & dedicated IPs → Senders → Add a sender**: the address emails come from.
     Brevo emails it a code to confirm. Best is an address on your own domain (then also add the domain
     under **Domains** for better delivery); a Gmail address works for testing but may land in spam.
  3. **SMTP & API → API Keys → Generate a new API key**, and copy it (starts with `xkeysib-`).
  4. On Render → **Environment**, add:

     | Key | Value |
     | --- | --- |
     | `BREVO_API_KEY` | the key from step 3 |
     | `MAIL_FROM` | `HandleMyDesk <the sender from step 2>` |
     | `APP_URL` | `https://handlemydesk.vercel.app` (your Vercel address) |

  (Resend works too: set `RESEND_API_KEY` instead of `BREVO_API_KEY`.)

  The link works once, for 30 minutes, and signs the person out everywhere else. If sending ever fails,
  the app falls back to asking an administrator.
- **You (the owner) forgot your password:** on Render, change `OWNER_PASSWORD` and save. After the
  restart, sign in with the new one. (A password you changed in the console stays until you change
  `OWNER_PASSWORD` again.)

## Phone notifications

Nothing to set up on the server: it makes its own notification keys and keeps them with the data
(in Neon when `DATABASE_URL` is set, so they survive restarts). If you prefer fixed keys, run
`npx web-push generate-vapid-keys` and set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` on Render.

Each person, once per phone:
- **Android:** open the app → the blue **Get notifications on this phone** card on Home (or **Alerts**)
  → **Turn on** → Allow. **Install app** puts HandleMyDesk on the home screen.
- **iPhone/iPad:** in Safari tap **Share → Add to Home Screen**, open HandleMyDesk from the new icon,
  then **Turn on** in the same card. (Apple only allows notifications for installed web apps.)

The unread count also shows on the app icon.

## Keeping data on the free plan (Neon)

Render's free plan has no disk, so on its own every deploy starts empty. With a free Neon
database, the server copies every change there (about a second later) and downloads everything
again when it starts on an empty folder. Your data, uploaded files, photos and logos survive deploys.

1. Sign up at <https://neon.tech> (free) and create a project. Pick the region closest to your Render
   region. Leave the other settings as they are.
2. On the project dashboard, click **Connect**. Copy the connection string; it looks like
   `postgresql://neondb_owner:…@ep-….neon.tech/neondb?sslmode=require`. Keep it secret: it is the
   key to all your data.
3. On Render → your service → **Environment**, add `DATABASE_URL` with that string, and save.
4. Render restarts. In **Logs** you should see *"Cloud database is empty: this server's data will be
   copied there."* From the next restart on: *"Downloaded the data from the cloud database…"*
5. Check any time: `https://<your-render-address>/api/health` shows `"cloud": {"enabled": true, "waiting": 0, …}`.
   `waiting` above 0 for a long time, or a `lastError`, means Neon can't be reached.

Good to know:
- The first time, the server starts from scratch (`INITIAL_ADMIN_*` again); after that, everything is kept.
- The free Neon plan holds 0.5 GB. Uploaded files count toward it, so keep uploads small.
- A change made in the very last second before a crash can be lost. Normal deploys and restarts
  send everything first.
- Safety: if the server's folder holds *different* data from what's in Neon, it refuses to start
  rather than overwrite Neon. Don't set `DATABASE_URL` on your own computer with the live database.
- Moving to a paid Render plan with a disk later? Keep `DATABASE_URL`; it then works as an extra copy.

## Keeping the free server awake

Render's free plan stops the server after 15 minutes without visitors; waking it takes up to a minute.
Two things prevent that, with nothing to set up:

1. **The server visits itself** every 10 minutes at its public address (Render provides it as
   `RENDER_EXTERNAL_URL`). Check `/api/health`: `"keepAwake": {"lastOkAt": "…"}` shows the last visit.
2. **Backup:** `.github/workflows/keep-awake.yml` also visits every 10 minutes from GitHub (often late,
   which is why it isn't enough alone). See the runs under the repo's **Actions** tab.

Good to know:
- A free Render account gets 750 running hours a month: enough for **one** server awake all month.
- After a deploy, the server still restarts once (1–2 minutes); that can't be avoided on the free plan.
- On a paid plan the server never sleeps: set `KEEP_AWAKE=false` and delete the workflow file.

## Backups

The server makes a daily backup into `/var/data/backups` on the Render disk. Render also takes a
daily snapshot of the disk (**Disks** section of the service) that you can restore from.

---

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Render log: *"This is a new installation with an empty database… Set INITIAL_ADMIN_…"* | One of the three `INITIAL_ADMIN_*` variables is missing, or the password is under 8 characters. Fix it in **Environment** and the service restarts. |
| Render log: *"JWT_SECRET must be set when NODE_ENV=production"* | Add `JWT_SECRET` (step 2.5). |
| Render build fails with `tsx: not found` or `vite: not found` | The build command must be `npm ci --include=dev`. |
| Website loads but sign-in says *"Cannot reach the server"* | `vercel.json` still has `YOUR-RENDER-SERVICE`, or the address is wrong. Fix it (step 3) and push. Also check the Render service is **Live**. |
| Data disappeared after a redeploy | The disk isn't attached, or `DATA_DIR` doesn't match the disk's mount path. |
| Render log: *"Another HandleMyDesk server … is already running"* | Open the service's **Shell** tab, run `rm /var/data/server.lock`, then **Manual Deploy → Restart service**. |
| Large file uploads fail but small ones work | Vercel limits the size of requests it forwards. Keep uploads small, or upload large files directly on the Render address. |
| Live updates sometimes pause for a few seconds | Normal. The app reconnects on its own when the forwarded connection is closed. |

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

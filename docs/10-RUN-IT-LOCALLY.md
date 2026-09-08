# 10 — Running SafeSphere on your own computer

Written for someone who does not spend their day in a terminal. Every command is one line you
copy and paste. If something fails, the fix is usually in §6.

---

## What you need first

| | Mac | Windows |
|---|---|---|
| **Node.js 22** | [nodejs.org](https://nodejs.org) → download the LTS installer | Same |
| **pnpm** | Paste `npm install -g pnpm` in Terminal | Same, in PowerShell |
| **A database** | See §2 — you may already have one | Same |

To open a terminal: **Mac** — press ⌘+Space, type `Terminal`. **Windows** — press the Start key,
type `PowerShell`.

Check Node installed correctly:

```bash
node --version
```

You should see `v22` or higher. If you see "command not found", the installer did not finish —
run it again and restart the terminal.

---

## 1. Get the code into a folder called SAFETY SYSTEM

```bash
git clone https://github.com/jacksonswebe/farm.git "SAFETY SYSTEM"
cd "SAFETY SYSTEM"
git checkout claude/mvp-prd-technical-blueprint-q00ilg
```

The quotes around `"SAFETY SYSTEM"` matter — without them the space breaks the command.

*(If you downloaded the zip instead, just unzip it and `cd` into the folder. Same thing.)*

Then install the libraries. This takes a few minutes the first time and prints a lot — that is
normal:

```bash
pnpm install
```

---

## 2. Point it at a database

**Option A — you already set up Neon. This is the easiest.**

You do not need a database on your computer at all. Create a file called `.env` in the
`SAFETY SYSTEM` folder containing:

```
DATABASE_URL=<your Neon pooled connection string, using the safesphere_app user>
AUTH_SECRET=<the value from db/bootstrap.sql>
CRON_SECRET=<the value from db/bootstrap.sql>
FIELD_ENCRYPTION_KEY=<the value from db/bootstrap.sql>
APP_URL=http://localhost:3000
```

All four values are printed at the top of `db/bootstrap.sql`. Skip to §3.

**Option B — a database on your own machine, using Docker.**

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/), open it once so it is
running, then:

```bash
docker compose -f docker/compose.yml up -d
```

That starts PostgreSQL, loads the demo data, and creates the restricted `safesphere_app`
database user — the same one production uses. It matters that local development runs as that
user too: the image's default user is a superuser, and superusers bypass the tenant-isolation
rules entirely. Developing against a superuser would mean isolation is off on your machine and
on in production, which is the worst way round.

Now create `.env` with:

```
DATABASE_URL=postgresql://safesphere_app:localdev@localhost:5432/safesphere
AUTH_SECRET=local-development-only-secret-change-me
CRON_SECRET=local-development-only-cron-secret
FIELD_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
APP_URL=http://localhost:3000
```

Then give the demo users working passwords:

```bash
node scripts/set-demo-passwords.mjs
```

---

## 3. Start it

```bash
pnpm dev
```

Wait for `Ready`, then open **http://localhost:3000** in your browser.

Sign in with:

- **hse@demo.safesphere.app** / **Demo!2345** — the HSE manager, sees everything
- **worker@demo.safesphere.app** / **Demo!2345** — a worker, sees only their own reports
- **exec@demo.safesphere.app** / **Demo!2345** — read-only executive view

To stop it, click in the terminal and press **Ctrl+C**.

---

## 4. The fifteen-minute demo, on your own machine

This is the sequence to walk a prospect through. It works on the seeded data as-is.

1. Sign in as **worker@** → **Report** → file a hazard. Note the reference number.
2. Sign in as **hse@** → **Events** → open `INC-2026-0001` (the scaffold fall).
3. Show the **investigation** → the **5 Whys** chain running from "he fell" down to
   "the procedure has no inspection step."
4. Open one of its **actions** → show owner, deadline, and the hierarchy-of-control level.
5. Try to verify an action you own — the system refuses. **This is the moment that lands.**
6. Back on the event → **Download evidence pack (PDF)**. That is the audit artifact.
7. **Dashboard** → overdue actions, leading:lagging ratio, strong-controls share.

---

## 5. Useful commands

| What you want | Command |
|---|---|
| Start the app | `pnpm dev` |
| Stop it | Ctrl+C in that terminal |
| Run the tests | `pnpm test` |
| Walk the whole safety loop automatically | `BASE=http://localhost:3000 python3 scripts/demo-loop.py` |
| Check a deployment is safe | `BASE=https://your-app.vercel.app bash scripts/preflight.sh` |
| Get the latest changes | `git pull` |
| Reset the local database | `docker compose -f docker/compose.yml down -v` then `up -d` again |

---

## 6. When something goes wrong

**"command not found: pnpm"**
Run `npm install -g pnpm`. If that fails on Mac, try `sudo npm install -g pnpm`.

**"Can't reach database server"**
Option A: your `DATABASE_URL` is wrong, or Neon has paused the database — open the Neon
dashboard and it wakes up. Option B: Docker Desktop is not running. Open it and wait for the
whale icon to stop animating.

**The page loads but sign-in says "Incorrect email or password"**
The demo password hashes are not in the database. Run `node scripts/set-demo-passwords.mjs`.

**"Sign in to continue" on every page, even after signing in**
Your browser is blocking the cookie. Use `http://localhost:3000`, not `http://127.0.0.1:3000` —
they are treated as different sites.

**Everything loads but every list is empty**
This is the important one. It almost always means the app is connected to the database as the
wrong user and row-level security is returning nothing. Check `DATABASE_URL` uses
**`safesphere_app`**, and visit http://localhost:3000/api/health — `tenancy` should read
`"ok": true`.

**Port 3000 is already in use**
`PORT=3001 pnpm dev`, then open http://localhost:3001.

---

## 7. What NOT to do

- **Do not commit your `.env` file.** It is already ignored by git; leave it that way.
- **Do not use the demo passwords on a public URL.** Change or remove those users first.
- **Do not connect the app as the database owner** in anything but local development. It disables
  tenant isolation completely, and nothing about the running app will look wrong.

# Infrastructure

How the YoHoBed 2.0 testing server is built, deployed, and recovered.

## Why this exists

On 2026-07-27 the OVH VPS was reinstalled from the control panel. The whole server —
stack, nginx config, TLS certificate, PM2 setup, the database with every tester's
data, the generated secrets in `production.env`, and the uploaded media — was gone in
one click. None of it existed anywhere but on that disk, because the original build
had been done by hand over SSH.

The code was safe in git. Nothing else was. These scripts close that gap: the server
is now reproducible from the repository, and the parts that can't be (data, secrets,
uploads) are backed up nightly.

## Layout

| Path | Purpose |
|---|---|
| `provision.sh` | Bare Ubuntu 24.04 → full running stack. Idempotent. |
| `deploy.sh` | Pull, build, migrate, reload. Installed at `/srv/yohobed/deploy.sh`. |
| `backup.sh` | Nightly `pg_dump` + env/media archive, optional off-box copy. |

Server layout:

```
/srv/yohobed/
├── app/                  git checkout (owned by yoho)
├── env/production.env    generated secrets, 640 root:yoho
├── media/                uploaded photos
├── backups/              nightly dumps, 700
├── deploy.sh
└── backup.sh
```

## First build on a fresh box

```bash
# as root on a clean Ubuntu 24.04 host
git clone https://github.com/<org>/YoHo-Bed-2.0.git /tmp/yohobed
cd /tmp/yohobed/yohobed2/infra
DOMAIN=yova.markui.lk LETSENCRYPT_EMAIL='you@example.invalid' ./provision.sh
```

Then give the `yoho` user a GitHub deploy key so it can clone the private repo:

```bash
sudo -u yoho ssh-keygen -t ed25519 -f /home/yoho/.ssh/id_ed25519 -N ''
sudo -u yoho cat /home/yoho/.ssh/id_ed25519.pub    # add as a read-only deploy key on GitHub
sudo -u yoho git clone "git@github.com:${GITHUB_ORG}/YoHo-Bed-2.0.git" /srv/yohobed/app
/srv/yohobed/deploy.sh
```

Seed demo data **once**, on a fresh database only:

```bash
sudo -u yoho bash -lc 'set -a; source /srv/yohobed/env/production.env; set +a
  cd /srv/yohobed/app
  pnpm --filter @yohobed/db db:seed
  DEMO_API_URL=http://localhost:3001 DEMO_TODAY=$(date +%F) node scripts/demo-data.mjs'
```

## Routine deploy

```bash
git push origin main
ssh yoho-vps '/srv/yohobed/deploy.sh'
```

## Traps worth knowing

**`NEXT_PUBLIC_API_URL` is inlined at build time.** `apps/web-extranet/lib/api.ts`
falls back to `http://localhost:3001`. Build the web app without sourcing
`production.env` and that fallback is baked into the client bundle: every browser
request fails while `curl` against the API still looks perfectly healthy. `deploy.sh`
sources the env and then greps `.next/static` to prove the string isn't there.

**Pre-create `yoho_app` before the first migrate.** `packages/db/src/rls.sql` creates
the role with the dev password `yoho_app_pw` if it doesn't already exist.
`provision.sh` creates it first with a generated password.

**`git` in `/srv/yohobed/app` is owned by `yoho`.** Run git as `yoho`, or pass
`-c safe.directory=/srv/yohobed/app`.

**Deploys never seed.** `db:seed` and `demo-data.mjs` are destructive. `deploy.sh`
deliberately omits them so a routine deploy can't wipe tester data.

**Don't lock yourself out.** Keep an SSH key on both `ubuntu` and `root`, and use a
key with no passphrase for automation — a passphrase-protected key fails
non-interactively in a way that looks identical to a key that isn't installed.
OVH images also ship `ubuntu` with a pre-expired password that blocks *all* sessions,
including non-interactive ones, until it's changed on a PTY.

## Backups

Nightly at 02:15 via `/etc/cron.d/yohobed-backup`, retained 14 days.

Set an off-box target, otherwise the backups die with the server they protect:

```bash
echo 'BACKUP_REMOTE=backups@elsewhere:/srv/yohobed-backups' > /etc/default/yohobed-backup
```

Restore:

```bash
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" db-STAMP.dump
tar xzf files-STAMP.tar.gz -C /srv/yohobed
```

## Recovering from a wipe

1. Reinstall Ubuntu 24.04 from the OVH panel, attaching a **passphrase-less** SSH key.
2. Run `provision.sh` as above.
3. Restore the latest `db-*.dump` and `files-*.tar.gz` **before** the first deploy —
   `files-*.tar.gz` contains `production.env`, and restoring it keeps the existing
   database passwords consistent with the restored database.
4. `/srv/yohobed/deploy.sh`.
5. Confirm TLS: `certbot certificates`.

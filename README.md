# Propuskator — Access-Control System (Deployment Kit)

Docker Compose deployment for the [Propuskator](https://hub.docker.com/u/propuskator)
access-control system (MQTT + MySQL + backend + web UI + Modbus bridge + camera
streaming + backup + optional integrations).

> **Why this repo exists.** The upstream Propuskator project has been
> unmaintained since late 2023 (last image push: 2023-11-09; no public source
> code repositories left online). This repo bundles the working compose
> configuration from a production install, together with mirror copies of all
> Docker images under `uvarovo/propuskator-*` on Docker Hub and
> `ghcr.io/uvarovo/propuskator-*`, so new deployments keep working regardless
> of what happens to the upstream `propuskator` Docker Hub namespace.
>
> **No source code is available.** Only runtime images. This is a *deployment
> kit*, not a development kit.

---

## Quick start on a fresh Linux machine

Tested on Ubuntu 20.04 / 22.04 / 24.04 (clean VM, root or sudo user).

```bash
git clone https://github.com/uvarovo/propuskator.git
cd propuskator
cp .env.sample .env && $EDITOR .env       # set passwords, TIMEZONE, API_URL, DNS, etc.
./install.sh                               # or: ./install.sh modbus all
```

`install.sh` is idempotent: it installs Docker + the Compose plugin if
missing, creates `system/*` volume directories, copies `.env.sample` → `.env`
on first run, then does `docker compose pull && docker compose up -d`.

After ~2 minutes (first-run image pull takes ~1.5 GB):

- Web UI:  `http://<host>/`  or  `https://<host>/` (self-signed cert generated automatically)
- Backend API: `http://<host>:8000/api/v1/admin/`
- MQTT: `<host>:1883` (plain) / `8883` (TLS)

Default admin credentials are printed to `docker compose logs access-backend`
on first boot (look for "admin created").

---

## Requirements

- Linux x86_64 host with docker ≥ 20.10 and the docker compose plugin.
  `install.sh` will install them for you if absent.
- ≥ 4 GB free disk (images ~1.5 GB, plus MySQL/MinIO/media growth).
- Ports 80, 443, 1883, 8000, 8883, 9000 free (all configurable — see
  [`.env.sample`](.env.sample)).
- Outbound access to `docker.io` (or `ghcr.io`) for image pulls.

---

## Manual setup (if you don't want to run `install.sh`)

```bash
git clone https://github.com/uvarovo/propuskator.git
cd propuskator
cp .env.sample .env
cp .env_modbus.sample .env_modbus      # only if you're deploying the modbus bridge
$EDITOR .env                           # REPLACE every SUPER_SECRET / passw0rd with real values

# absolute path is required for bind-mounts
sed -i "s|^ROOT_DIR=.*|ROOT_DIR=$(pwd)|" .env

mkdir -p system/{mysql,minio,media,storage,backups,keys,releases,shared/nginx,ssl/{certs,private},emqx/data/mnesia,updater}

docker compose pull
docker compose up -d
docker compose ps
```

### With the Modbus bridge

```bash
docker compose -f docker-compose.yml -f docker-compose.modbus.yml up -d
```

Edit `.env_modbus` first — at minimum set `MODBUS_DRIVER_TCP_HOST`,
`MODBUS_DRIVER_TCP_PORT` (or `MODBUS_DRIVER_TYPE=serial` + `MODBUS_DEVICE`),
`BRIDGE_ID`, `SERVICE_TOKEN` (must match `MODBUS_SERVICE_TOKEN` in `.env`),
and `TOKEN` / `WORKSPACE_*`.

### Optional integrations

| File | Adds | Required env |
|------|------|--------------|
| `docker-compose.phones.yml` | Phone-trigger webhook + handler | `READER_PHONE_NUMBERS`, `PHONE_TRIGGER_WEBHOOK_AUTH_PASSWORD` |
| `docker-compose.telegram-bot.yml` | Telegram notifications bot | `TELEGRAM_BOT_TOKEN` |
| `docker-compose.google-home.yml` | Google Home integration | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_PROJECT_ID` |
| `docker-compose.certs.yml` | Use custom SSL cert instead of self-signed (expects `system/uvarovo_ssl/*`) | — |

Chain them with `-f`:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.modbus.yml \
  -f docker-compose.telegram-bot.yml \
  up -d
```

---

## Services

| Service | Image | Purpose |
|---------|-------|---------|
| `access-nginx` | `uvarovo/propuskator-nginx-service:release` | reverse proxy, serves UI and /api |
| `access-ui` | `uvarovo/propuskator-ui:release` | web frontend (admin panel) |
| `access-backend` | `uvarovo/propuskator-backend:release` | Node.js API (REST + MQTT commands + streams) |
| `access-percona` | `uvarovo/propuskator-percona-service:release` | MySQL-compatible database |
| `access-emqx` | `uvarovo/propuskator-emqx-service:release` | MQTT broker (EMQX, with MySQL auth) |
| `access-mqtt-proxy` | `uvarovo/propuskator-mqtt-proxy:release` | MQTT adapter between readers and backend |
| `access-heartbeat` | `uvarovo/propuskator-heartbeat:release` | device online/offline watcher |
| `access-streamming-service` | `uvarovo/propuskator-streamming-service:release` | RTSP → HLS camera stream server |
| `cameras-media-collector` | `uvarovo/propuskator-cameras-media-collector:release` | collects camera frames/clips for access logs |
| `access-minio` | `uvarovo/propuskator-minio-service:release` | S3-compatible blob storage for media |
| `access-minio-client` | `uvarovo/propuskator-minio-client-service:release` | one-shot bucket provisioner |
| `access-backups` | `uvarovo/propuskator-backups:release` | periodic MySQL + storage backups, optional GPG + DO Spaces upload |
| `access-updater` | `uvarovo/propuskator-updater:release` | in-place release updates from a private registry (off by default) |
| `access-updater-manager` | `uvarovo/propuskator-updater-manager:release` | helper container that restarts updater |
| `ssl-certs` | `uvarovo/propuskator-ssl-certs-service:release` | generates self-signed certs on first run |
| `modbus` | `uvarovo/propuskator-modbus-bridge:release` | Modbus ↔ MQTT bridge (opt-in) |

All `uvarovo/propuskator-*:release` images are also published to
`ghcr.io/uvarovo/propuskator-*:release`. To switch, search-and-replace
`docker.io/uvarovo/` → `ghcr.io/uvarovo/` in the compose files.

---

## Image mirroring

All runtime images originate from the upstream (abandoned)
`propuskator/*` namespace on Docker Hub. They are re-published here under
`uvarovo/propuskator-*` via the
[`mirror-images.yml`](.github/workflows/mirror-images.yml) GitHub Actions
workflow.

To re-run the mirror (e.g. to republish before the upstream disappears, or to
add a new immutable tag):

1. Go to **Actions → "Mirror upstream images to uvarovo/propuskator-*"**.
2. Click **Run workflow**.
3. Optionally set `tag` input (e.g. `2026-04-19`) to publish a dated, immutable
   tag alongside `:release`.

The workflow needs these org/repo secrets (already configured in `uvarovo`):

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

GHCR auth uses the built-in `GITHUB_TOKEN` with `packages: write` permission.

---

## Configuration reference

Every variable in [`.env.sample`](.env.sample) is documented inline. The ones
that _must_ be changed for a real deployment:

| Variable | Why |
|----------|-----|
| `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_ROOT_PASSWORD` | Database credentials |
| `MQTT_ROOT_USERNAME` / `MQTT_ROOT_PASSWORD` | MQTT broker admin |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | MinIO (S3) credentials |
| `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET` / `ADMIN_PASSWORD_RESET_TOKEN_SECRET` / `MOBILE_PASSWORD_RESET_TOKEN_SECRET` | JWT secrets (use `openssl rand -hex 32`) |
| `MODBUS_SERVICE_TOKEN` | Must match `SERVICE_TOKEN` in `.env_modbus` |
| `API_URL` / `DNS` | Public URL of the backend (used by the UI) |
| `TIMEZONE` | IANA TZ, e.g. `Europe/Kiev` |
| `ROOT_DIR` | **Absolute** path to this repo's checkout (used for bind-mounts) |
| `MAIL_OPTIONS_*` | SMTP for password-reset / alert emails |
| `READER_PHONE_NUMBERS` | Phone numbers allowed to trigger access via call |

Leave the "Optional / advanced" block at the bottom of `.env.sample`
commented out unless you need the feature (DO Spaces backups, Google Home,
custom SSL, self-hosted updater registry, …).

---

## Backups

`access-backups` runs daily (`BACKUP_DAILY=1`), weekly, and monthly MySQL
dumps into `system/backups/`. If `UPLOAD_BACKUPS_TO_DO=1`, they're also
uploaded to a DigitalOcean Space.

For GPG-encrypted backups: place a PGP public key at
`system/keys/public_key.gpg` and set `ENCRYPT_KEYS_EMAIL` in `.env` to the
key's email. The private key (for decryption) is your responsibility — keep
it **out of this repo**; `system/keys/*.gpg` is in `.gitignore`.

---

## Patched backend image (optional)

A community-patched build of the backend is published as
`uvarovo/propuskator-backend:release-patched` (and `ghcr.io/uvarovo/propuskator-backend:release-patched`).
It applies several small fixes on top of the stock upstream backend:

- **Transaction propagation.** `findOne({...}, { transaction })` was being
  called with the transaction as a 2nd arg — ignored by Sequelize. Fixed in
  `services/mobile/accessSubjectTokens/{AttachWithId,AttachWithName,Detach}.js`
  and `services/admin/accessSubjectTokens/BulkCreate.js`. Closes a TOCTOU race
  when two clients attach the same token concurrently.
- **Workspace-scoped access-log total.** `AccessLogList` used a bare
  `AccessLog.count()` without a `workspaceId` filter, which both leaked the
  global row count and forced a full table scan. Now scoped to the caller's
  workspace.
- **S3 rollback errors no longer silently swallowed** in
  `services/tokenReader/v1/accessLogs/Save.js` — failures in the media-upload
  rollback path now get logged.
- **Timezone validator accepts IANA names.** `services/utils/timezones.js` now
  recognises common IANA names (`Europe/Kiev`, `Europe/Kyiv`, `Etc/UTC`,
  `UTC`, `GMT`, ...) in addition to the Windows-style `(UTC…) …` labels. The
  stock UI registration form sends IANA, so the stock combination was broken
  out of the box.
- **N+1 micro-fix.** `BulkCreate` no longer wraps a single condition in
  `[Op.or]`.

Operationally, besides the backend patch, also run these two indexes on
MySQL to make the admin list queries fast on populated databases — the stock
schema is missing them:

```sql
ALTER TABLE accesslogs    ADD INDEX idx_ws_created (workspaceId, createdAt);
ALTER TABLE notifications ADD INDEX idx_ws_created (workspaceId, createdAt);
```

### Using the patched image

Overlay `docker-compose.patched.yml` on top of the base compose file:

```bash
docker compose -f docker-compose.yml -f docker-compose.patched.yml up -d
```

The overlay only swaps the `access-backend` image; everything else is
unchanged. To go back to the stock image just drop the `-f
docker-compose.patched.yml` argument.

### Rebuilding the patched image

The patch sources live in `patches/backend/`. A `Dockerfile` there overlays
the patched files on top of `uvarovo/propuskator-backend:release`. Rebuild
with:

```bash
cd patches/backend
docker build -t uvarovo/propuskator-backend:release-patched \
  --build-arg BASE_IMAGE=uvarovo/propuskator-backend:release .
```

Or trigger `build-patched-backend.yml` from the Actions tab to publish to
Docker Hub + GHCR.

---

## Upgrading

Pull new `:release` images and re-create containers:

```bash
docker compose pull
docker compose up -d --remove-orphans
```

Because `:release` is a rolling tag, if you want a specific pinned version,
run the mirror workflow with an immutable tag (e.g. `2026-04-19`), then
replace `:release` with `:2026-04-19` in the compose files.

---

## Troubleshooting

**Services stuck in `starting` / `restarting`.**  Check
`docker compose logs <service>`. Typical causes: MySQL not yet initialized
(first boot takes 30-60 s), EMQX failing to connect to MySQL
(check `MYSQL_*` vars), nginx waiting for `ssl-certs` to finish generating.

**`Error response from daemon: manifest unknown` on pull.**  The upstream
`propuskator/*` namespace was taken down. Re-run the
`mirror-images.yml` workflow from a machine that still has cached images, or
re-build from source if source becomes available.

**Port already in use.**  Set `NGINX_HTTP_PORT`, `NGINX_HTTPS_PORT`,
`EMQX_TCP_PORT`, `EMQX_TCP_SSL_PORT` in `.env` to free ports.

**Login to MinIO web console.**  `http://<host>:9000/` with
`MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` from `.env`.

---

## License

[MIT](LICENSE). This repo contains only deployment configuration; the Docker
images it pulls are redistributions of the upstream `propuskator/*` images
whose original license is not published. They are re-hosted under a
best-effort "keep-working" clause, not claimed as original work.

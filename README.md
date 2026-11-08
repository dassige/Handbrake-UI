# HandBrake Queue (Handbrake-UI)

A small web UI that turns a headless Linux box into a HandBrake conversion
server. Pick files and folders that are already on the server, drag them into
a queue, and they are converted with presets exported from the HandBrake
desktop app.

It is not affiliated with the HandBrake project. It runs the official
`HandBrakeCLI`, so the results match what the desktop app produces with the
same preset.

## Features

- **Presets from the desktop app.** In HandBrake, use Presets → Export, then
  upload the `.json` here. Files with several presets or folders are supported.
- **Server-local files.** Nothing is uploaded or downloaded. You browse a
  configured *sources* folder (local disk, NFS or SMB mounts…) and results are
  written to a configured *target* folder.
- **Drag and drop.** Drag files or whole folders from the source browser into
  the queue. Folders add every video inside, recursively, skipping files that
  are already converted or match an exclude word such as `sample`.
- **Queue management:**
  - live progress, fps and ETA
  - pause/resume and cancel
  - reorder by dragging
  - retry, or "convert again" with another preset
  - per-job details: source tracks, sizes, compression, encode time and the
    full HandBrake log
- **Safe output.** Each encode is written to `name.mkv.part` and renamed when it
  finishes, so media servers never pick up half-written files. Existing
  files are never overwritten: the new file gets a suffix, `name (1).mkv`.
- **Output layout** (setting): `target/<source folder>/file`, the full source
  path mirrored, or everything flat in the target folder.
- Sources are never modified or deleted.
- Survives restarts. A job that was interrupted goes back to the queue.
  HandBrake cannot resume an encode from the middle, so that job starts again
  from 0%.

## Run with Docker Compose

```bash
git clone <this repo> handbrake-ui && cd handbrake-ui
cp .env.example .env      # set PUID/PGID, MEDIA_DIR, SOURCE_ROOT, TARGET_ROOT
docker compose up -d --build
```

Open `http://<server>:8095`, upload a preset (**Presets**), check the folders
in **Settings**, then drag files into the queue.

| `.env` | Meaning |
|---|---|
| `PUID` / `PGID` | User the container runs as; output files are owned by it |
| `MEDIA_GID` | Extra group, for shares that grant access by group; Synology NFS uses `users` (100). Symptom when missing: "permission denied" on a folder the host user can open |
| `MEDIA_DIR` | Host folder bind-mounted at the same path inside the container (default `/mnt`) |
| `SOURCE_ROOT` / `TARGET_ROOT` | Initial folders, changeable later in the UI. They must be inside `MEDIA_DIR` |
| `RENDER_GID` | Group of `/dev/dri/renderD128` on the host, for Intel Quick Sync |
| `PORT` | Web UI port (default 8095) |

The database, logs and presets live in `./data`.

### Hardware encoding

The image uses Ubuntu 26.04's `handbrake-cli`, which includes Intel Quick
Sync (oneVPL). The encoder always comes from your preset; `qsv_h264` /
`qsv_h265` presets need `/dev/dri` passed through. Ubuntu 26.04 only ships the
VPL GPU runtime, which supports Intel Tiger Lake (11th gen) and newer. Older
iGPUs, such as Comet Lake UHD 620, can only use software encoders like x264
and x265. If the host has no `/dev/dri`, remove the `devices` and `group_add`
blocks from `docker-compose.yml`.

## Development

```bash
cd server && npm install && SOURCE_ROOT=/some/dir TARGET_ROOT=/other/dir npm run dev   # API on :8095
cd web && npm install && npm run dev                                                   # UI on :5173
cd server && npm test
```

The server needs `HandBrakeCLI` on the `PATH` (or `HANDBRAKE_CLI=/path/to/it`)
to scan and encode; everything else works without it.

**Stack:** Node 24 + Fastify, built-in `node:sqlite`, Server-Sent Events for
live updates; React + Vite for the UI. One container, no external database.

`scripts/deploy.sh [ssh-alias] [remote-dir]` copies the project to a Docker host
over SSH and runs `docker compose up -d --build` there.

# Handbrake-UI — plan

A headless HandBrake queue with a web UI. It runs as one Docker container on
asus-serv-1, converts videos from server-local folders using presets exported
from the HandBrake desktop app, and writes the results to a server-local
target folder.

## Decisions (agreed 2026-11-09)

| Topic | Decision |
|---|---|
| Engine | `HandBrakeCLI` from Ubuntu 26.04 (`handbrake-cli` 1.11.0, built with Intel QSV/VPL). Same libhb as the desktop app, same preset JSON. |
| Deploy | Docker + docker compose (`~/SW/handbrake-ui` on asus-serv-1). One container: Node service + HandBrakeCLI. |
| Stack | Node 24, Fastify, built-in `node:sqlite`, Server-Sent Events. React + Vite UI, served by the same process. Port **8095**. |
| Access | LAN only, no login. |
| Roots | Source and target roots are user settings (initial: `/mnt/downloads`, `/mnt/multimedia-volume1/~tmp/converted`). |
| Output layout | User setting: `parent` (target/<source folder name>/file), `mirror` (full relative path), `flat`. |
| Name collision | Add a suffix: `name (1).mkv`. Resolved when the job starts. |
| Sources | Never modified or deleted (deluge may still be seeding). Converted files are marked in the UI. |
| Encoder | Whatever the preset says. gerry preset = x264 fast, 1500 kbps avg, ≤1280×720, PFR 30, MKV, AAC stereo 160k. |
| Concurrency | One job at a time. |

## Findings

- asus-serv-1: i3-10110U (2C/4T), 7 GB RAM, Ubuntu 26.04. NFS mounts already
  present: `/mnt/downloads` (rasp-serv-1, automount) and
  `/mnt/multimedia-volume1` (Synology, also read by kogan-emby).
- gerry preset on a 1080p HEVC source: ~31 fps (≈1.2× real time) on CPU.
- Quick Sync does **not** work on this CPU with Ubuntu 26.04: only the
  `libmfx-gen` runtime (Tiger Lake and newer) is packaged; the legacy runtime
  for Gen9 GPUs is gone. The image still ships QSV support for newer Intel CPUs.

## Behaviour

- Encode to `<final>.part` with an explicit `-f <format>`, then rename on
  success, so Emby never sees partial files. Partial files are deleted on failure,
  cancel or restart.
- Pause = SIGSTOP/SIGCONT. HandBrake cannot resume from the middle of an
  encode, so a job that was running or paused when the service restarted goes
  back to the queue and starts from 0%.
- Each job keeps a snapshot of its preset, so later preset changes or deletions
  don't affect queued jobs.
- Source info comes from a `HandBrakeCLI --scan --json` run when the job is added.
- Full HandBrake log per job.

## Phases

0. Server prep — Docker installed; container recipe and encode verified. ✅
1. Backend — settings, presets, browse, queue worker, HandBrake runner, SSE. ✅
2. UI — source browser with drag & drop, queue, job details and log, presets, settings. ✅
3. Deploy — Dockerfile, compose, deploy script, README. ✅ Running on
   asus-serv-1 (`~/SW/handbrake-ui`, http://10.1.1.115:8095). The container
   needs the `users` group (`MEDIA_GID=100`) to write to the Synology NFS share.
4. Later (optional) — watch folder, Emby library refresh, notifications
   (n8n / Home Assistant), output renaming (see `AdvancedRenamer/`).

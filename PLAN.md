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
| Sources | Never modified (deluge may still be seeding). Deleted only on request, after a confirmation (round 4). Converted files are marked in the UI. |
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
4. Rename (2026-11-09) ✅ — Rename view for files in the target folder.
   - Decisions: real apostrophes (`L'Osservatore`); no year in show names unless
     the "keep year" option is on (remakes); name collisions get `_1`;
     automatic rename after conversion is opt-in (off by default); no moving
     into the Emby library (stays manual).
   - Rule sets are ordered steps. Advanced Renamer methods are imported from
     `.aren` (both templates import with all 51 and 11 steps). The smart
     "recognise episode/movie" step uses templates
     `{show} S{season}e{episode}[ - {title}]` / `{title}[ ({year})]`.
   - On the 309 file names in /mnt/downloads, 289 come out right with no help,
     3 need the show name typed (`S04E07 Reacher …`) and 17 have no standard
     pattern (Live Aid DVD clips, movies without a year).
   - The typed show name only fills rows with no detected show, unless "for all
     rows" is chosen.
5. Round 3 (2026-11-09) ✅
   - The queue never starts by itself. Default `queueRunning: false`, and the
     queue stops when it runs empty. A run that was going when the server
     restarted continues after the restart.
   - Check after conversion (`server/src/verify.js`, setting `verifyMode`,
     default `full`). It uses ffprobe/ffmpeg, which are added to the image. It
     reads the real stream ends with a full packet read, because metadata
     claims the full length even on truncated files. It compares the audio and
     subtitle counts against HandBrake's log, and optionally does a full decode
     (filtering the null muxer's `[null @…]` timestamp messages).
     - Tested with the real tools on a 60 s encode: a good file passes; a
       truncated, corrupted copy fails (37.9 s short); a copy with one audio
       track removed fails.
   - In-app help ported from dgsoft-image-manager: `web/src/help/` (help.json,
     Help.jsx, search.js) and `server/test/help.test.js`.
6. Merge (2026-11-09) ✅ — `server/src/merge.js`, Merge tab.
   - Uses mkvmerge (mkvtoolnix, added to the image). A plain append keeps every
     part's chapters, shifted to where the part starts, but leaves duplicate
     "Chapter 1" titles. `--generate-chapters when-appending` adds nothing
     when the parts already have chapters. So the app builds the chapter XML
     itself: each part's length from `mkvmerge -J` plus the chapters from
     ffprobe, passed with `--no-chapters` on each part and `--chapters`.
   - mkvmerge only warns (exit 1) when the track layouts differ, so the app
     checks compatibility first. Different track counts, codecs or audio
     format are errors; a different picture size, codec private data or
     language are warnings.
   - Tested end to end on asus-serv-1:
     - two 40 s parts → 3 chapters at the right times;
     - the custom title is kept and the generic one renumbered;
     - length 1:21.206 = 40.958 + 40.248 s;
     - the check passes;
     - an incompatible clip is blocked.
7. Round 4 (2026-11-10) ✅
   - Several sources folders (`sourceRoots`; the old `sourceRoot` setting is
     migrated on start). A file's output path is worked out from the sources
     folder it is in. Sources folders cannot be nested, and the target cannot be
     inside one.
   - Upload (`server/src/upload.js`): 32 MB chunks via `PUT /api/upload`
     (raw body, streamed to disk). Each chunk is appended to a hidden
     `.name.size.hbui-upload` file in the destination folder, so the rename at
     the end stays on one filesystem. The size on disk is the resume point.
     Existing names are never replaced (`name (1)`). Partial files are tracked
     in the `uploads` table and removed after 7 days. Free space is checked
     first (`fs.statfs`).
   - Quality check (`server/src/quality.js`): one ffprobe header read per file
     (sequential, at the nice level), stored in `quality_scans` (last 20 kept).
     The results are evaluated when they are read, so changing the criteria
     (setting `quality`) needs no new scan. The resolution class uses
     max(height, display width × 9/16), so cropped widescreen keeps its class.
     The bitrate comes from the stream, then the mkvmerge `BPS` tag, then an
     estimate from the file size.
   - Download (`server/src/download.js`): `GET /api/download?path=` for one
     file (Range / If-Range, ETag), `POST /api/download/zip` + `GET
     /api/download/zip/:id` for folders or several files. The ZIP writer is
     built in: stored entries, data descriptors, UTF-8 names, ZIP64 where a
     size or offset passes 4 GB, CRC via `zlib.crc32`, exact Content-Length
     from `planZip`. Checked with Python's `zipfile` on a 4.8 GB archive.
     Tokens live in memory for 6 h. Hidden and `.part` files are left out.
   - Delete (`server/src/deleteFiles.js`), on request (2026-11-10): files and
     folders under a sources folder only, never a root or the target. Files
     with queued/running/paused jobs, or folders containing one, are refused.
     `POST /api/files/delete/preview` gives the counts for the confirmation;
     `POST /api/files/delete` checks everything again before `fs.rm`. This
     replaces the earlier rule that sources are never deleted. Sources folders
     can be marked protected (setting `protectedRoots`, a subset of
     `sourceRoots`): nothing in them can be deleted.
   - Backup/restore (`server/src/backup.js`, `zipReader.js`): the backup is
     `VACUUM INTO` (a consistent copy while running) plus `manifest.json` and
     optional `logs/`, zipped with the download writer. Restore ATTACHes the
     backup and copies the shared columns table by table in one transaction,
     so older backups (missing columns or tables) work and no restart is
     needed. Afterwards Settings reloads (`settings.reload()`); for "all", the
     logs are swapped and the queue, merge and quality recovery run. A
     `before-restore-*.zip` is always saved first. The reader handles stored
     and deflated entries and ZIP64.
   - Deploy from git (`scripts/deploy.sh`): asus-serv-1 has a read-only GitHub
     deploy key (`~/.ssh/handbrake-ui-deploy`, used only through
     `core.sshCommand` of the checkout). The script deploys the pushed commit
     of `origin/main`, never the local working copy.
   - All `window.confirm` calls replaced by `components/Dialogs.jsx`
     (`confirm` / `prompt` / `choose` / `alert`, Promise based).
8. Later (optional) — watch folder, Emby library refresh, notifications
   (n8n / Home Assistant).

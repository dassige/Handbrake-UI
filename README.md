# HandBrake Queue (Handbrake-UI)

A small web UI that turns a headless Linux box into a HandBrake conversion
server. Pick files and folders that are on the server (or upload them from your
computer), drag them into a queue, and they are converted with presets exported
from the HandBrake desktop app.

It is not affiliated with the HandBrake project. It runs the official
`HandBrakeCLI`, so the results match what the desktop app produces with the
same preset.

## Features

- **Presets from the desktop app.** In HandBrake, use Presets → Export, then
  upload the `.json` here. Files with several presets or folders are supported.
- **Server-local files.** You browse one or more configured *sources* folders
  (local disk, NFS or SMB mounts…) and results are written to a configured
  *target* folder.
- **Upload from your computer.** **Upload** in the Sources panel (or dropping
  files from your computer onto it) sends videos into the open folder, or into
  a new sub-folder. Files go in 32 MB chunks with automatic retries. An
  interrupted upload continues where it stopped when the same file is sent to
  the same folder again. Existing files are never replaced: skip them or upload
  a copy named `name (1)`. Unfinished uploads are hidden
  `.name.size.hbui-upload` files, removed after a week.
- **Download to your computer** from any sources folder or the target folder
  (every folder panel, plus "download converted file" in the job details). A
  single file is sent as is, with HTTP Range support, so the browser can pause
  and resume it. Folders, or several files, come as one ZIP built on the fly.
  Files are stored without compression and ZIP64 is used for files over 4 GB.
  The exact size is sent up front, so the browser shows progress. Several
  files can also come as separate downloads.
- **Quality check** view: reads every video in the chosen folders (sources or
  target, sub-folders included) with ffprobe and lists the files with an old
  container or codec (AVI, DivX/Xvid, MPEG-2, WMV, RealVideo…), a low
  resolution or a low video bitrate for their resolution. HEVC/AV1/VP9 get a
  lower bitrate minimum. The criteria are in Settings and apply to existing
  results straight away. Flagged files can be added to the queue or exported as
  CSV.
- **Backup and restore** (Settings → Backup and restore…): a ZIP holding the
  database (settings, presets, rename rules, jobs, histories, merges, quality
  results) and optionally the job logs; never video files. It can be downloaded
  or saved on the server (`data/backups`, newest 10 kept). A restore replaces
  either the configuration only or everything. It runs live, with no restart,
  and saves the current data first so it can be undone. It never starts the
  queue, and "everything" is refused while something is running.
- **Custom dialogs.** Every question (confirm, name prompts, conflicts) is an
  in-app dialog, never the browser's own pop-ups.
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
- **Manual start.** Adding files never starts converting; press **Start**. The
  queue stops by itself when the last job is done.
- **Safe output.** Each encode is written to `name.mkv.part` and renamed when it
  finishes, so media servers never pick up half-written files. Existing
  files are never overwritten: the new file gets a suffix, `name (1).mkv`.
- **Check after conversion** (setting: Full, Quick or Off). Each output is
  checked before the job counts as converted:
  - It must be readable and have a video stream.
  - Its real length, measured by reading the whole file, must match the source.
  - It must have every audio and subtitle track HandBrake wrote (taken from its
    log), and every audio track must last as long as the video.
  - In **Full** mode, every video and audio frame must decode without errors
    (about 1–2 minutes per 45-minute episode).

  Results show as **Checked**, **Check warnings** or **Check failed**, with
  details per job and a **Check again** button.
- **Merge** view: joins converted files into one MKV with mkvmerge. There is no
  re-encode, so it takes about as long as copying the files.
  - Put the parts in order by dragging.
  - Each part's chapters are kept and moved to where that part starts in the
    merged file. HandBrake's generic "Chapter N" names are renumbered, and a
    part without chapters gets one named after its file. You can also choose
    one chapter per part instead.
  - A compatibility check first blocks parts with different tracks, and warns
    about a different picture size or encoder settings.
  - The merged file is checked like a conversion: its length must be the parts
    added together.
  - Optionally, the parts are deleted after a successful merge.
- **In-app help:** a round **?** next to every page, panel, section and
  setting, plus **Help** search in the top bar. The content lives in
  `web/src/help/help.json`; `server/test/help.test.js` checks that every `?` has
  a topic and that every link works.
- **Rename** view for converted files:
  - Recognises TV episodes (`S01E02`, `1x02`) and movies (title + year).
  - Drops release tags (`1080p`, `WEB-DL`, `x265`, `ITA`…) and builds names from
    templates: `Show S01e02 - Episode title`, `Movie Title (2020)`.
  - Fixes apostrophes: `L Uomo` → `L'Uomo`.
  - Preview before applying: edit any name by hand, or type a show name for files
    that have none.
  - Undo any batch from History.
  - Rule sets work like Advanced Renamer methods (replace, remove pattern, add,
    move, trim, case…). You can edit them, export them, and import Advanced
    Renamer `.aren` presets.
  - Optional automatic rename after each conversion. It only renames files the
    rules recognise without warnings; the rest are flagged "Needs rename".
- **Output layout** (setting): `target/<source folder>/file`, the full source
  path mirrored, or everything flat in the target folder.
- Sources are never modified. They are deleted only when you ask: **Delete** in
  the Sources panel shows exactly what will go (files, sizes, folder contents)
  and asks first. Refused: files that are queued or converting, the sources
  folders themselves, anything in the target folder, and anything in a sources
  folder marked **Protect** in Settings (e.g. one a download client seeds from).
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
| `SOURCE_ROOT` / `TARGET_ROOT` | Initial folders, changeable later in the UI (where more sources folders can be added). They must be inside `MEDIA_DIR` |
| `RENDER_GID` | Group of `/dev/dri/renderD128` on the host, for Intel Quick Sync |
| `PORT` | Web UI port (default 8095) |

The database, logs and presets live in `./data`.

### Hardware encoding

The image builds `HandBrakeCLI` from the upstream source (version set by
`HANDBRAKE_VERSION` in the `Dockerfile`), with Intel Quick Sync on amd64.
Ubuntu's own `handbrake-cli` package can't be used for Quick Sync: it links the
system FFmpeg, which lacks HandBrake's QSV patches, so every `qsv_*` encode fails
in the muxer. The first build compiles HandBrake and its bundled libraries
(about 45-60 minutes on a 4-thread CPU). Docker caches that step, so later
builds skip it until the version changes.

The encoder always comes from your preset; `qsv_h264` / `qsv_h265` presets need
`/dev/dri` passed through. Both Intel runtimes are included: the VPL GPU runtime
for Tiger Lake (11th gen) and newer, and the legacy Media SDK runtime for 6th-10th
gen iGPUs such as Comet Lake UHD 620. Quick Sync *decoding* (`--enable-qsv-decoding`)
does not work with the legacy runtime on Linux, so leave it off in presets on
those machines. Decoding then runs on the CPU. If the host has no `/dev/dri`,
remove the `devices` and `group_add` blocks from `docker-compose.yml`.

`preset-gerry-qsv.json` is the Quick Sync variant of `preset-gerry.json`: same
settings, with `qsv_h264` instead of x264. On a Comet Lake i3 it encodes about
2.2x faster at the same bitrate, with slightly lower SSIM (0.985 vs 0.988).

## Development

```bash
cd server && npm install && SOURCE_ROOT=/some/dir TARGET_ROOT=/other/dir npm run dev   # API on :8095
cd web && npm install && npm run dev                                                   # UI on :5173
cd server && npm test
```

The server needs `HandBrakeCLI` on the `PATH` (or `HANDBRAKE_CLI=/path/to/it`)
to scan and encode, `ffprobe`/`ffmpeg` (`FFPROBE`, `FFMPEG`) for the check after
conversion, and `mkvmerge` (`MKVMERGE`, from MKVToolNix) for merging. Everything
else works without them; the Docker image includes all of them.

**Stack:** Node 24 + Fastify, built-in `node:sqlite`, Server-Sent Events for
live updates; React + Vite for the UI. One container, no external database.

`scripts/deploy.sh [ssh-alias] [remote-dir]` copies the project to a Docker host
over SSH and runs `docker compose up -d --build` there. It refuses to run while
a job is converting, because the restart would start that encode again from 0%.
Use `FORCE=1` to override. Extra ssh options go in `SSH_OPTS`, e.g.
`SSH_OPTS="-J rasp-web" scripts/deploy.sh` to go through a jump host.

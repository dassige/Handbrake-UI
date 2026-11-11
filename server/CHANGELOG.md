# Changelog

All notable changes to this project will be documented in this file.

## [3.3.1] - 2026/11/12

- feat: subtitle copies renamed when their language changes; warn when the format can't hold them

## [3.3.0] - 2026/11/12

- feat: sidecar subtitle files: embed, copy, rename along, edit

Subtitle files next to a source video are found, embedded into the converted
video when its language is missing, and copied next to it as Video.en.srt.
Settings, the whole queue or a single job choose what happens. An editor
fixes timing, frame rate, character set and clean-up without changing the
originals.

## [3.2.1] - 2026/11/12

- feat: convert one queued file now; remembered sorting on every file list

A queued job can be converted on its own while the queue is stopped,
and every file and folder list can be sorted, each remembering its
last sort.

- Convert now: new button on queued jobs (queue row and details
  panel), shown while the queue is stopped and nothing converts;
  converts only that job, also outside the conversion window, and
  the queue stays stopped afterwards; the top bar shows "Converting
  one file"; Start meanwhile runs the rest of the queue after it
- The job's own done/failed notification is sent, but no "Queue
  finished" message; the next queue run reports only its own jobs
- Server: POST /api/jobs/:id/convert-now (refused when the queue is
  running, another job converts or the job is not queued); queue
  state gets activeSingle
- Sort by name, date, file type or size, with an arrow to reverse;
  folders stay on top; each list remembers its sort in the browser
  (localStorage hbui.sort.<list>)
- Sorting on: the file browsers of Convert, Rename, Merge and Quality
  check (each its own), the folder picker in Settings (name, date),
  the rename list (sorted within each folder) and the quality
  results (now remembered; date and file type added, column headers
  still work)
- Merge parts: also "Your order"; a sort keeps parts added later in
  that order, and dragging or the arrows switch back to "Your order"
- Server: rename preview rows, merge parts and quality results now
  include the file date (and size for rename) for sorting; older
  quality scans have no date and sort as oldest
- Help: Convert now in "Job actions" and "Starting and stopping the
  queue"; sorting in "Sources" and "Merge parts"; all five languages
- Tests: Convert now alone, while busy, with the queue running, and
  its notifications

## [3.2.0] - 2026/11/11

- feat: the app in five languages (English, Italian, German, French, Spanish)

The web app, its help included, can now be shown in English, Italian,
German, French or Spanish.

- Settings → Language: one language for every browser, or Automatic
  (each browser uses its own language when the app has it, English
  otherwise); applies after saving, also live in other open browsers
- The browser remembers the last language, so the app opens in it
  without flashing English first; other languages load only when used
- Every page, dialog, toast, tooltip and the in-app help are
  translated; preset editor terms follow HandBrake's own translations;
  dates and numbers use the language's format
- Server data shown in the app is translated too: quality issues,
  check results, merge problems, skip and delete reasons, backup
  warnings and rename notes (the server adds a code and params next
  to its English text; results stored before this stay in English)
- Server: new language setting (auto, en, it, de, fr, es)
- Stay in English: e-mail and push notifications, server error
  messages, HandBrake/ffmpeg output, README and changelogs
- Fix: an open Settings page showed a false "Unsaved changes" bar
  when a setting was saved in another browser
- Help: new "Language" topic; README lists the languages and explains
  where the translations live
- Tests: every key used in the code exists, and every language has
  every string and help topic with the same placeholders and links

## [3.1.0] - 2026/11/11

- feat: preset editor like the HandBrake desktop app

Presets can now be made and changed in the app, not only imported.

- New: start from a HandBrake built-in preset (listed by the server's
  HandBrakeCLI) or from one of yours; Duplicate copies the chosen one
- Edit: name, category and description, then the desktop app's tabs:
  Summary, Dimensions, Filters, Video, Audio, Subtitles, plus the raw
  JSON; Save, Save as new, and a guard for unsaved changes
- Encoders and their preset/tune/profile/level lists come from the
  installed HandBrakeCLI (read about 15 s after the server starts);
  a generic list is used when the CLI is missing
- Opening a preset lets HandBrakeCLI upgrade it to the current format
  and fill in every setting; saving checks it with HandBrakeCLI again
- Combinations HandBrake refuses (e.g. H.265 in WebM, Vorbis in MP4)
  block saving; an encoder the server lacks shows as a warning
- Server: GET /api/presets/options, /api/presets/builtin,
  /api/presets/:id/editable; POST /api/presets/new;
  PUT /api/presets/:id; presets get an updated_at column
- Output extensions for MOV and the generic container names
  (mp4, mkv, webm, mov)
- Fix labels in the read-only preset view: Yadif, the 7.1 mixdown,
  anamorphic "None"
- Help: new "Editing a preset" and "New preset" topics; README and
  About text updated
- Tests for the CLI output parsers and for create/edit/normalise

## [3.0.1] - 2026/11/11

- chore: relicense under GPL-2.0-only; add hardware and performance guide

- Replace the MIT licence with the GNU GPL, version 2 (verbatim text)
  in LICENSE, README, Settings → About, help and package.json files
- README: new "Hardware and performance" section with requirements and
  measured speeds (Raspberry Pi 5, ASUS Chromebox 4 with x264 and
  Quick Sync, i7 laptop with Docker Desktop) and real-world numbers
- Add .deploy.env.example with the deploy.sh settings

## [3.0.0] - 2026/11/11

- chore: prepare repository for public release (MIT)

Docs
- Rewrite README: features, screenshots, requirements, and installation
  for Linux and Windows, with and without Docker (packages, service
  setup), plus configuration, updating, hardware encoding, security,
  troubleshooting, development, credits/licences and a disclaimer
- Add screenshots in docs/screenshots/, taken with demo data

Privacy
- Stop tracking PLAN.md and the QSV investigation PDF, and ignore them
- Ignore .deploy.env, which holds personal deploy defaults
- Use generic examples in the UI, help text and notifications instead of
  personal hostnames, paths, time zone and media server name
- Move the personal preset to presets/tv-720p-qsv.json and add an x264
  version (presets/tv-720p-x264.json)

Deploy
- scripts/deploy.sh: the host is now an argument (or DEPLOY_HOST from
  .deploy.env). New --here mode updates the checkout on the server
  itself. It also refuses to deploy while a conversion is running
  (override with FORCE=1) and creates .env from .env.example on the
  first deploy
- docker-compose.yml: MEDIA_MOUNT sets the path inside the container, so
  Windows paths work on Docker Desktop
- Add docker-compose.no-gpu.yml for hosts without /dev/dri
- Document COMPOSE_FILE, Windows paths and TZ in .env.example

Windows support
- Turn off pausing on Windows: Node has no SIGSTOP there and would kill
  HandBrakeCLI instead. The queue state reports canPause and the Pause
  button is hidden
- Add Windows notes to the help for Pause and CPU priority

Fixes
- Mobile: folder names no longer shrink to one letter when status
  badges are shown; the badges wrap instead

## [2.1.1] - 2026/11/11

- 

## [2.1.0] - 2026/11/10

- feat: implement scheduled backups feature

- Added BackupScheduler class to manage scheduled backups.
- Introduced new API routes for scheduled backups: status, run, retrieve, and delete.
- Enhanced backup settings in the application to include scheduling options.
- Updated notification system to handle backup failure events.
- Created a new BackupSection component in the settings page for user interaction with backup scheduling.
- Implemented validation for backup schedule settings.
- Added tests for backup scheduling functionality.

## [2.0.1] - 2026/11/10

- feat: enhance webhook functionality and UI in notifications settings
- feat: add release script and configuration for GitHub releases

## [2.0.0] - 2026/11/10

- feat: add backup and restore functionality for settings and presets

## [1.2.0] - 2026/11/10

- feat: implement backup and restore functionality

- Added backup and restore capabilities for configuration and database.
- Introduced new API routes for managing backups, including creating, listing, restoring, and deleting snapshots.
- Implemented a backup system that creates ZIP files containing the database and logs.
- Developed a user interface for backup management, allowing users to download, save, and restore backups.
- Added comprehensive tests to ensure the reliability of backup and restore operations.
- Enhanced styles for the backup management UI to improve user experience.

## [1.1.1] - 2026/11/10

- feat: enhance version management and display in web UI and server

## [1.1.0] - 2026/11/10

- feat: implement file deletion feature with confirmation and protection settings for source folders

## [1.0.0] - 2026/11/10

- feat: implement dialog system for alerts, confirmations, and prompts

- Add DialogProvider and useDialogs hook for managing dialogs
- Create AskDialog component for rendering modal dialogs
- Implement confirm, alert, and prompt functionalities

feat: add download functionality with user confirmation

- Introduce useDownload hook for handling file downloads
- Implement user prompts for downloading multiple files or folders
- Support for ZIP file creation and download

feat: create QualityView component for video quality checks

- Implement video quality scanning and result display
- Add filtering and sorting capabilities for scan results
- Integrate with existing API for fetching quality data

feat: develop upload dialog for video file uploads

- Create UploadDialog component for selecting and uploading files
- Implement folder creation and file validation
- Handle upload progress and error management

feat: implement uploads panel for tracking upload progress

- Create UploadsPanel component to display ongoing uploads
- Add functionality for canceling and retrying uploads
- Show upload progress and status updates

feat: build upload manager with chunked uploads and retries

- Implement useUploads hook for managing file uploads
- Support for chunked uploads with automatic retries
- Handle server-side checks for existing files and partial uploads


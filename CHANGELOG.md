# Changelog

All notable changes to this project will be documented in this file.

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

## [3.0.2] - 2026/11/11

- - Credit Claude Code in the README and Settings → About; drop the
  "repository is private" note from About

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
- feat: improve topbar layout for better responsiveness and readability

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

## [1.3.1] - 2026/11/10

- 

## [1.3.0] - 2026/11/10

- feat: implement backup and restore functionality

- Added backup and restore capabilities for configuration and database.
- Introduced new API routes for managing backups, including creating, listing, restoring, and deleting snapshots.
- Implemented a backup system that creates ZIP files containing the database and logs.
- Developed a user interface for backup management, allowing users to download, save, and restore backups.
- Added comprehensive tests to ensure the reliability of backup and restore operations.
- Enhanced styles for the backup management UI to improve user experience.

## [1.2.1] - 2026/11/10

- feat: enhance version management and display in web UI and server

## [1.2.0] - 2026/11/10

- feat: implement file deletion feature with confirmation and protection settings for source folders

## [1.1.0] - 2026/11/10

- feat: implement dialog system for alerts, confirmations, and prompts


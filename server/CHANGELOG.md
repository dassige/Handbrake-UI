# Changelog

All notable changes to this project will be documented in this file.

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


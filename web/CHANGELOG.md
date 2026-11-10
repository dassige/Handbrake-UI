# Changelog

All notable changes to this project will be documented in this file.

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
- feat: implement dialog system for alerts, confirmations, and prompts

## [1.0.2] - 2026/11/10

- Update QSV GPU encoding documentation and add details for Quick Sync presets

## [1.0.1] - 2026/11/10

- Add Dockerfile support for building HandBrakeCLI and update README with encoding details

## [1.0.0] - 2026/11/09

- Add help system with search functionality and help topics
- gitignore
- Keep local CLAUDE.md out of the repo
- Add Rename view: smart TV/movie renaming, rule sets, undo
- Add HandBrake Queue: headless HandBrakeCLI queue with a web UI


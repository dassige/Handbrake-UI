# Changelog

All notable changes to this project will be documented in this file.

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


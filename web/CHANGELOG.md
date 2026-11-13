# Changelog

All notable changes to this project will be documented in this file.

## [4.3.2] - 2026/11/14

- feat: Replacing an original can keep the converted file in the target folder

The replace dialog has a "Keep the converted file in the target folder
too" checkbox, remembered per browser. When ticked, the converted file
and its subtitle copies are copied to the original's folder instead of
moved (also on one disk), and the job keeps pointing at the copy in
the target folder; its details show both places. The single and the
background replace take keepConverted; without it the file is moved,
as before. The help and the API docs describe it in every language.

## [4.3.1] - 2026/11/14

- feat: Replace originals in the background, with progress

"Replace originals" now hands the jobs to the server, which replaces
them one at a time in the background, also with the page closed or
reloaded. A bar above the queue shows which file is being replaced,
the step (copying the converted file, keeping the original) and how
far the copy is, then a summary with any failures until dismissed.
Jobs show "Waiting to replace", "Replacing… 42%" with a bar, or "Replace
failed" with the reason. "Stop after this one" finishes the file being
copied and skips the rest. At start-up, a copy left unfinished by a
restart is removed, or completes the replace when the original had
already gone. New endpoints: GET/POST/DELETE /api/replace and POST
/api/replace/stop; progress also comes as "replace" events.

## [4.3.0] - 2026/11/14

- feat: Play videos in the browser

A play button in the folder lists (sources and target), the quality
check results and the queue opens a video in a player; for a queued
or converted job it offers the original and, once converted, the
converted file. Files the browser plays (MP4/WebM/MKV with H.264, VP9,
AV1 or supported HEVC, and AAC/MP3/Opus audio) are played as they are,
with seeking. Anything else (AVI, DivX, MPEG-2, WMV, AC3/DTS audio) is
converted on the fly by ffmpeg to H.264/AAC at up to 1280 pixels wide,
with a position bar to jump and a choice of audio track; the player
switches to this mode by itself when the browser cannot play a file.

Each stream's ffmpeg stops when the player stops reading, runs at the
conversions' CPU priority, and at most 3 run at once. New endpoints:
/api/media/info, /api/media/file and /api/media/stream (read access).
The help, the API docs and the README describe it in every language.

## [4.2.5] - 2026/11/13

- feat: Clear selection button in the queue

While jobs are selected, the bar above the queue has a "Clear
selection" button that unchecks them all.

## [4.2.4] - 2026/11/13

- feat: Select several jobs in the queue to replace or remove them

Each job in the queue has a checkbox; Ctrl/Cmd-click picks one more,
Shift-click a range, and "Select all" takes every job the filter shows.
A plain click still opens the job's details. The bar above the list
then replaces the originals of the selected quality-check jobs (the
button replaces the one that only appeared under the Quality filter)
or removes the selected jobs, after asking; converting jobs stay and
files are never touched. The queue help explains it in every language.

## [4.2.3] - 2026/11/13

- feat: Replace originals with their conversions from the quality check

Files added to the queue from the quality check are marked "Replaces
original" in the queue, which gets a Quality filter. Once converted,
"Replace original" (in a job's details, or for all of them with the
filter) puts the converted file in the original's place: same folder
and name, with the converted file's extension. The original is kept in
the folder for replaced originals chosen in Settings → Quality check,
under its path from the sources folder, or deleted. Subtitle copies
next to the converted file go with it, named after the original; an
original subtitle of the same name is kept with the original.

Replacing is refused when the check after conversion failed, the
original is protected or queued again, or another file already has the
new name. The converted file is placed under a hidden name first and a
failing step undoes the ones before it; moves between disks copy and
remove the source last. Replaced jobs cannot be converted again. The
help, the API docs and the README describe it in every language.

## [4.2.2] - 2026/11/13

- feat: Job tags, job list filters, start on add and signed webhooks

POST /api/jobs takes a tag, free text up to 100 characters such as an
integration's own reference (radarr:1234). It is kept with every job
added, copied by "Convert again", shown in the job details and sent in
job notifications. start: true also starts the queue, as Start does
(waiting for the conversion window, if any); startNow: true starts it
even outside the window. The answer now includes the queue state.

GET /api/jobs can be filtered by status (a comma-separated list), tag,
since (added or finished at or after a time) and limit, so a client
can poll for its own jobs.

A webhook can have a signing secret: each request then carries
X-EncForge-Signature: sha256=<HMAC-SHA256 of the body>, and every
webhook request says its event in X-EncForge-Event. Like the e-mail
password, the secret is never sent back to the browser. The API docs,
the help and the README describe all of it in every language.

## [4.2.1] - 2026/11/13

- feat: API documentation at /api/docs, with request validation

Every API route is now described in OpenAPI 3.1: /api/docs shows it
as a browsable page where requests can be tried with an API key, and
/api/openapi.json serves the description for client generators. Both
are public, also while login is on. The description explains login
and the API key access levels, the error format, paths and the event
stream; each operation shows the access it needs, taken from the same
table the login check uses.

The docs of each route live in server/src/openapi/paths/, by area, and
are attached when the route is registered. Request parameters and
bodies are now validated against them (400, code invalidRequest),
never more strictly than the handlers already were; response schemas
only document, so answers are sent exactly as before. Tests fail when
a route has no docs or docs have no route, and replay the requests the
web app makes to prove validation accepts them.

Settings → Security links to the documentation; the help and the
README mention it in every language.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

## [4.2.0] - 2026/11/13

- feat: Optional login for the web app and API keys for other programs

Settings → Security can set a password and turn login on. It is off by
default, so existing installs work as before. Once it is on, browsers
show a sign-in page; the browser that turned it on stays signed in. A
browser stays signed in until it goes unused for 30 days. Signing out,
changing the password or "Sign out other browsers" end it sooner. After
5 wrong passwords, sign-in from that address is blocked for 15 minutes.

API keys let other programs use the same /api routes, sent as
"Authorization: Bearer ef_…" or "X-API-Key: ef_…". Each key is read
only, queue (add and control jobs, uploads, checks) or full (settings,
presets, renaming and deleting files, merges, backups). A key is shown
once; only its hash is stored. No key can manage login or other keys.
While login is off, keys are optional, but a key that is sent is still
checked, so an integration can be tried first. Keys below full access
never see webhook headers, in /api/settings or in the event stream.

DISABLE_LOGIN=true (also passed through docker-compose) turns login off
and lets a new password be set without the old one. The password,
sessions and keys are left out of backups and never restored. Requests
from other websites that would change something are now refused, even
with login off. The Docker health check uses the new /api/health,
which answers also when login is on. Errors from these checks carry a
code, so the app shows them in all five languages. The help and the
README describe login and API keys in every language.
- feat: Quality re-check follows a file converted to another format

## [4.1.5] - 2026/11/13

- feat: Output layout with show and season folders for TV shows

A new output layout, "Show and season folders", writes converted
episodes to target/Show/S01/episode.mkv. The show and season come
from the folder the source is in: "Show.S01.1080p", "Show - Season 1"
or an episode's own folder such as "Show.S01E05.1080p". A bare
"Season 1" or "S01" folder takes the show name from the folder above
it. In a folder with several seasons ("Show.S01-S03"), each file's
own S02E01 marker gives the season. Show names are cleaned up (dots
become spaces, release tags are dropped, a year becomes "(2019)"),
and season words are recognised in the five app languages.

Videos that are not in a season folder go to
target/<source folder>/video.mkv, as with "Source folder name". The
settings page, the help and the README describe the new layout in
every language.

## [4.1.4] - 2026/11/13

- feat: Quality check can re-check the selected files

After fixing some files, select them in the results and press
Re-check: only those files are read again, and their results are
updated in the same result, with no new full check. The other files
keep their results. Files that no longer exist (deleted, renamed or
replaced) leave the list; new files are only found by a new check.
If a whole folder can't be reached, the re-check stops with an error
instead of dropping its files.

A re-check shows its progress and can be stopped like a check. The
result keeps its status and date, and a restart during a re-check
keeps the earlier results. Only files of that result can be
re-checked. The help explains the button in every language.

## [4.1.3] - 2026/11/12

- feat: the target folder stands out in folder dropdowns

In the folder dropdown of Rename, Naming and Quality, the target
folder is shown in a light blue badge, in the list and when chosen;
the folder chips in Settings pickers match. The dropdown is now the
app's own (a native one can't show a badge) and keeps full keyboard
use: arrows, Home/End, Enter, Escape and type-ahead.

## [4.1.2] - 2026/11/12

- feat: Naming check shows its progress and can be stopped

A naming check now runs in the background on the server. While the
folders are read, a bar shows how many videos have been found so far
and which folder is being read; then it counts the names checked out
of the total. Stop keeps the files checked so far. A check interrupted
by a restart is kept and marked as such, and a full restore waits
while a check runs. When many folders are checked, the list shows the
first three and how many more.

## [4.1.1] - 2026/11/12

- feat: Rename and Naming check also work in the sources folders

Rename and the Naming check can now browse and rename files in the
sources folders as well as the target folder. Files in a folder marked
Protect (a download client may be seeding them) and files that are
queued or converting are shown but can't be renamed; the server
refuses them too. A renamed source still counts as converted, and a
watch folder doesn't take it for a new file. Protect now means "can't
be deleted or renamed from the app".

## [4.1.0] - 2026/11/12

- feat: Naming check, find files whose names don't follow a rename rule set

A new Naming tab checks every video in chosen folders of the target
folder against a rename rule set (Auto, TV series, Movies or your
own) and lists the files that need a look:
- Wrong name: the rule set would rename the file; the expected name
  is shown under the current one.
- Not recognised: the rule set found something missing, such as no
  episode number or no year.
Files that already have the right name are counted, not listed. Only
names are read, so even a whole library takes seconds.

Fix in Rename opens the selected files in Rename with the same rule
set, to check the preview and apply. Choosing other rules or pressing
Check again checks the same folders again.

Every check is saved; the newest 20 are kept and can be reopened from
Result. Files renamed, moved or deleted since a check are shown under
Renamed or moved and can't be selected again. Naming results are part
of backups (restore "Everything").

Also:
- Rename keeps its chosen rule set while you use other views.
- Folder lists refresh after a rename or an undo.
- Help and texts for the Naming view in all five languages.

## [4.0.0] - 2026/11/12

- feat: rename the project to EncForge

HandBrake Queue (repository Handbrake-UI) is now EncForge: the app
title, home-screen name, About page, notifications and emails, the
help and Settings texts in all five languages, package names, the
Docker service, container and image, and the README. HandBrake is
still named where it means the encoding engine (HandBrakeCLI).

Existing installs update without losing anything:
- data/handbrake-ui.db (with its -wal/-shm files) is renamed to
  encforge.db on the first start.
- Backups and exported rename rules made under the old name still
  restore and import.
- deploy.sh runs docker compose with --remove-orphans and removes the
  old handbrake-ui image, so the old container can't keep the port;
  it still finds a deploy key named ~/.ssh/handbrake-ui-deploy.

The README says the project was formerly Handbrake-UI and has a
section on updating an install from before the rename.

## [3.3.4] - 2026/11/12

- feat: implement StopIcon for cancel actions and update styles

## [3.3.3] - 2026/11/12

- feat: app icon, logo and README banner

The browser tab, phone home screen, top bar and notifications use the new
icon. The logo appears in Settings → About and on the empty queue and
Presets pages, with a faint outline in the dark theme. The README opens
with a banner, and a GitHub social preview image is included.
docs/branding/ holds the Gemini prompts and the script that rebuilds every
file from the generated images.

## [3.3.2] - 2026/11/12

- feat: download a video with its subtitle files as one ZIP

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

## [2.1.2] - 2026/11/11

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


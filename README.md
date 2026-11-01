# Analytics Hub

Analytics Hub is a local-first workspace for exploring CSV and Excel files. Upload a spreadsheet, clean and edit it, ask questions in plain language, build charts, and save separate workspaces from one interface.

> **Project status:** Analytics Hub is a local prototype. Accounts are stored in SQLite; spreadsheet data and workspaces are stored in the browser.

## Contents

- [Features](#features)
- [Run locally](#run-locally)
- [First-time setup](#first-time-setup)
- [Data and account storage](#data-and-account-storage)
- [Current limits](#current-limits)
- [Project files](#project-files)
- [Troubleshooting](#troubleshooting)

## Features

### Import and manage spreadsheets

- Upload or drag in `.csv`, `.xlsx`, and `.xls` files.
- Preview, search, sort, and page through rows.
- Merge multiple files by matching their column names.
- Export the working data as CSV, Excel (`.xlsx`), or JSON.

Excel files are read in the browser with SheetJS. The first worksheet is used when a workbook is opened. Styled Excel exports are generated with ExcelJS.

### Clean and check data

- Trim extra spaces in text cells.
- Find possible duplicate profiles while ignoring columns that look like record IDs.
- Find missing values, detect likely column types, and inspect common formatting issues.
- Edit cells directly in the issue editor. Issues update as values are corrected.
- Select cells by dragging, Shift-clicking for a rectangle, or Cmd/Ctrl-clicking separate cells. Apply formatting or fill values across the complete selection; paste a tab-delimited block copied from a spreadsheet to edit many cells at once.
- Add rows and columns, rename columns, and format cells or apply a striped/compact table style. Excel (`.xlsx`) exports retain formatting; CSV and JSON contain values only.
- Apply suggested fixes for supported issues, including trimming spaces, normalizing matching capitalization, filling some missing values, and clamping percentage-like values to the 0–100 range.
- Undo the most recent supported cleanup action.
- Use **Change the dataset** to preview and apply conditional labels, percentage limits, missing-value fills, direct value replacements, and conditional updates. For example, `Fill all the blank values in Status column with completed` fills only blank Status cells. Applied changes update the working dataset; “Ask your data” is for question and filter results.

Checks are heuristic. Review suggested changes against the meaning of your data before relying on them.

### Ask Data

Ask Data handles a set of common spreadsheet questions using plain language, such as:

- `Show students above 90 percent`
- `Show rows with missing values`
- `Sort by score highest to lowest`
- `Average score by class`
- `Show rows where City contains Mumbai`
- `Attendance should not exceed 100%`

Supported requests include numeric comparisons, sorting and top/bottom rows, counts and common summaries (sum, average, minimum, maximum), grouping, unique values, duplicate review, blank-row checks, and simple text matches. This is a built-in rule-based parser, not an open-ended AI model or arbitrary code executor. Data-change requests support common plain-language patterns; unrecognized instructions return a prompt to rephrase using one of the available examples.

### Build visualizations

- Select one or more fields and choose a chart type: bar, horizontal bar, line, area, pie, doughnut, polar area, radar, or scatter.
- Choose an optional grouping field and a sum, average, or count calculation.
- Create Power BI-style dashboards and Tableau-style visuals inside Analytics Hub; those desktop products do not need to be installed.

The Excel-, SQL-, and Python-style tools are guided analysis interfaces that show results. They do not run arbitrary Excel formulas, SQL statements, or Python scripts.

### Accounts, workspaces, and appearance

- Sign up and sign in with a username and password.
- Edit your username, email, recovery ID, and profile picture. Changing a password requires the current password.
- Switch between dark and light themes.
- Free accounts can create two workspaces. Each workspace remembers its own dataset in the current browser, so switching workspaces does not replace the other workspace's data. An administrator can grant complimentary Pro access from the separate admin portal.

## Admin access and complimentary Pro

The local server can bootstrap one admin account from `.env`. Set `ANALYTICS_HUB_ADMIN_USERNAME` and `ANALYTICS_HUB_ADMIN_PASSWORD` to a private username and a random password of at least 16 characters before starting the server. On first startup, the account is created and marked as an administrator; if that username already exists, it is promoted without replacing its password. Keep `.env` private and change the password after first sign-in if needed.

Administrators use the separate [admin portal](http://127.0.0.1:8000/admin). It has its own login page and isolated session, and only shows account and plan management. The admin account cannot sign into the regular Analytics Hub workspace. The portal lists accounts, valid sign-in session status, free/complimentary access, and controls to grant or remove complimentary Pro access for testers. Passwords and password hashes are never exposed in the portal. The local account database is `.analytics_hub.sqlite3`.

The server limits repeated failed sign-ins, checks same-origin requests before accepting browser changes, stores salted PBKDF2 password hashes, issues HTTP-only SameSite cookies, and sends basic browser security headers. It binds to `127.0.0.1` by default. Keep it local unless you deploy behind HTTPS with production-grade hosting and configure `ANALYTICS_HUB_COOKIE_SECURE=true` plus the exact public `ANALYTICS_HUB_ALLOWED_ORIGINS` in the host's secret/settings manager. Do not expose the built-in server directly to the internet; a public launch needs a production server, stronger session and admin auditing, backups, and a security review.


## Run locally

### Requirements

- Python 3.10 or newer (the server uses only Python's standard library).
- A modern browser.
- An internet connection for the SheetJS, ExcelJS, and Chart.js libraries, which are loaded from CDNs. CSV preview and basic analysis do not require a Python package install.

### Start the server

From this project directory, run:

```bash
python3 server.py
```

Open **http://127.0.0.1:8000** in your browser. The server creates `.analytics_hub.sqlite3` the first time it starts. Stop it with **Ctrl+C** in the terminal.

If port 8000 is already in use, stop the other local server or choose another port:

```bash
PORT=8001 python3 server.py
```

Then open **http://127.0.0.1:8001**.

### Create an account

On the sign-in screen, choose **Create an account**. Usernames may contain letters, numbers, periods, underscores, and hyphens. Passwords must be at least 10 characters. After signing in, open **Profile & settings** to edit account details.

## Data and account storage

| Data | Where it is stored |
| --- | --- |
| Username, password hash, email, recovery ID, profile image, and login sessions | `.analytics_hub.sqlite3` on the computer running the server |
| Current workspace datasets and workspace names | Browser local storage, separated by account on that browser |
| Saved recent projects | Browser local storage, separated by account on that browser |
| Uploaded and edited spreadsheet contents | Processed in the browser; not uploaded to the account database |

The password itself is not stored; the server stores a salted PBKDF2-SHA256 password hash. The SQLite database is excluded from Git by `.gitignore`. Deleting browser storage removes locally saved workspaces and projects. Deleting `.analytics_hub.sqlite3` removes local accounts and profile details.

## Current limits

- This server is intended for local development. It binds to `127.0.0.1` by default and is not configured for public hosting.
- There is no HTTPS setup, email verification, forgotten-password flow, or cloud account synchronization. The basic in-process sign-in limit is intended only for local development, not production protection.
- Workspace data lives in the browser, not on a shared server. A user's workspaces do not follow them to another browser or computer.
- Large datasets may exceed the browser's local-storage quota. Export important work to a file as a backup.
- Chart.js, SheetJS, and ExcelJS are loaded from third-party CDNs, so charts, Excel import, and styled Excel export may be unavailable offline.

## Project files

```text
.
├── app.js          # Spreadsheet parsing, editing, cleaning, charts, auth UI, workspaces
├── admin.css       # Separate private admin console styling
├── admin.html      # Isolated admin login and account-management portal
├── admin.js        # Admin-only session, user list, and complimentary Pro controls
├── favicon.svg     # Analytics Hub icon
├── index.html      # Main app, profile, workspace, and Pro page markup
├── server.py       # Local static server and SQLite account API
├── styles.css      # Responsive dark/light theme and components
└── .gitignore      # Excludes the local account database and Python cache
```

## Troubleshooting

**The page does not load:** Check that `python3 server.py` is still running, then open the URL printed in the terminal.

**The profile or account API returns 404:** Stop the old server with **Ctrl+C**, start it again with `python3 server.py`, and refresh the page. The server process must be restarted after changes to `server.py`.

**Excel import or charts do not load:** Check the internet connection, since the corresponding browser libraries are fetched from CDNs. CSV upload and core table operations are available without those libraries.

**I want to put this project on GitHub:** Create an empty repository, then initialize and push this folder using Git. Keep `.analytics_hub.sqlite3` and any real or sensitive datasets out of the repository.

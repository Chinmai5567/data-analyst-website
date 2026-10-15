# Analytics Hub

Analytics Hub is a local-first workspace for exploring CSV and Excel files. Upload a spreadsheet, clean and edit it, ask questions in plain language, build charts, and save separate workspaces from one interface.

> **Project status:** This is a local prototype. Accounts and profile details are stored in a local SQLite database; spreadsheet data and workspaces are stored in the browser. The Pro page displays a proposed price of **₹100/month**, but payment checkout is not connected and no subscription can be purchased yet.

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
- Select a range with Shift-click, paste a tab-delimited block copied from a spreadsheet, or fill the selected range with one value.
- Add rows and columns, rename columns, and format cells or apply a striped/compact table style. Excel (`.xlsx`) exports retain formatting; CSV and JSON contain values only.
- Apply suggested fixes for supported issues, including trimming spaces, normalizing matching capitalization, filling some missing values, and clamping percentage-like values to the 0–100 range.
- Undo the most recent supported cleanup action.
- Use **Change the dataset** to preview and apply conditional labels such as `Score above 80 is Pass`, percentage limits, and missing-value fills. Applied changes update the working dataset; “Ask your data” is for question and filter results.

Checks are heuristic. Review suggested changes against the meaning of your data before relying on them.

### Ask Data

Ask Data handles a set of common spreadsheet questions using plain language, such as:

- `Show students above 90 percent`
- `Show rows with missing values`
- `Sort by score highest to lowest`
- `Average score by class`
- `Show rows where City contains Mumbai`
- `Attendance should not exceed 100%`

Supported requests include numeric comparisons, sorting and top/bottom rows, counts and common summaries (sum, average, minimum, maximum), grouping, unique values, duplicate review, blank-row checks, and simple text matches. This is a built-in rule-based parser, not an open-ended AI model or arbitrary code executor. If a request is not recognized, Ask Data suggests examples it understands.

### Build visualizations

- Select one or more fields and choose a chart type: bar, horizontal bar, line, area, pie, doughnut, polar area, radar, or scatter.
- Choose an optional grouping field and a sum, average, or count calculation.
- Create Power BI-style dashboards and Tableau-style visuals inside Analytics Hub; those desktop products do not need to be installed.

The Excel-, SQL-, and Python-style tools are guided analysis interfaces that show results. They do not run arbitrary Excel formulas, SQL statements, or Python scripts.

### Accounts, workspaces, and appearance

- Sign up and sign in with a username and password.
- Edit your username, email, recovery ID, and profile picture. Changing a password requires the current password.
- Switch between dark and light themes.
- The Free plan includes two workspaces. Each workspace remembers its own dataset in the current browser, so switching workspaces does not replace the other workspace's data.
- The Pro page shows the proposed ₹100/month plan. Checkout and paid entitlements are not implemented.

## Run locally

### Requirements

- Python 3.9 or newer (the server uses only Python's standard library).
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
- There is no HTTPS setup, rate limiting, email verification, forgotten-password flow, or cloud account synchronization.
- Workspace data lives in the browser, not on a shared server. A user's workspaces do not follow them to another browser or computer.
- Large datasets may exceed the browser's local-storage quota. Export important work to a file as a backup.
- Pro pricing is a UI preview only. A payment provider, subscription management, and Pro access enforcement still need to be integrated.
- Chart.js, SheetJS, and ExcelJS are loaded from third-party CDNs, so charts, Excel import, and styled Excel export may be unavailable offline.

## Project files

```text
.
├── app.js          # Spreadsheet parsing, editing, cleaning, charts, auth UI, workspaces
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

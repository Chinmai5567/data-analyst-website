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

Excel files are read in the browser with SheetJS. The first worksheet is used when a workbook is opened.

### Clean and check data

- Trim extra spaces in text cells.
- Find possible duplicate profiles while ignoring columns that look like record IDs.
- Find missing values, detect likely column types, and inspect common formatting issues.
- Edit cells directly in the issue editor. Issues update as values are corrected.
- Apply suggested fixes for supported issues, including trimming spaces, normalizing matching capitalization, filling some missing values, and clamping percentage-like values to the 0–100 range.
- Undo the most recent supported cleanup action.

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
- An internet connection for the SheetJS and Chart.js libraries, which are loaded from CDNs. CSV preview and basic analysis do not require a Python package install.

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

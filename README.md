# AIUB Smart Slide Downloader

A small Chrome extension for AIUB students. Open your portal dashboard and it greets you by name, finds your **active** courses, and saves only the **new or missing** slides and notes into `Desktop/AIUB/<Course>/`. Nothing is downloaded twice.

```
Welcome, Rishad
 ├─ Operating System [D]            Up to date ✓
 ├─ Data Warehousing and Data Mining Done ✓
 └─ Research Methodology [P]        Downloading 3/4  ▬▬▬▬▬▬▭▭
```

When everything is finished the panel closes itself after 2 seconds.

## Features

- Greets you with your name from the portal ("Welcome, Rishad").
- Active courses only. Dropped or invalid courses are ignored.
- One progress bar per course, with the number of new files.
- Smart sync: compares each course folder with the portal and downloads only what is new or missing. Deleted a file by mistake? It comes back on the next visit.
- Fast: all courses are checked at the same time, files download in parallel, one helper process handles everything.
- Compact panel that fits laptop and desktop screens.
- Automatic on every dashboard load, plus a manual re-check by clicking the extension icon.

## Quick setup (Windows + Chrome, about one minute)

1. Download or clone this repository and keep the folder somewhere permanent (for example `Documents`).
2. Double-click **`Setup.bat`**. It creates `Desktop/AIUB`, connects Chrome to the helper, copies the `extension` folder path to your clipboard and opens `chrome://extensions`.
3. In Chrome: turn on **Developer mode**, click **Load unpacked**, paste the path (Ctrl+V), press Enter and choose the folder.
4. Open your AIUB portal dashboard. Done.

Already installed an older version? Run `Setup.bat` again and click the reload icon on the extension.

Moved the folder? Run `Setup.bat` again so Chrome knows the new location.

## Project layout

```
AIUB-Smart-Slide-Downloader/
├── Setup.bat            one-click setup
├── extension/           the Chrome extension (load this folder)
│   ├── manifest.json
│   ├── background.js    downloads and talks to the helper
│   └── panel.js         the panel on the portal page
└── helper/              Windows helper that writes into Desktop/AIUB
    ├── install.ps1
    ├── host.ps1
    └── host.bat
```

## How it works

1. `panel.js` runs on the dashboard, reads your name and active courses, and opens each course's Notes page with your own logged-in session.
2. `background.js` asks the helper which files already exist in `Desktop/AIUB/<Course>`.
3. Only the missing files are fetched and streamed to the helper, which writes them to disk (a `.part` file first, so a failed download never leaves a broken file).

Without the helper (or if you press **Skip**), files go to your Chrome Downloads folder under `AIUB/<Course>` instead.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Panel says "Setup needed" | Double-click `Setup.bat`, then press **Check again** |
| "Wrong page" | Open the dashboard (`portal.aiub.edu/Student`) |
| A file failed | Press **Retry**, or click the extension icon later |
| "got a web page, not a file" | Your portal session expired. Log in again |
| Panel is gone too fast | Hover over it and it stays open |

## Privacy

- No passwords are read, stored or sent anywhere.
- Uses your existing logged-in portal session and only talks to `portal.aiub.edu`.
- Only your first name (from the portal's welcome text) is remembered in the page's local storage to show the greeting.
- Works only with course materials you are already allowed to access.

## Disclaimer

An unofficial student project, not affiliated with or endorsed by American International University-Bangladesh (AIUB).

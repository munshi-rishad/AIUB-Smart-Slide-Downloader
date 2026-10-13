# AIUB Smart Course Downloader

**Automatically find and organize AIUB course materials from the student portal.**

A Chrome Manifest V3 extension for students of the American International University-Bangladesh (AIUB). After you log in to the AIUB portal and open your student dashboard, the extension checks active courses for materials, identifies files that are not already saved, and downloads them into separate folders for each course.

> Unofficial community project. Not affiliated with or endorsed by AIUB.

## Features

- Detects active courses on the AIUB student dashboard and ignores dropped/invalid courses.
- Checks course pages for downloadable Notes/materials.
- Downloads missing files and skips files already present in the destination folder.
- Organizes downloads into course-specific folders.
- Displays course-by-course progress and download status in an on-page panel.
- Supports automatic dashboard checks and manual re-checks using the extension icon.
- Uses an optional Windows Native Messaging helper for saving directly to the Desktop.
- Falls back to the standard Chrome Downloads folder when the helper is unavailable.

## Requirements

- Google Chrome with support for Manifest V3 extensions.
- Access to your own AIUB student portal account.
- **Windows + PowerShell** for the optional Desktop folder helper.

## Installation

### 1. Load the Chrome extension

1. Download the repository and extract it to a **permanent local folder**.
2. Open `chrome://extensions` in Google Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the `aiub-ext` folder (the folder that contains `manifest.json`).

### 2. Optional: Save files to Desktop/AIUB

1. Keep the `aiub-helper` folder at its final location (do not move it after installation without rerunning the installer).
2. Run `aiub-helper/install.bat` on Windows, or run `install.ps1` using PowerShell.
3. Reload the extension on `chrome://extensions`.
4. Open your AIUB student dashboard.

The helper registers a Chrome Native Messaging host for the extension. The provided installer is tied to the extension ID configured in this repository, so if you replace/remove the manifest's public `key` or use a different Chrome extension ID, update the ID in `aiub-helper/install.ps1` accordingly and reinstall.

> Inspect scripts before running them. Only install software and extensions from sources you trust.

## How to use

1. Go to <https://portal.aiub.edu/> and **log in yourself**.
2. Open the student dashboard.
3. The extension will check your active courses when the dashboard loads.
4. Follow the status panel while it scans and downloads missing materials.
5. Click the extension icon on the dashboard to check again manually.

The extension does **not** log in on your behalf or require you to enter your portal password into the extension.

## Download location

With the Windows helper:

```text
Desktop/
└── AIUB/
    ├── Course A/
    │   ├── Lecture 01.pdf
    │   └── Slides.pptx
    └── Course B/
        └── Notes.pdf
```

Without the helper, files are saved under your configured Chrome download directory, normally `Downloads/AIUB/<Course>/`.

## Project structure

```text
AIUB-Smart-Course-Downloader/
├── aiub-ext/
│   ├── manifest.json       # Chrome extension configuration
│   ├── background.js       # Download management and helper communication
│   └── panel.js            # Dashboard scanner and progress interface
├── aiub-helper/
│   ├── install.bat          # Windows installer launcher
│   ├── install.ps1          # Registers the native messaging host
│   ├── host.bat             # Native host launcher
│   └── host.ps1             # Writes files into Desktop/AIUB
├── .gitignore
└── README.md
```

## Technologies

JavaScript · Chrome Extension Manifest V3 · Chrome Downloads API · Chrome Native Messaging API · PowerShell · Windows Batch

## Limitations

- Built for the current AIUB student portal page structure; portal updates can affect course and file detection.
- Native helper installation is Windows-specific. Other operating systems can use the Chrome Downloads fallback.
- Downloads require an active, authenticated portal session and permission to access the relevant course materials.
- Duplicate detection is filename-based rather than a cryptographic content check. It does not guarantee detecting revised files with unchanged filenames.
- This is a local automation utility, not a hosted service. No reliability guarantee is provided.

## Privacy and responsible use

- Log in directly on the official AIUB portal. **Never commit passwords, authentication cookies, or session tokens.**
- The extension is configured to access `portal.aiub.edu` and uses your existing signed-in session when requesting materials.
- Use it only to access course resources you are authorized to download, and respect university rules and copyright.

## Contributing

Issues and pull requests for bug fixes, user-interface improvements, and compatibility updates are welcome.

## Disclaimer

This repository is an independent student utility and is **not an official AIUB product**.

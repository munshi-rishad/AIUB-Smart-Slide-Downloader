
# AIUB Smart Course Downloader

A Chrome extension that automatically detects, downloads, and organizes course materials from the AIUB Student Portal.

## Features

- Automatically detects active courses from the student dashboard.
- Finds and downloads available course materials.
- Skips previously downloaded files.
- Organizes materials into separate course folders.
- Shows download progress and status.
- Supports automatic scanning and manual re-checking.
- Saves files to Desktop/AIUB using the Windows helper.
- Uses Chrome Downloads when the helper is unavailable.

## Technologies

- JavaScript
- Chrome Extension (Manifest V3)
- Chrome Downloads API
- Chrome Native Messaging
- PowerShell
- Windows Batch

## Installation

1. Clone or download this repository.
2. Open `chrome://extensions/` in Google Chrome.
3. Enable **Developer Mode**.
4. Click **Load Unpacked**.
5. Select the `aiub-ext` folder.
6. For Desktop downloads, run `aiub-helper/install.bat` on Windows.
7. Reload the extension after installing the helper.

## How to Use

1. Visit https://portal.aiub.edu/
2. Log in using your own AIUB account.
3. Open your student dashboard.
4. The extension automatically scans active courses.
5. New materials are downloaded into course-specific folders.
6. Click the extension icon to scan again manually.

## Download Location

With the Windows helper installed:

    Desktop/
    └── AIUB/
        ├── Course A/
        │   ├── Lecture 01.pdf
        │   └── Slides.pptx
        └── Course B/
            └── Notes.pdf

Without the helper, files are saved in the configured Chrome Downloads directory.

## Privacy

- No password collection.
- Uses your existing authenticated portal session.
- Works with course materials you are authorized to access.

## Disclaimer

This is an unofficial student project and is not affiliated with or endorsed by American International University-Bangladesh (AIUB).

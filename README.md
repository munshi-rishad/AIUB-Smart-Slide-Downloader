# AIUB Smart Slide Downloader

A Chrome extension for AIUB students. Open your portal dashboard and it downloads only the new or missing course files from the portal and from your Microsoft Teams classes into `Desktop/AIUB/<Course>/`, numbered in course order.

**Semester:** Fall 2026-2027

## Features

- Greets you by name ("Welcome, Rishad") and checks your active courses only (dropped courses are skipped)
- Downloads from the portal **and** from the **Shared** tab of every Microsoft Teams class (folders and sub-folders included)
- Never downloads the same file twice; the same slide on the portal and on Teams is saved once
- Files are numbered by content: course outline first, then lectures/modules/chapters in their own order, then labs, assignments and exam material
- Every name ends with its source: `(PORTAL)`, `(TEAMS)`, `(PORTAL+TEAMS)`, `(TEAMS ZIP)`, `(PORTAL ZIP)`, in capital letters
- Zip files are unpacked into a folder named like the zip
- A file the teacher edits online is downloaded again; your old copy is kept in `Desktop/AIUB/_Old versions`
- Restores files you deleted
- **Asks before updating:** when a new version is out, the panel and a Windows notification show what is new with **Update now** / **Later**
- **Saved files follow every new version:** if a new version changes names, folders or tags, your existing files are renamed or moved automatically (nothing is downloaded twice, nothing is deleted)
- **Old semesters** button: pick an old semester and a course (or all courses) to download its files
- Progress bar per course; the panel closes by itself 2 seconds after finishing, never while your mouse is on it

## Technologies Used

- JavaScript (Chrome extension, Manifest V3)
- SharePoint REST API (read-only, with your own Teams sign-in)
- PowerShell (small Windows helper that saves files to the Desktop)
- Node.js (tests only, no packages)

## Project Structure

```
AIUB-Smart-Slide-Downloader/
├── Setup.bat              one-click setup and update
├── extension/             Chrome extension (load this folder)
│   ├── manifest.json      version, permissions and scripts
│   ├── lib.js             shared logic: names, numbering, duplicates, course matching, file index (settings in CFG)
│   ├── panel.js           the panel on the portal: scanning, update question, the main flow
│   ├── background.js      saving files, updates, message router
│   ├── teams.js           SharePoint/Teams client
│   ├── zip.js             reads and unpacks zip files without downloading all of them
│   ├── site-learner.js    remembers the Teams class sites you open
│   ├── changes.json       "what's new" text shown in the update question
│   └── icon16/48/128.png
├── helper/                Windows helper that saves files to Desktop/AIUB
│   ├── install.ps1
│   ├── host.ps1
│   └── host.bat
└── tests/                 node tests (no packages needed)
```

## Requirements

- Windows 10 or 11
- Google Chrome, signed in to the AIUB portal and Microsoft Teams in the same profile
- No admin rights needed

## Clone the Project

```bash
git clone https://github.com/munshi-rishad/AIUB-Smart-Slide-Downloader.git
```

Or download the ZIP from GitHub and extract it anywhere.

## Setup and Run

1. Double-click `Setup.bat`. It copies everything to `%LOCALAPPDATA%\AIUB-Smart-Slide-Downloader`, creates `Desktop/AIUB` and registers the helper. The downloaded folder can be deleted afterwards.
2. If you have several Chrome profiles, choose the one where you use the AIUB portal and Teams.
3. On the Chrome Extensions page turn on **Developer mode**, click **Load unpacked**, press Ctrl+V (the path is already copied) and select the folder. Chrome does not allow programs to install extensions silently, so this step is done once by hand.
4. Open your AIUB dashboard (`portal.aiub.edu/Student`). The panel appears and downloads your files.

Users of version 10.2 or older: run `Setup.bat` once with these files. After that, updates arrive by themselves.

## Updates

- Every 30 minutes, and each time the panel runs, the extension compares its version with `extension/manifest.json` on GitHub.
- A higher version is never installed without asking. The panel shows **New version vX is available**, what is new, and **Update now** / **Later**. A Windows notification asks the same, and the extension icon shows **NEW**.
- **Later** asks again after a day. **Update now** installs as soon as the current download is finished: the files are collected in a staging folder, swapped in all at once (rolled back if anything fails), and the extension reloads. The panel then says **Updated to vX** and brings your saved files up to date with the new version.
- To release a new version: raise `"version"` in `extension/manifest.json`, add a line for it in `extension/changes.json`, push to `main`.
- If a new version changes how the content of saved files is made, also raise `FILE_SCHEME` in `extension/lib.js`: every file is then downloaded once more and the old copies go to `_Old versions`.
- The helper (`helper/`) is never replaced by an update and makes no network connections. A change to `helper/` or `Setup.bat` reaches users only when they run `Setup.bat` again.
- Security: whoever can push to `main` can change the code that runs in every user's Chrome. Protect the GitHub account with two-factor authentication.

## How Saved Files Stay Up to Date

The extension remembers where every file came from (the portal link, the Teams file ID, the entry inside a zip), not only its name. On every run:

- a file that is already saved but has an old name or sits in an old folder is renamed or moved to the new place
- a file that changed online (other size) is downloaded again; the old copy goes to `_Old versions`
- an old `.zip` whose contents are now unpacked goes to `_Old versions`
- folders that became empty after moving are removed
- a file that is open in PowerPoint or Word is left alone and handled on the next run
- if Teams answered only partly, nothing is moved that run

Files are never deleted by the extension.

## Download an Old Semester

1. Click **Old semesters** in the panel (hover over the panel to keep it open).
2. Choose a semester, then a course or **All courses**, and press **OK**.

The portal switches back to your original semester when the panel closes.

## How Teams Works

Every Teams class keeps its Shared files in a SharePoint library (`aiubedu60714.sharepoint.com/sites/msteams_…`). The extension reads it with the sign-in of your Chrome profile. No password, token or Microsoft Graph app is used, and nothing on SharePoint is changed. Classes are matched to your portal courses by name and semester. If you are not signed in, the panel asks you to connect your Teams account (**Open Teams** / **Check again** / **Skip Teams**).

## Troubleshooting

- **"Setup needed"**: run `Setup.bat`, then press **Check again**.
- **"Wrong page"**: open the dashboard (`portal.aiub.edu/Student`).
- **A file failed**: press **Retry**; only the missing files are fetched.
- **"Connect your Teams account"**: sign in at teams.cloud.microsoft in this Chrome profile, then **Check again**.
- **A Teams class has no files**: open its **Shared** tab once in Teams, then run again.
- **"got a web page, not a file"**: log in to the portal again.
- **"Could not install vX"**: run `Setup.bat` from the latest download once.
- **Internet off or slow**: nothing is changed; each file is retried twice and half-written files are deleted.
- **Teams files over 300 MB** (meeting recordings) are skipped; change `MAX_FILE_MB` in `extension/lib.js` if needed.

## Is It Safe?

The source is small and fully readable. Nothing is hidden or packed.

- `Setup.bat` runs `helper/install.ps1` and opens Chrome. No admin rights.
- `helper/install.ps1` creates `Desktop/AIUB`, writes `com.aiub.downloader.json` and adds one registry value under `HKCU\Software\Google\Chrome\NativeMessagingHosts`. It does not read any Chrome data (only the names of the profile folders).
- `helper/host.ps1` saves the files sent by the extension into `Desktop/AIUB` and stores extension updates. No network access, no window.
- `extension/` talks only to `portal.aiub.edu`, AIUB's SharePoint and this GitHub repository (for updates).

If Windows warns: on SmartScreen click *More info* → *Run anyway* (only for a downloaded ZIP). If Defender removes a file, check *Windows Security → Protection history* and report it as a false positive at https://www.microsoft.com/wdsi/filesubmission. Please do not turn Defender off.

## Privacy

- Passwords are never read or stored.
- Only your first name, the addresses of your Teams class sites and the list of files the extension saved are remembered, inside Chrome.
- For updates the extension reads this repository on GitHub; no personal data is sent.

## Disclaimer

Unofficial student project, not affiliated with AIUB.

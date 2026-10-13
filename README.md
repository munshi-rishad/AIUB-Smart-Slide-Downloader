# AIUB Smart Slide Downloader

A Chrome extension for AIUB students. Open your portal dashboard and it downloads only the new or missing course files into `Desktop/AIUB/<Course>/`.

## Features

- Greets you by name ("Welcome, Rishad")
- Checks active courses only (dropped courses are skipped)
- Progress bar and new-file count for each course
- Never downloads the same file twice, and restores files you deleted
- Panel closes by itself 2 seconds after finishing

## Setup (Windows + Chrome, one time)

1. Download this repository and keep the folder somewhere permanent, for example `Documents`.
2. Double-click `Setup.bat`. It creates `Desktop/AIUB`, copies the `extension` folder path and opens `chrome://extensions`.
3. In Chrome, turn on **Developer mode**, click **Load unpacked**, paste the path (Ctrl+V) and select the folder.
4. Open your AIUB dashboard. Done.

Moved the folder or updated the extension? Run `Setup.bat` again and click reload on the extension.

## Folders

​```
Setup.bat      one-click setup
extension/     Chrome extension (load this folder)
helper/        small Windows helper that saves files to Desktop/AIUB
​```

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Setup needed" | Run `Setup.bat`, then press **Check again** |
| "Wrong page" | Open the dashboard (`portal.aiub.edu/Student`) |
| A file failed | Press **Retry** |
| "got a web page, not a file" | Log in to the portal again |

If the helper is not installed, files are saved in your Chrome Downloads folder under `AIUB/<Course>`.

## Privacy

- Passwords are never read or stored.
- Only talks to `portal.aiub.edu`, using your own logged-in session.
- Only your first name is remembered, to show the greeting.

## Disclaimer

Unofficial student project, not affiliated with AIUB.

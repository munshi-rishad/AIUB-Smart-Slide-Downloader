# AIUB Smart Slide Downloader

A Chrome extension for AIUB students. Open your portal dashboard and it downloads only the new or missing course files into `Desktop/AIUB/<Course>/`.

## Features

- Greets you by name ("Welcome, Rishad")
- Checks active courses only (dropped courses are skipped)
- Progress bar and new-file count for each course
- Never downloads the same file twice, and restores files you deleted
- Panel closes by itself 2 seconds after finishing
- Current semester is always downloaded automatically when you open the dashboard
- **Old semesters** button (dropped courses included): pick an old semester from the Registration list, see its courses, pick one (or **All courses**) and press **OK** to save its files into `Desktop/AIUB/<Course>`

## Setup (Windows + Chrome, one time)

1. Download this repository and keep the folder somewhere permanent, for example `Documents`.
2. Double-click `Setup.bat`. It creates `Desktop/AIUB`, copies the `extension` folder path and opens `chrome://extensions`.
3. In Chrome, turn on **Developer mode**, click **Load unpacked**, paste the path (Ctrl+V) and select the folder.
4. Open your AIUB dashboard. Done.

## Download an old semester manually

1. Open the dashboard and click **Old semesters** in the panel (hover over the panel to keep it open).
2. Choose a semester (same options as the Registration box, current semester excluded).
3. The active courses of that semester are listed. Select one (or **All courses**) and press **OK**.

The portal is switched back to your original semester when the panel closes.

Moved the folder or updated the extension? Run `Setup.bat` again and click reload on the extension.

## Demo video

[Watch the demo video](https://drive.google.com/file/d/1DQpTqMiXLZx4bEwWXZ304KWwHeznFBgC/view?usp=sharing)

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

## Is it safe? Antivirus and Windows warnings

The source is small and fully readable. Nothing is hidden, packed or downloaded.

| File | What it does |
| --- | --- |
| `Setup.bat` | Runs `helper/install.ps1`, opens the Chrome Extensions page. No admin rights. |
| `helper/install.ps1` | Creates `Desktop/AIUB`, writes `com.aiub.downloader.json` and adds one registry value under `HKCU\Software\Google\Chrome\NativeMessagingHosts`. |
| `helper/host.ps1` | Saves the files sent by the extension into `Desktop/AIUB`. No network access, no other programs. |
| `extension/` | Talks only to `portal.aiub.edu` with your own login. |

Because Chrome cannot write to the Desktop by itself, a tiny PowerShell helper is needed. Antivirus programs sometimes get suspicious of any `.bat`/`.ps1` file, so the scripts avoid `-ExecutionPolicy Bypass`, hidden windows, encoded commands and downloads.

If Windows still warns:

- **SmartScreen on `Setup.bat`** (only when you download the ZIP): click *More info* → *Run anyway*. Cloning with `git clone` does not show this.
- **Defender removes a file**: open *Windows Security → Protection history* to see which one. Please do not turn Defender off. Report it as a false positive at https://www.microsoft.com/wdsi/filesubmission and open an issue in this repository.
- **Not sure?** Read the four files above, they are short.

## Privacy

- Passwords are never read or stored.
- Only talks to `portal.aiub.edu`, using your own logged-in session.
- Only your first name is remembered, to show the greeting.

## Disclaimer

Unofficial student project, not affiliated with AIUB.

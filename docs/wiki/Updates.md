# Updates

## Built-in update check

PCVR StreamChat can check GitHub releases for updates on startup.

## Current release line

The current published release is `v1.0.0`.

### What it does

- checks the latest release from the GitHub repo
- compares it to the current installed version
- shows a popup with:
  - `Update now`
  - `Later`

`Update now` opens the latest installer or release page in your browser.

## Settings

Open `Settings > Integrations`.

- `Check for updates on startup`
- `Check now`

The version line in that section shows the current app version and explains that updates come from GitHub releases.

## Where updates come from

Releases are checked from:

- [github.com/daneleo35/PCVR-StreamChat/releases](https://github.com/daneleo35/PCVR-StreamChat/releases)

## Notes

- The current updater is a release checker and launcher, not an in-place silent patcher.
- It is designed to be simple and reliable for testing and GitHub-distributed builds.

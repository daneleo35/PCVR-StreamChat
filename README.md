# VR Chat Screen

VR Chat Screen is a Windows app for keeping stream chat visible while you're in SteamVR.

It can pull chat from Twitch, YouTube Live, and Kick, show it in a desktop window or a native VR overlay, display alerts in VR, and give you basic moderation and stream controls without needing to keep taking the headset off.

## Current Status

This version supports two modes:

- A normal transparent desktop overlay window.
- A native OpenVR overlay that publishes the chat panel and alerts into SteamVR.

## Features

- Multichat support for Twitch, YouTube Live, and Kick.
- Desktop overlay window that can be pinned with SteamVR Desktop.
- Native VR chat overlay for a read-only in-headset chat panel.
- VR alerts overlay with `Banner` and `Above chat` placement.
- Streamlabs Alert Box support in VR.
- In-app moderation for supported platforms, including delete, timeout, and ban actions where available.
- Stream controls for OBS or Streamlabs Desktop, including scene switching and audio controls.
- OAuth/API-first account login for Twitch, YouTube, and Kick.
- Emoji support, opacity controls, sizing options, timestamps, and compact overlay styling.
- Built-in update checker for GitHub releases.
- Tray menu support so the app can be hidden and restored quickly.


## Run It

```powershell
npm install
npm run build:openvr
npm start
```

Open settings to add your chat sources:

- Twitch channel names, without `https://twitch.tv/`.
- YouTube live URLs, video IDs, channel IDs, handles, or channel URLs.
- Kick channel names, without `https://kick.com/`.

For accounts and moderation, use the `Accounts` tab. OAuth/API is the main setup path, with browser fallback only where the app still needs it.

The app can also check GitHub releases for updates from `Settings > Integrations`.


## Use Native OpenVR Overlay

1. Start SteamVR.
2. Run `npm run build:openvr` once.
3. Run `npm start`.
4. Open settings and enable `OpenVR`.
5. Adjust X/Y/Z if the panel is out of view.

The native VR overlay is mainly intended as a clean chat display. If you want to interact with the app more directly, using SteamVR Desktop is still the easier option.

## Use Desktop Pinning / Change Settings

1. Start SteamVR.
2. Run `npm start`.
3. Open SteamVR Dashboard.
4. Open Desktop View and select the `VR Chat Screen` window.
5. Pin/place the window in your VR space.

## Build The Windows App

```powershell
npm run package
```

The packaged app will be created here:

```
dist\VR Chat Screen-win32-x64
```

<img width="775" height="891" alt="image" src="https://github.com/user-attachments/assets/e9004076-d7ef-4dee-9ea4-b3fa46f91d69" />
<img width="573" height="894" alt="image" src="https://github.com/user-attachments/assets/4e8ed2b5-2a86-4643-bda6-2f8a5df1f1a7" />
<img width="476" height="451" alt="image" src="https://github.com/user-attachments/assets/c3ceeeee-4474-4aa9-bc21-574a7736781b" />
<img width="571" height="890" alt="image" src="https://github.com/user-attachments/assets/e99388b8-620f-473d-ace8-00826a58b057" />




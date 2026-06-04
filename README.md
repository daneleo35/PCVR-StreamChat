# VR Chat Screen

VR Chat Screen is a transparent Windows overlay for streaming chat while playing SteamVR games. It reads public chat from Twitch, YouTube Live, and Kick, then renders a compact always-on-top window that can be pinned in SteamVR Desktop View, controller or wrist.

## Current Status

This version supports two modes:

- A normal transparent desktop overlay window.
- A native OpenVR overlay that publishes the chat panel and alerts into SteamVR .

## Features

- OAuth/API account login for Twitch, YouTube, and Kick - allows moderation for chats in the app without leaving VR.
- Transparent, resizable, always-on-top overlay window.
- Native OpenVR compositor overlay mode using Direct3D texture updates, with PNG file fallback.
- Stream tab with clickable scene and audio device controls for OBS or Streamlabs Desktop.
- Separate VR alerts overlay for `Banner` and `Above chat` placement for use with streamlabs alerts.
- Update checker with `Update now` or `Later` on startup.
- Compact mode, opacity, text size, emoji support, badges, timestamps
- Tray menu so the overlay can be hidden and restored.


## Run It

```powershell
npm install
npm run build:openvr
npm start
```

Open settings with the `S` button to add sources:

- Twitch channel names, without `https://twitch.tv/`.
- YouTube live URLs, video IDs, channel IDs, handles, or channel URLs.
- Kick channel names, without `https://kick.com/`.

Source changes auto-save and reconnect after you stop typing. Use `Reconnect now` only when you want to force an immediate reconnect.

YouTube channel and handle sources keep polling in the background. When a new public live stream appears, the app should attach without changing settings. Twitch and Kick stay connected by channel and retry if their connection drops.

For current account setup, use the `Accounts` tab. OAuth/API is now the preferred path. Browser fallback is still kept only where the app still depends on current site moderation helpers.

In `Settings > Integrations`, the app can check GitHub releases for updates on startup or on demand.


## Use Native OpenVR Overlay

1. Start SteamVR.
2. Run `npm run build:openvr` once.
3. Run `npm start`.
4. Open settings and enable `OpenVR`.
5. Adjust X/Y/Z if the panel is out of view.

## Use Desktop Pinning / Modify settings

1. Start SteamVR.
2. Run `npm start`.
3. Open SteamVR Dashboard.
4. Open Desktop View and select the `VR Chat Screen` window.
5. Pin/place the window in your VR space.

## Build The Windows App

```powershell
npm run package
```
EXE will be created here
```
dist\VR Chat Screen-win32-x64
```

## Coming in a future update


# VR Chat Screen

VR Chat Screen is a transparent Windows overlay for streaming chat while playing SteamVR games. It reads public chat from Twitch, YouTube Live, and Kick, then renders a compact always-on-top window that can be pinned in SteamVR Desktop View, controller or wrist.

## Current Status

This version supports two modes:

- A normal transparent desktop overlay window.
- A native OpenVR compositor overlay that publishes the chat panel into SteamVR as an overlay quad.

The recommended flow for `1.0.0` is:

- use the native OpenVR overlay as a **read-only chat display**
- use **SteamVR Desktop** to control the app itself
- use the separate VR alerts overlay for `Banner` or `Above chat`

## Features

- Twitch chat through anonymous IRC.
- YouTube Live chat by live video ID.
- Kick chat through the public channel chat websocket.
- OAuth/API account login for Twitch, YouTube, and Kick.
- Transparent, resizable, always-on-top overlay window.
- Native OpenVR compositor overlay mode using Direct3D texture updates, with PNG file fallback.
- Stream tab with clickable scene and audio device controls for OBS or Streamlabs Desktop.
- Separate VR alerts overlay for `Banner` and `Above chat` placement.
- GitHub release update checker with `Update now` or `Later` on startup.
- Compact mode, opacity, text size, emoji support, badges, timestamps, and click-through toggle.
- Tray menu so the overlay can be hidden and restored.

## Wiki

The editable local wiki source lives in [docs/wiki](C:/Users/dane/Documents/VR%20Screen/docs/wiki).

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

Click-through always starts off when the app opens, so the window cannot relaunch in an unclickable state. If you enable click-through, toggle it back off with `Ctrl+Shift+V`, `Ctrl+Alt+V`, `F8`, or the tray menu.

Move the desktop overlay by dragging the top title bar.

When the status bubbles do not fit, the bubble row automatically scrolls back and forth.

## Use Native OpenVR Overlay

1. Start SteamVR.
2. Run `npm run build:openvr` once.
3. Run `npm start`.
4. Open settings and enable `OpenVR`.
5. Adjust X/Y/Z if the panel is out of view.

Default placement is `x=0`, `y=1.35`, `z=-1.35`, which puts the overlay in front of you in standing-space coordinates.

## Use Desktop Pinning

1. Start SteamVR.
2. Run `npm start`.
3. Open SteamVR Dashboard.
4. Open Desktop View and select the `VR Chat Screen` window.
5. Pin/place the window in your VR space.
6. Use the crosshair button in the overlay to turn on click-through once it is positioned.

## Build The Windows App

```powershell
npm run package
```

To create a GitHub release installer:

```powershell
npm run installer
```

## Notes

- Twitch public chat does not require a token for reading messages.
- Twitch moderation should use OAuth/API.
- YouTube public live videos work best. Browser fallback is still used for some current moderation helper actions.
- Kick moderation now uses OAuth/API only. Timeout and ban are supported through the API path; delete is not available in the current app build.
- The OpenVR path submits live Direct3D 11 textures through `SetOverlayTexture`. If texture initialization fails, the host can still fall back to the older PNG-file update path.

- Coming in a future update

A few new features are currently being worked on. A lot of this is still early and not fully working yet, so there’s no ETA at the moment.

## To come
- In-headset alerts - Alerts for things like donations, new members, and other stream events shown directly inside the headset.
- BS / Streamlabs control - Control your stream from the app using SteamVR Desktop mode or the overlay. This includes changing audio levels, muting and unmuting sources, and switching scenes in OBS or Streamlabs.
- Overlay tabs - Tabs inside the overlay to switch between different sections more easily.
- Chat moderation - Moderate chat directly from inside the app without needing to leave VR.

The OBS / Streamlabs controls may stay focused around SteamVR Desktop Window mode, as it is much easier to read and use compared to squeezing everything into the overlay.

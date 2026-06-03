# Features

## Chat

- Merged chat feed for `Twitch`, `YouTube Live`, and `Kick`
- Platform-colored message chips
- Badges, timestamps, compact mode, and text scaling
- Status bubbles for platform connection state
- Auto-reconnect and polling for supported sources

## Stream controls

- `Stream` tab built for SteamVR Desktop use
- Clickable scene list instead of scene-only dropdown control
- Audio device list with mute and unmute controls
- Provider switching between `OBS` and `Streamlabs Desktop`
- Refresh, connect, and disconnect controls

## VR overlay

- Native OpenVR overlay mode for read-only chat display in headset
- World and controller anchor options
- Size, alpha, and transform controls
- Overlay self-heal work for cases where SteamVR hides it unexpectedly
- Simpler VR chat surface tuned for stability while still showing emoji/emotes

## Alerts

- Browser-source based alerts support
- `Streamlabs Alert Box` can be used as the primary alert source
- Separate VR alert overlay with placement options:
  - `Banner`
  - `Above chat`
- Adjustable alert scale

## Accounts and auth

- OAuth/API-first setup for Twitch, YouTube, and Kick
- Dashboard links for provider app creation
- YouTube auth mode switch:
  - `OAuth / API`
  - `Browser fallback`

## Moderation

- Twitch moderation supports delete, timeout, and ban
- YouTube supports the current live moderation flow, with browser fallback still available
- Kick timeout and ban use OAuth/API
- Kick delete is not available in the current app build

## Desktop overlay

- Transparent always-on-top desktop window
- Tray support
- Click-through toggle
- Built to work well with SteamVR Desktop pinning

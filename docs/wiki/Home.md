# PCVR StreamChat Wiki

PCVR StreamChat is a Windows chat overlay for SteamVR and SteamVR Desktop. The current direction is:

- use the native VR overlay mainly as a **read-only chat display**
- use **SteamVR Desktop** to control the app
- keep platform auth on **OAuth/API first**
- keep browser fallback only where the current platform flow still needs it
- use a separate VR alerts overlay for `Banner` or `Above chat`

## Wiki pages

- [Features](./Features.md)
- [Account Setup](./Account-Setup.md)
- [How To Use It](./How-To.md)
- [Troubleshooting](./Troubleshooting.md)
- [Updates](./Updates.md)

## Quick links

- Twitch developer dashboard: [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps)
- Google Cloud credentials: [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
- Kick developer dashboard: [kick.com/settings/developer](https://kick.com/settings/developer)
- Kick app setup docs: [docs.kick.com/getting-started/app-setup](https://docs.kick.com/getting-started/app-setup)
- Kick moderation API: [docs.kick.com/apis/moderation](https://docs.kick.com/apis/moderation)
- Latest releases: [github.com/daneleo35/PCVR-StreamChat/releases](https://github.com/daneleo35/PCVR-StreamChat/releases)

## Current platform model

### Twitch

- Chat reading works without browser sign-in.
- Moderation is intended to use OAuth/API.
- Browser session auth is no longer the preferred route.

### YouTube

- Normal public live chat is supported.
- OAuth/API is preferred.
- Browser fallback can still be used for the current moderation helper path.

### Kick

- Chat reading works by channel.
- Timeout and ban use OAuth/API.
- Delete is not available in the current app build.

## Current app layout

### Main window

- `Chat` tab: merged cross-platform chat feed
- `Stream` tab: scene list, audio device list, and provider controls
- top status bubbles: platform and overlay/provider state

### Settings tabs

- `Sources`
- `Integrations`
- `Accounts`
- `VR`
- `Moderation`

## Notes

- This local wiki copy is the editable source for the GitHub Wiki.

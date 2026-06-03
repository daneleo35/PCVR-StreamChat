# How To Use It

## Quick start

1. Launch `PCVR StreamChat`.
2. Open `Settings`.
3. In `Sources`, add your Twitch channels, YouTube source, and Kick channels.
4. In `Accounts`, connect the platforms you want to moderate through OAuth/API.
5. In `Integrations`, choose `OBS` or `Streamlabs Desktop`.
6. In `Stream`, refresh provider state and test scene or audio controls.

## Use it with SteamVR Desktop

This is the recommended control flow right now.

1. Start SteamVR.
2. Launch PCVR StreamChat.
3. Open SteamVR Desktop view.
4. Select the PCVR StreamChat window.
5. Pin or place the window where you want it.
6. Use the `Stream` tab for scenes and audio.
7. Use `Chat` for message viewing and moderation popup actions.

## Use the native VR overlay

The native VR overlay is best treated as the in-headset chat display, not the main control surface.

1. Start SteamVR first.
2. Open `Settings > VR`.
3. Turn on `OpenVR`.
4. Choose anchor and position.
5. Adjust `Size m`, `Alpha`, and transform values as needed.
6. Keep app control in SteamVR Desktop and use the native overlay mainly for viewing chat.

If it does not appear right away, see [Troubleshooting](./Troubleshooting.md).

## Connect OBS

1. Open `Settings > Integrations`.
2. Choose `OBS`.
3. Fill in host, port, and password if needed.
4. Turn on `Auto-connect provider` if you want it each launch.
5. In the `Stream` tab, click `Refresh`.

## Connect Streamlabs Desktop

1. Open `Settings > Integrations`.
2. Choose `Streamlabs Desktop`.
3. In the `Stream` tab, click `Connect` and then `Refresh`.
4. Use the scene and audio lists directly.

## Set up alerts

1. Open `Settings > Integrations`.
2. In `Alerts`, choose the primary alert source.
3. If using Streamlabs, paste your `Streamlabs Alert Box URL`.
4. Choose VR alert position and scale.
5. Use `Banner` for a headset-centered alert or `Above chat` for a separate alert overlay near the chat panel.

## Moderate a message

1. Go to the `Chat` tab.
2. Click a message.
3. Use the popup actions such as `Delete`, `Timeout`, or `Ban`.

Platform behavior depends on the current API support and login mode for that service.

# Troubleshooting

## OAuth login does not complete

- Check that the redirect URL exactly matches the app setup:
  - Twitch: `http://localhost:38947/callback/twitch`
  - YouTube: `http://localhost:38947/callback/youtube`
  - Kick: `http://localhost:38947/callback/kick`
- Use `localhost`, not `127.0.0.1`, for provider setup unless the provider explicitly supports it.
- Make sure the client ID and client secret are pasted into `Accounts`.

## YouTube says the app is still in testing

- Add your Google account as a `Test user` in the Google consent screen.
- For personal use, that is usually enough.
- If you need broader access, move the consent screen to production in Google Cloud.

## OBS or Streamlabs scenes do not load

- Open `Settings > Integrations`.
- Confirm the correct provider is selected.
- Click `Connect`.
- Click `Refresh` in the `Stream` tab.

For OBS, also double-check host, port, password, and that OBS WebSocket is enabled.

## The VR overlay does not appear

- Start SteamVR before turning on `OpenVR`.
- Open `Settings > VR` and confirm `OpenVR` is enabled.
- Try toggling the `SteamOverlay` status bubble once.
- If it still does not appear, use `Reconnect now`.

## The VR overlay appears and then disappears

- The app now tries to restore a hidden overlay automatically.
- If it still vanishes, toggle the overlay off and back on once.
- If the problem keeps happening, collect the exact behavior:
  - disappears immediately or after a while
  - comes back by itself or stays gone

## Kick delete does not work

That is expected right now. Kick delete is not available in the current build.

## Kick timeout or ban does not work

- Make sure Kick OAuth/API login is connected in `Accounts`.
- Recheck the Kick client ID and client secret.
- Confirm your Kick app has the required moderation scope.

## YouTube moderation works only in browser fallback

That can still happen depending on the action and current live chat flow. If OAuth/API is connected but you still need the helper path:

1. Open `Accounts`
2. Set YouTube login mode to `Browser fallback`
3. Sign in there
4. Retry the moderation action

## Packaged build fails because files are in use

Close any running packaged copy of PCVR StreamChat, then run packaging again.

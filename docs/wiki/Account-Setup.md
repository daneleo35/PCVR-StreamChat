# Account Setup

## Redirect URLs

Use these OAuth redirect URLs when creating platform apps:

- Twitch: `http://localhost:38947/callback/twitch`
- YouTube: `http://localhost:38947/callback/youtube`
- Kick: `http://localhost:38947/callback/kick`

## Twitch

Dashboard: [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps)

1. Open the Twitch developer dashboard.
2. Register an application.
3. Add `http://localhost:38947/callback/twitch` as the OAuth redirect URL.
4. Copy the Twitch `client ID` and `client secret`.
5. In the app, open `Accounts`.
6. Paste the Twitch credentials.
7. Click `Login to Twitch`.

Note:

- Use `localhost`, not `127.0.0.1`, in the Twitch app dashboard.

Expected result:

- `Twitch API connected` shows in the app.
- Twitch moderation uses OAuth/API.

## YouTube

Dashboard: [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)

1. Open Google Cloud Console.
2. Create or select a project.
3. Configure the OAuth consent screen if Google prompts you to.
4. Add yourself as a test user if the consent screen is still in `Testing`.
5. Create an OAuth client.
6. Use `Desktop app` if available for your workflow, or a client type that allows the redirect URL above.
7. Copy the Google `client ID` and `client secret`.
8. In the app, paste them into the YouTube account section.
9. Click `Login to YouTube`.

Expected result:

- `YouTube API connected` shows in the app.

Important:

- Public live streams are the supported target.
- Browser fallback is still currently used for some YouTube moderation helper actions.
- If the Google app stays in `Testing`, only users added under `Test users` can log in.
- If you want wider access without adding test users manually, Google requires you to move the consent screen to `In production`.
- For personal use on your own account, leaving the app in `Testing` is usually fine as long as your Google account is added as a test user.

## Kick

Dashboard: [kick.com/settings/developer](https://kick.com/settings/developer)

Docs: [docs.kick.com/getting-started/app-setup](https://docs.kick.com/getting-started/app-setup)

Moderation API: [docs.kick.com/apis/moderation](https://docs.kick.com/apis/moderation)

1. Open the Kick developer dashboard.
2. Create your Kick app.
3. Add `http://localhost:38947/callback/kick` as the redirect URL.
4. Copy the Kick `client ID` and `client secret`.
5. In the app, paste them into the Kick account section.
6. Click `Login to Kick`.

Expected result:

- `Kick API connected` shows in the app.
- Kick timeout and ban can use the official moderation API.

Current limitation:

- Kick timeout and ban use OAuth/API. Kick delete is not available in the current app build.

## Browser fallback

Only keep browser fallback signed in where it still helps:

- `YouTube`: current moderation helper fallback
- `Kick`: no browser fallback path is currently used

Twitch browser sign-in is not the preferred path anymore.

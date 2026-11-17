# SpeedClipper Web (MERN)

The online dashboard for SpeedClipper. Add creators, watch clips, connect YouTube + Instagram, and change settings,
from any device. Your laptop runs the Python engine (`../speed-clipper`) as the **worker**: it records streams, finds
moments and edits clips, then syncs with this server.

```
browser ──► Express API + React app (Render)  ◄── worker API (X-Worker-Key) ── laptop: Python engine
                 │                                                                (record, Whisper, ffmpeg)
                 └── MongoDB Atlas: creators, clips (+ thumbnails/previews in GridFS), settings, encrypted tokens
```

## Landing page

Signed-out visitors get a light, minimal landing page at `/`: a simple navbar (How it works, Features, FAQ, Log in,
Sign up), a hero photo with the engine's word-by-word caption style playing over it, three numbered steps, two
photo-and-text feature rows, a short FAQ and a full-width closing photo. Fonts (Inter, Instrument Serif) are self-hosted
and the photos are free-license Unsplash images in `client/public/landing/` (WebP, credited in the footer; no streamer
likenesses). Sections fade in on scroll, and motion respects *reduce motion*. The log-in and sign-up screens use the
same light style. `/signup` creates the single owner account the first time; afterwards it explains that you should
log in. `/login` goes straight to the dashboard.

The whole site shares one light design: colors are tokens in `client/src/index.css` (`@theme`), so changing
the theme there restyles every page. Charts use the validated light categorical palette (slots 1–4) with
legends and table views.

## Features

| Page | What you can do |
|---|---|
| **Overview** | laptop status (online/paused/recording) with **pause/resume** from your phone, live recording timers, KPI tiles with 7-day trends, latest clips, live activity feed, *clip a past stream (VOD)* |
| **Streams** | who's live right now (duration, chat, moments, clips) and the history of every recorded stream |
| **Activity** | every event (went live, stream ended, new clip, approved, published, failed, settings, laptop online/offline), the commands sent to the laptop with their results, and the laptop's live log |
| **Review** | one clip at a time, autoplaying: fix the title, pick YouTube/Instagram, then **approve (A / swipe right), reject (R / swipe left), skip (S)**; the fastest way to clear the queue from a phone |
| **Clips** | search, status tabs with counts, creator filter, sort by newest/best score, **select mode with bulk approve/reject/delete**, load more; clip editor with preview player, title/description/tags (credit can't be removed), per-platform publish status + links, **retry failed uploads** |
| **Publishing** | per-platform queue in publish order with **estimated times** (from your daily limit and spacing), **⚡ publish next** to jump a clip to the front, failed uploads with retry |
| **Analytics** | 7/14/30/90-day: clips per day by outcome, published per day by platform, score distribution, creator leaderboard, top clips (charts with hover tooltips and table views) |
| **Creators** | add YouTube/Twitch channels; monitor, auto-upload, YouTube/Instagram targets per creator; **check now** / **stop recording** remotely; credit line, tags, hashtags, layout |
| **Accounts** | connect YouTube and Instagram (OAuth on the server); **AI scoring key** (stored encrypted, only sent to the laptop) |
| **Settings** | publishing, detection and editing settings (applied by the laptop within a minute); change password (signs out other devices); how to link the laptop |

**Phone app:** installable (PWA: Android *Install app*, iPhone *Add to Home Screen*) with **system notifications** when a stream goes live, a clip needs review or an upload finishes (Settings → This device). The service worker caches only the app shell, never your data.

**Real-time:** the site keeps a Server-Sent Events stream open, so pages refresh the moment something changes and important
events pop up as notifications (with polling as a fallback). **Remote control:** commands (pause, resume, check now,
stop recording, process VOD) are queued on the server, delivered in the laptop's next heartbeat (≤ 30 s), and their
results show in Activity. Installs nothing extra on the laptop: it's the same `speed-clipper` engine in cloud mode.

## Run locally
```bash
cd server && npm install && npm run dev        # API on :4000; without MONGODB_URI, data is saved in server/.data
                                               # (DEV_DATA_DIR=memory for a throwaway database)
cd client && npm install && npm run dev        # React on :5173 (proxies /api to :4000)
```
The first visit asks you to create the **owner account**; nobody else can ever sign up.

## Tests
```bash
cd server && npm test      # 28 tests: auth, creators, worker flow, commands, sessions, queue ETAs, bulk, analytics, secrets, SSE, offline detection
```

## Deploy (free): MongoDB Atlas + Render
1. **Atlas:** create a free M0 cluster and a database user. Under Network Access allow `0.0.0.0/0` (Render has no fixed IP),
   then copy the `mongodb+srv://…` connection string.
2. **Render:** New → Blueprint → this repo (`render.yaml`). Set `MONGODB_URI`, `PUBLIC_URL` (your `https://….onrender.com`),
   and `ENCRYPTION_KEY` (64 hex chars: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
   `JWT_SECRET` and `WORKER_KEY` are generated for you.
3. **YouTube:** Google Cloud → Credentials → *Create OAuth client ID → Web application*, redirect URI
   `PUBLIC_URL/api/accounts/youtube/callback`. Put its id and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. **Instagram:** developers.facebook.com → Create app → *Facebook Login for Business* + *Instagram Graph API*.
   Redirect URI `PUBLIC_URL/api/accounts/instagram/callback`. Put the id and secret in `META_APP_ID` / `META_APP_SECRET`.
5. Open the site, create the owner account, then go to **Accounts → Connect**.

Render's free plan sleeps after 15 min idle; the laptop worker's 30-second heartbeat keeps it awake while the laptop is on.

## Security
- Single owner account (bcrypt), JWT in an httpOnly SameSite cookie, failed-login rate limit, password change signs out other devices.
- Writes from other origins are rejected; strict Content-Security-Policy via helmet.
- YouTube and Instagram tokens are AES-256-GCM encrypted in MongoDB. The worker only receives short-lived YouTube access tokens.
- Instagram fetches each video from a one-time random URL that is deleted after publishing.

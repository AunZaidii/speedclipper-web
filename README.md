# SpeedClipper Web (MERN)

The online dashboard for SpeedClipper. Add creators, watch clips, connect YouTube + Instagram, and change settings,
from any device, for **any number of users**. A server runs the Python engine (`../speed-clipper`, in Docker) as the
**worker**: it records streams, finds
moments and edits clips, then syncs with this server.

```
browser ──► Express API + React app (Render)  ◄── worker API (X-Worker-Key) ── server: Python engine (Docker)
                 │                                                                (record, Whisper, ffmpeg)
                 └── MongoDB Atlas: creators, clips (+ thumbnails/previews in GridFS), settings, encrypted tokens
```

## Landing page

Signed-out visitors get a light, minimal landing page at `/`: a simple navbar (How it works, Features, FAQ, Log in,
Sign up), a hero photo with the engine's word-by-word caption style playing over it, three numbered steps, two
photo-and-text feature rows, a short FAQ and a full-width closing photo. Fonts (Inter, Instrument Serif) are self-hosted
and the photos are free-license Unsplash images in `client/public/landing/` (WebP, credited in the footer; no streamer
likenesses). Sections fade in on scroll, and motion respects *reduce motion*. The log-in and sign-up screens use the
same light style. Anyone can sign up at `/signup` (the first account is the **admin**); `SIGNUP_OPEN=false` closes
sign-up. `/login` goes straight to the dashboard.

The whole site shares one light design: colors are tokens in `client/src/index.css` (`@theme`), so changing
the theme there restyles every page. Charts use the validated light categorical palette (slots 1–4) with
legends and table views.

## Accounts for everyone

| | Each user | The admin (first account) also |
|---|---|---|
| Data | own creators, clips, review queue, publishing queue, analytics, activity | sees the worker's host, disk and log |
| Accounts | connects **their own** YouTube and Instagram | sets the AI scoring key (used for every clip) |
| Settings | own publishing settings: privacy, daily limit, spacing, approval, min score, tags | detection and video style for the whole site |
| Pause | pauses their own monitoring | pauses the whole worker |

**One recording per channel.** The worker gets each channel once, however many users follow it (`channelId` =
hash of platform + handle), records and clips it once, and sends each clip once. The website gives every follower
their own copy (own title, credit line, approval, privacy, upload to their own channel) sharing the thumbnail and
preview files; a file is deleted when no copy uses it. "Stop recording" stops clips for that user; the worker only
stops when nobody following the stream still wants it. A past stream (VOD) goes only to the user who asked for it.

**YouTube upload allowance.** All users share one Google Cloud project, whose `videos.insert` allowance is per day;
`YOUTUBE_PROJECT_DAILY_UPLOADS` (default 90) stops jobs before Google does. Raise both via Google's quota form.
While the Google app is in *Testing*, only its listed test users (max 100) can connect YouTube, and Instagram needs
Meta app review before people other than the app's admins/testers can connect.

**Upgrading** from the single-owner version is automatic: on start, `migrate()` makes the first user the admin, gives
them all existing data, splits the settings and replaces the old one-owner unique indexes. Back up first with
`node scripts/db-backup.js <folder>` (`MONGODB_URI` set).

## Features

| Page | What you can do |
|---|---|
| **Overview** | clipping-server status (online/paused/recording) with **pause/resume** from your phone, live recording timers, KPI tiles with 7-day trends, latest clips, live activity feed, *clip a past stream (VOD)* |
| **Streams** | who's live right now (duration, chat, moments, clips) and the history of every recorded stream |
| **Activity** | every event (went live, stream ended, new clip, approved, published, failed, settings, server online/offline), the commands sent to the servop with their results, and the laptop's live log |
| **Review** | one clip at a time, autoplaying: fix the title, pick YouTube/Instagram, then **approve (A / swipe right), reject (R / swipe left), skip (S)**; the fastest way to clear the queue from a phone |
| **Clips** | search, status tabs with counts, creator filter, sort by newest/best score, **select mode with bulk approve/reject/delete**, load more; clip editor with preview player, title/description/tags (credit can't be removed), per-platform publish status + links, **retry failed uploads** |
| **Publishing** | per-platform queue in publish order with **estimated times** (from your daily limit and spacing), **⚡ publish next** to jump a clip to the front, failed uploads with retry |
| **Analytics** | 7/14/30/90-day: clips per day by outcome, published per day by platform, score distribution, creator leaderboard, top clips (charts with hover tooltips and table views) |
| **Creators** | add YouTube/Twitch channels; monitor, auto-upload, YouTube/Instagram targets per creator; **check now** / **stop recording** remotely; credit line, tags, hashtags, layout |
| **Accounts** | connect YouTube and Instagram (OAuth on the server); **AI scoring key** (admin; stored encrypted, only sent to the worker) |
| **Settings** | publishing, detection and editing settings (applied within a minute); change password (signs out other devices); how to link the laptop |

**Phone app:** installable (PWA: Android *Install app*, iPhone *Add to Home Screen*) with **system notifications** when a stream goes live, a clip needs review or an upload finishes (Settings → This device). The service worker caches only the app shell, never your data.

**Real-time:** the site keeps a Server-Sent Events stream open, so pages refresh the moment something changes and important
events pop up as notifications (with polling as a fallback). **Remote control:** commands (pause, resume, check now,
stop recording, process VOD) are queued on the website, delivered in the worker's next heartbeat (≤ 30 s), and their
results show in Activity. The worker is the same `speed-clipper` engine in cloud mode.

## Run locally
```bash
cd server && npm install && npm run dev        # API on :4000; without MONGODB_URI, data is saved in server/.data
                                               # (DEV_DATA_DIR=memory for a throwaway database)
cd client && npm install && npm run dev        # React on :5173 (proxies /api to :4000)
```
The first account you create is the **admin**; anyone can sign up after that (`SIGNUP_OPEN=false` to stop it).

## Tests
```bash
cd server && npm test      # 38 tests: multi-user isolation, shared channels, migration, auth, creators, worker flow, commands, sessions, queue ETAs, bulk, analytics, secrets, SSE, offline detection
```

## Deploy (free): MongoDB Atlas + Render
1. **Atlas:** create a free M0 cluster and a database user. Under Network Access allow `0.0.0.0/0` (Render has no fixed IP),
   then copy the `mongodb+srv://…` connection string. Optional: `cd server`, set `MONGODB_URI`, then
   `npm run db:setup` creates every collection and index up front and prints a report (the server also builds
   missing indexes on start, so this is safe to skip or re-run).
2. **Render:** New → Blueprint → this repo (`render.yaml`). Set `MONGODB_URI`, `PUBLIC_URL` (your `https://….onrender.com`),
   and `ENCRYPTION_KEY` (64 hex chars: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
   `JWT_SECRET` and `WORKER_KEY` are generated for you.
3. **YouTube:** Google Cloud → Credentials → *Create OAuth client ID → Web application*, redirect URI
   `PUBLIC_URL/api/accounts/youtube/callback`. Put its id and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. **Instagram:** developers.facebook.com → Create app → *Facebook Login for Business* + *Instagram Graph API*.
   Redirect URI `PUBLIC_URL/api/accounts/instagram/callback`. Put the id and secret in `META_APP_ID` / `META_APP_SECRET`.
5. Open the site, create your account (the first one is the admin), then go to **Accounts → Connect**.
6. Start the worker on a server: see `../speed-clipper/README.md` section 0c (`bash deploy/setup-server.sh`).

Render's free plan sleeps after 15 min idle; the worker's 30-second heartbeat keeps it awake.

## Security
- Accounts with bcrypt passwords, admin/user roles, every query limited to the signed-in user's own data, JWT in an httpOnly SameSite cookie, failed-login rate limit, password change signs out other devices.
- Writes from other origins are rejected; strict Content-Security-Policy via helmet.
- YouTube and Instagram tokens are AES-256-GCM encrypted in MongoDB. The worker only receives short-lived YouTube access tokens.
- Instagram fetches each video from a one-time random URL that is deleted after publishing.

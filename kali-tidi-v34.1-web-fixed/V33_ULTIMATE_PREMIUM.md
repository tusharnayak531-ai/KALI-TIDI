# Kaali Ni Tidi v33 — Ultimate Premium Edition

v33 is the release-polish upgrade on top of v32 Premium and v31 Competitive.

## New in v33
- Premium five-tab lobby navigation: Home, Play, Competitive, Profile, Settings.
- Reconnect card on startup for unfinished matches and existing reconnect snapshot flow.
- Cinematic match flow: ready/deal countdown, Hukum lock, partner reveal, final result.
- Animated live bid bubble on the bidder seat and dealer marker/rotation retained.
- XP + player levels, Bronze/Silver/Gold/Platinum/Diamond/Master rank presentation.
- Daily challenges retained plus weekly missions.
- Ranked matchmaking now groups players into approximate rating bands.
- Share-room action and real QR invite generation through the authoritative server.
- Emoji/reaction wheel with table-wide reaction animation.
- Host voice mute control in addition to kick/report/chat moderation.
- Hard bots now use exposed-card memory and more deliberate valuable-trick decisions.
- Match highlights: biggest trick, highest capture, bidder margin/performance.
- Existing replay/audit viewer, friends online/invites, tournaments and achievements retained.
- Guided first-game coach highlights bidding, contract selection and legal card play.
- Installable web PWA shell with service-worker caching.
- Maintenance screen and server/client version update check.
- Privacy, Terms, Rules and About release pages in-app.
- Existing client crash/unhandled-promise reporting retained; admin report dashboard now supports 24-hour account suspension for account-backed reports.
- Android version 3.3 / versionCode 21.

## Fair-play/privacy invariants retained
- Server remains authoritative for shuffle, bids, contract, legal cards, scoring, turn order and timeouts.
- Called partner card is public after contract, but partner identity remains hidden until that exact physical card is played.
- Contract succeeds when bidder team points are **greater than or equal to** the bid.
- Hidden partner ownership is not inferred in live score presentation before reveal.
- No wallet, cash wagering or real-money betting.

## New optional environment variables
- `PUBLIC_GAME_URL` — canonical public URL used in room QR invites.
- `MIN_CLIENT_VERSION` — minimum accepted/displayed client version for update prompts.
- `MAINTENANCE_MODE=true` — blocks new room creation/join/ranked queue and shows maintenance UI.
- `MAINTENANCE_MESSAGE` — custom maintenance message.

QR generation adds the `qrcode` npm dependency. Run `npm install` after deployment/package update.

## v33.1 Android packaging hardening
- Restored the complete root `public/` source to make `npx cap sync android` safe.
- Added pre-sync package validation.
- Added a local static preview server and `/health` endpoint.
- Disabled Android app backups and cleartext HTTP traffic.
- Marked microphone hardware optional while preserving voice-chat permission.
- Android versionName 3.3.1 / versionCode 22.

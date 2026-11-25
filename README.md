# VEYRA

VEYRA is a native-first dating app built with React Native and Expo. Supabase
Auth manages accounts and sessions; AsyncStorage keeps sessions, onboarding,
and profile data on the device. The app includes Google, email/password, and
iOS Apple sign-in.

## Get started

```sh
npm install
npm start
```

`npm start` explicitly opens the project in Expo Go. AsyncStorage and the
onboarding photo picker are available there.

Run the development app in a browser with `npm run web`. Native-only features,
such as Apple sign-in and camera capture, require a supported native device.

## Supabase Auth setup

1. Create a Supabase project and enable email/password in **Authentication →
   Providers**.
2. Copy the project URL and anon/publishable key to `.env` as
   `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. These are
   public client values; never put the service-role key in the app.
3. Configure Google and Apple providers in Supabase if you want to enable
   social sign-in. Keep the platform OAuth client IDs in `.env`.
4. Configure your Supabase Auth site URL and redirect allowlist for the Expo
   AuthSession redirect URIs used by the app.

Email signup, sign-in, and confirmation are handled directly by Supabase Auth.
If Supabase email confirmation is enabled, the app asks the user to confirm
their address before logging in.
Existing Firebase accounts are not automatically migrated to Supabase Auth;
users need to create a Supabase account.

VEYRA is an adults-only dating platform for people aged 18 and older. Email
sign-up requests a birthday before creating an account; social sign-ins must
pass the same birthday check during onboarding before accessing discovery.
Apply `supabase/migrations/20261123160000_adult_only_platform.sql` to
reject invalid or under-18 birthdays on dating-profile writes.

### Local development without email confirmation

The local Supabase Auth configuration disables email confirmations for
development. From the repository root, run `supabase start`, then set
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `.env` to the
local API URL and anon key printed by the CLI. Restart Expo after changing
these values. New local email accounts can then sign in without confirming an
email address. This setting applies only to the local Supabase stack; hosted
projects keep their own Auth email-confirmation setting.

If the app uses a hosted development project instead, open that project's
Supabase Dashboard and disable **Confirm email** under **Authentication →
Providers → Email**. This changes only the selected project; do not disable
confirmation for production. Restart Expo after changing project settings.
Accounts created before confirmation was disabled may still need to be
confirmed or recreated for testing. The app does not bypass Supabase's
confirmation requirement.

## Onboarding and demo data

After authentication, users complete their dating intentions, profile, Dating
DNA, and match preferences before reaching Discover. Profile data is saved in
the Supabase `dating_profiles` table, so returning users continue at their
first incomplete step and completed users go straight to Discover. Existing
local profiles are copied to Supabase when a user first signs in after this
update. Profile photos are selected from the device. Users can select a South
African city or optionally use GPS; exact coordinates are stored privately and
never returned in discovery profile cards.

For development-only Explore testing, `supabase/seed/explore_test_users.sql`
creates or refreshes 200 confirmed, photo-free test accounts across five cities.
Apply the Discovery, Explore, and photo-free Explore migrations first. In the
seed script, first verify the Supabase SQL Editor is connected to the
development project, then replace the `v_password` placeholder with the shared
test password before running the whole script. Do not commit the password or
run the script against production. The seed is repeatable and does not delete
users.

Apply `supabase/migrations/20261119000000_dating_profiles.sql` to your
Supabase project before using profile sync, then apply
`supabase/migrations/20261119010000_profile_photo_storage.sql` to
configure private photo storage, then apply
`supabase/migrations/20261119020000_profile_voice_storage.sql` to
configure private voice-introduction storage. Row-level security restricts
each account to its own profile and storage objects. `profile.photos` and
`profile.voiceIntroUri` store object paths in their respective buckets; media
is uploaded to Storage and short-lived signed URLs are used for playback and
display. Local profile fields are cached for device continuity, but media
bytes are not retained as the saved profile. After a successful upload, the
app removes its locally recorded voice-introduction file. Photo and identity
verification are not complete yet. The photo step currently lets users take
and preview a temporary selfie on their device; it is not uploaded and does
not change verification status. Also apply
`supabase/migrations/20261119030000_unique_profile_nicknames.sql` to
migrate existing names and enforce case-insensitive nickname uniqueness, then
apply `supabase/migrations/20261119040000_user_privacy_settings.sql` to
create the private, per-account discovery and visibility settings table. Users
can only read and update their own settings. The Daily 5 feed applies the
discovery visibility preferences after its migration and Edge Function are
deployed. Apply
`supabase/migrations/20261119050000_user_blocks_and_hidden_profiles.sql`
to create `blocked_users` and the text-based `hidden_profiles` list. RLS ensures
each member can only view and manage their own records. The lists can be managed
from Discovery and Profile settings. Privacy settings and these lists are cached
per account in AsyncStorage for five minutes; successful changes update the
cache, and account deletion removes it.

Apply `supabase/migrations/20261120000000_user_verifications.sql` for
the verification dashboard. Email confirmation status is synced from Supabase
Auth by a database trigger; users can read but cannot edit their
verification records. Verification status is cached per account in AsyncStorage.
Photo verification currently provides selfie capture and preview only; no
verification result is submitted. Identity verification is not implemented.
Their statuses remain not started until approved by a trusted verification
process. Apply
`supabase/migrations/20261120020000_public_identity_verified_badges.sql`
after the verification migration to expose only the user IDs whose identity
checks have been marked `verified` by a trusted process. The app uses that
approved status to display the green Identity Verified badge; pending and
rejected statuses are never exposed by the badge view, and mobile clients have
no permission to change verification records.
If the earlier verification migration was already applied, also apply
`supabase/migrations/20261120010000_remove_phone_verification.sql` to
remove the unused phone verification field.

Apply
`supabase/migrations/20261120030000_user_notification_settings.sql`
for account-scoped notification preferences, including delivery channels,
activity categories, quiet hours, and lock-screen previews. Row-level security
allows users to manage only their own settings. Security alerts are enforced
as always enabled. Settings are cached per account for five minutes. These
preferences are stored per account. Staff notifications are delivered in the
in-app inbox when enabled and the member has opted in to product updates. Push
delivery additionally requires the member to enable push, grant OS permission,
and register a device in a supported native app build.
Expo Go and simulators do not register for remote push; the in-app inbox still
works there.

Apply
`supabase/migrations/20261125030000_member_notifications.sql` after the staff
access and notification-preferences migrations to add private notification
records, owner-scoped inbox RPCs, and per-member Expo device registrations. Deploy
`supabase/functions/send-member-notification/index.ts` from the linked
Supabase project; it checks `notifications.send` server-side and uses the
service-role key only inside the Edge Function. Build and install a native
development or production app to test push delivery; no push is sent from Expo
Go.

Apply `supabase/migrations/20261125040000_notification_links.sql` after the
member-notifications migration to add optional HTTPS links to in-app
notifications. Tapping the link opens the system browser; tapping a push
notification carrying a link opens that HTTPS URL. Non-HTTPS URLs are rejected.

Apply
`supabase/migrations/20261125060000_notification_unread_badge_and_defaults.sql`
to expose an authenticated, owner-scoped unread-count RPC for the mobile bell
and set the database defaults for "News and updates" and "Offers and promotions"
to enabled. New accounts and accounts without saved preferences default these
options to enabled; previously saved preference choices are preserved. The
mobile bell displays the exact unread count (capped visually at 99+) and
refreshes it when the app returns to the foreground.

Apply
`supabase/migrations/20261125070000_member_notification_sender.sql` afterward
to include the staff sender name in the member's notification inbox. If no
staff membership name is available, the inbox displays "VEYRA Support".

Apply
`supabase/migrations/20261125160000_member_event_push_notifications.sql`
after the notification inbox, sender-name, and profile visitor migrations. It
adds database-triggered in-app and Expo push notifications for likes, matches,
messages, profile visitors, Video Discovery invitations, and Chemistry
activity. Delivery respects each member's push, in-app, and event preferences.
Message previews contain no private message text. The migration enables
Supabase's `pg_net` extension to queue requests to Expo Push; queued requests
are sent after the database transaction commits.

The app refreshes a device's Expo push-token registration after sign-in when
notification permission was already granted. Opening the Notifications inbox
can request permission for the first time. Install a new native build after
updating the app; Expo Go does not support remote push delivery.

Android uses a custom VEYRA collapsed, expanded, and heads-up notification
layout for data-only pushes, which the app posts from its background task.
Android may defer or skip background work under Doze and other OS restrictions.
iOS receives visible remote notifications through APNs. Rebuild and install a
native development or production app after changing the notification
icon/configuration. Separate Android channels are available for matches,
messages, activity, account updates, and VEYRA updates; Android users control
each channel's sound and vibration in system settings.

Apply
`supabase/migrations/20261120040000_daily_five_discovery.sql`
and then
`supabase/migrations/20261120050000_daily_recommendation_position.sql`
and
`supabase/migrations/20261120060000_daily_recommendation_compatibility.sql`
to enable the real Daily 5 feed and reconcile recommendation columns on
existing installs. Then apply
`supabase/migrations/20261120070000_explore_discovery.sql` for private
location coordinates, the Explore visibility control, radius filtering in
Daily 5 and Explore, and the Explore decision limit. It adds server-only
recommendation and decision tables, stores the user's IANA timezone (defaulting
to `Africa/Johannesburg`), and checks for due users every 15 minutes. Sets are
created at 5:00 AM in the user's timezone, with an initial set created on
their first Discovery request. A set contains up to five eligible profiles
and is never refilled after actions. Unexplored recommendations are archived
at renewal; likes and passes remain durable and acted-on profiles are not
recommended again. Candidate matching uses both users' gender and age
preferences and respects discovery visibility, hidden profiles, blocks, and
profile-photo ownership.

Then apply
`supabase/migrations/20261120080000_explore_out_of_radius_previews.sql`
to enable view-only out-of-radius previews, followed by
`supabase/migrations/20261120090000_explore_profiles_without_photos.sql`
to include eligible photo-free profiles in Explore. These profiles use a
placeholder image; Daily 5 still requires photos for regular accounts. Apply
`supabase/migrations/20261120100000_explore_city_location_backfill.sql`
to backfill coordinates for supported-city profiles created after the original
location migration and keep future city-only test profiles discoverable.
Apply
`supabase/migrations/20261120110000_daily_five_test_profiles_without_photos.sql`
to allow explicitly tagged load-test accounts to appear in Daily 5 with the
placeholder image and set a five-minute Daily 5 cycle for the development
database. The short cycle applies to all accounts in that database; photo-free
eligibility remains limited to tagged load-test accounts. Apply this
development-only migration only to a development/test database, never
production. Existing active sets are shortened to at most five minutes, and
expired sets can be regenerated during the same daily cycle. It also clears only
empty active Daily 5 sets so they can be generated again with test profiles
included.
Apply
`supabase/migrations/20261120120000_likes_and_matches.sql`
after the discovery migrations to backfill durable likes, create mutual match
records, and enable the Received, Sent, and Matches sections. Redeploy
`daily-discovery` after applying it. Incoming likes can be opened, liked back,
or passed; both Daily 5 and Explore likes are included. Likes and matches are
protected by RLS and accessed only through authenticated server operations.
Apply
`supabase/migrations/20261120210000_like_back_completes_daily_five.sql`
after the Likes and Matches migration so liking back an incoming Like also
completes that person's pending Daily 5 recommendation. The Discovery card
shows a liked-back badge and blocks further swipe and decision actions.
For temporary development testing, apply
`supabase/migrations/20261120130000_daily_five_five_minute_dev_cycle.sql`
after the Daily 5 migration. It makes all Daily 5 sets renew every five minutes,
including already-active sets. This is a development-only behavior; restore the
production renewal schedule before production deployment.
Then apply
`supabase/migrations/20261120160000_daily_five_dev_renewal_for_all_users.sql`
to allow every development account, including untagged test accounts, to replace
an expired Daily 5 set during the same daily cycle.
Apply
`supabase/migrations/20261123170000_renew_expired_daily_five_sets.sql`
to make expired sets regenerate reliably after the app has been inactive.
The client also forces a fresh Daily 5 request when it returns to the foreground.
For repeatedly cycling through the development profiles, apply
`supabase/migrations/20261120170000_daily_five_dev_recycle_passed_test_profiles.sql`.
It lets tagged test accounts see previously passed test profiles again after
the fresh candidates are exhausted. Previously liked profiles remain excluded.
Then apply
`supabase/migrations/20261120180000_daily_five_test_pass_to_like.sql`.
It lets a tagged test profile previously passed in Daily 5 be changed to Like
or Super Like when it is shown again, and syncs that updated action to Likes.
These migrations are for development/test databases only.

To set the supplied photo references on tagged development users whose photo
arrays are missing or empty, run
`supabase/seed/backfill_dev_test_user_photos.sql` in the Supabase SQL
Editor after confirming it is connected to development. It updates only users
tagged with `veyra_test_user` and leaves non-empty photo arrays untouched. The
statement updates profile JSON only; it does not create or copy storage objects.

For temporary Explore testing, apply
`supabase/migrations/20261120190000_explore_ten_minute_dev_cycle.sql`
after the Explore migrations. The 20-decision allowance refreshes in fixed
10-minute windows shared across devices. The app shows the next reset and
reloads Explore when the window changes. This is development-only; restore the
daily midnight limit before production deployment.

Apply
`supabase/migrations/20261120200000_daily_five_approximate_distances.sql`
before deploying `daily-discovery` when using Daily 5 distance labels. The
restricted server-side RPC calculates approximate distances only for profiles
that allow distance visibility.

Compatibility v1 is a deterministic, server-side score saved with each
recommendation: relationship intentions 25%, core values 25%, lifestyle 15%,
Dating DNA relationship goals 15%, shared interests 10%, and communication
style 10%. Multi-select dimensions use case-insensitive Jaccard overlap.
Lifestyle uses the available exercise, smoking, drinking, children, and pets
answers; its 15% weight scales with the number of comparable lifestyle answers.
Communication style uses an exact normalized match. Missing dimensions are
omitted from the weighted average, and the confidence value reports how much of
the total weight was available. Candidates are ranked by score in five-point
bands, with random ordering inside a band for limited variety. Scores and their
versioned breakdown are saved when a set is generated, not recalculated when
the screen opens. The score and six-dimension breakdown are shown only when the
recommended member's `show_compatibility_score` preference allows it. The score
is a profile-signal estimate, not a prediction of relationship success; there
is no ML scoring.
Explicit non-negotiable deal-breakers are not modeled in the current profile
schema. The saved 5–200 km discovery radius is used to filter both Daily 5 and
Explore candidates.

Deploy all Edge Functions from the repository root, including
`daily-discovery` and `delete-account`:

```sh
npm run deploy:functions
```

Supabase deploys all local functions when no function name is supplied. Link or
specify the intended Supabase project before deploying.
Apply the migrations before deploying the functions.
Notifications when the set is ready are not connected. Mutual matches and
match records are persisted and displayed in Likes.

### Video Discovery backend foundation

Apply
`supabase/migrations/20261123190000_video_discovery_queue.sql`
after the dating profile, privacy, Daily 5 compatibility, Explore, and
likes-and-matches migrations. It adds private availability, search-queue, and
video-session state plus service-role-only RPCs for eligibility, queueing,
accepting, and cancelling. The existing adult profile, reciprocal age and
gender preferences, discovery visibility, location radius, blocks, hidden
profiles, prior discovery decisions, active matches, and compatibility score
are used; no second recommendation or match system is created.

The queue RPCs are not exposed directly to app clients. The authenticated
`video-discovery` Edge Function validates Supabase Auth, performs queue actions
with the service role, and issues room-scoped LiveKit tokens without exposing
provider credentials to the app. The client API is in
`src/data/videoDiscovery.ts`.

Apply
`supabase/migrations/20261123200000_video_discovery_decisions.sql`
after the queue migration. It records post-call Like/Pass through the existing
`discovery_actions` trigger, so mutual likes continue to create matches through
VEYRA's existing matching flow. Reports are recorded in the existing
`user_reports` table, block the reported account, and terminate the session.

The Video tab includes availability, compatible-person search, invitation
accept/decline, LiveKit calls, and post-call Like/Pass. Search and session
updates use the authenticated function; the client never reads or writes queue
tables directly. LiveKit UI is loaded only in a native development/production
build. Expo Go and web preview can display the setup notice but cannot join
calls. Android and iOS require a fresh native build after adding LiveKit.

Before deploying the function, configure `LIVEKIT_URL` (a `wss://` URL),
`LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` as Supabase Edge Function secrets.
Keep these credentials out of the app and source control. After applying all
Video Discovery migrations and configuring the secrets, deploy only when
ready:

```sh
npx supabase functions deploy video-discovery
```

The `video-discovery` Edge Function has been deployed to production. Apply
`supabase/migrations/20261125150000_video_discovery_service_role_access.sql`
to the same Supabase project. This grants the trusted `service_role` read access
to the privacy and verification fields that the Edge Function uses to construct
an eligible participant summary. Member-facing table grants and RLS policies
are unchanged. Deploying Edge Functions does not apply database migrations.

If matching previously failed with `permission denied for table
user_privacy_settings`, apply this migration, then switch Video Discovery
availability off and back on for both test accounts and start matching again.
This clears stale pending searches/sessions through the existing availability
workflow; it does not delete match, report, or moderation history.

Apply
`supabase/migrations/20261125190000_video_discovery_and_match_calls.sql`
after the previous Video Discovery and member-event notification migrations.
Available, eligible people can now receive discovery invitations without first
joining the search queue; the searcher and recipient must both accept. Discovery
requires known profile coordinates and limits pairings to 200 km; members'
smaller Explore radius settings are still respected. Existing matches can also
request a consent-based call from their chat header; a
match-call invitation is revalidated against the active match and block list
before acceptance and token issuance. Both flows use the existing LiveKit
session/token path and video-call notifications.

Apply
`supabase/migrations/20261120140000_match_conversations.sql` after the
likes-and-matches migration, then redeploy `daily-discovery`. This enables
match-only text conversations with unread counts, read status, Realtime message
updates, and block/report/unmatch actions. Users must be active matched
participants to access or send text messages. Typing and online indicators are
not implemented.

Apply
`supabase/migrations/20261120220000_chat_attachments.sql` after the
match-conversation migration to enable private, match-only image, video, and
voice-message storage. The migration creates the private `chat-attachments`
bucket with access restricted to active conversation participants.

Apply
`supabase/migrations/20261120230000_chat_presence_policies.sql` to
authorize private Realtime presence for active conversation participants. If
that migration was already applied with a presence authorization error, apply
`supabase/migrations/20261120240000_fix_chat_presence_authorization.sql`.
Online visibility follows each member's `Show my online status` privacy
setting; read receipts follow `Read receipts`.

Apply
`supabase/migrations/20261120250000_live_online_visibility_updates.sql`
to publish privacy-setting changes to connected chat sessions, so changing
`Show my online status` updates presence without reconnecting.

Apply
`supabase/migrations/20261120150000_match_chemistry.sql` after the
match-conversation migration, then redeploy `daily-discovery`. Chemistry is
match-only and starts experiences for active, unblocked mutual matches. The
first release includes Deep Questions, Would You Rather, and Couple Games.
Each experience has 10 questions shown in groups of 3, 3, and 4. Both
participants share each answer before that question disappears and the next
group unlocks. Waiting questions identify whose answer is pending; answers stay
private until all 10 are complete. Completed activities show all shared
answers and an answer-compatibility estimate based on matching choices and
overlapping wording. Apply
`supabase/migrations/20261120270000_chemistry_question_groups.sql` and
deploy the updated `supabase/functions/daily-discovery/index.ts` to
enable grouped question progress and keep active-session answers private in
server responses.
Also apply
`supabase/migrations/20261120260000_prevent_duplicate_chemistry_sessions.sql`
to reuse an active session when the same experience is selected again.

The `delete-account` function authenticates the requesting user, removes their
private profile media, then deletes their Supabase Auth account and associated
privacy, block, hidden-profile, and notification records. Daily 5 sets and
decisions are removed by their account foreign keys. Redeploy all functions
after adding the notification-settings migration. Never expose the service-role
key in the app.

Discover uses the server-generated Daily 5 feed. Profile fields are filtered
according to the member's visibility settings, and profile photos are served
with short-lived signed URLs. Likes are persisted across Daily 5 renewals;
the Likes screen separates incoming likes, sent likes, and mutual matches.
Mutual matches are durable and visible, and active matches can chat. Match
Automatic like, match, and chat notification triggers are not implemented;
staff-sent notifications are available through the Support Portal. Verified
identity badges are returned only
for members approved by a trusted verification source. Profiles can include optional
interests, languages, work or study, lifestyle details, conversation prompts,
relationship hopes, and a short voice introduction. Birthdays are kept private;
only age is shown.
Explore is an optional secondary feed with mutual age and gender eligibility,
city/GPS-based radius filtering, relationship-intention filtering, hidden and
blocked profile exclusions, and a 20-decision daily limit. The limit resets at
midnight in the viewer's local timezone (the development migration temporarily
changes this to fixed 10-minute windows). If no eligible profiles are within the
selected radius, up to five eligible profiles more than 200 km away can appear
as view-only previews. A warning explains they are outside the radius, and
like/pass actions are disabled. Exact coordinates are never exposed;
approximate distance is shown only when the member allows it. Distance is a
straight-line Haversine estimate, not driving distance.

## Support portal data sources

The shared migration
`supabase/migrations/20261125010000_support_dashboard_sources.sql` adds
permission-protected support tickets, moderation workflow/history, verification
status history, and daily member activity tracking for the separate Support
Portal. It builds on the existing `staff_members`, `staff_has_permission`,
`user_reports`, `messages`, and `user_verifications` schema. The migration
keeps private tables inaccessible to browser roles and exposes only validated
RPCs; it does not add subscription or payment data.

The dashboard aggregate RPC is defined in
`supabase/migrations/20261125000000_support_dashboard_metrics.sql`. It requires
`dashboard.view` and separately checks support, moderation, verification and
audit permissions before returning their respective aggregates. DAU represents
members who opened the app on the current South African calendar date. Rolling
30-day active users remain unavailable until 30 days of tracking have elapsed;
no historical activity is inferred.

Staff use the Support Portal's `/support/tickets` page to search tickets, read
the member's request, and send replies or update status and priority according
to `support.view` and `support.manage`. Staff replies are available to the
ticket owner in Profile → Help & Safety by expanding a recent request. Ticket
messages remain inaccessible through direct table access.

These are source migrations only and have not been applied to the live
Supabase project. Verify the target project's migration history and review the
SQL before applying them. Apply the dashboard metrics migration, support data
sources migration, then the ticket inbox migration in timestamp order. The
mobile app and portal will not be able to submit or view replies until the
required migrations are deployed.

The onboarding photo picker, voice recorder, and selfie capture use native Expo
modules. Selfie capture uses `expo-camera` and requires camera permission.
Video calls use LiveKit's native WebRTC SDK. Expo Go does not include these
native modules, so build and install a development client after installing
LiveKit or changing its native configuration:

```sh
npx eas build --profile development --platform android
```

Install the resulting development build on the device, then start Metro with
`npm run android:dev-client`. The existing Expo Go start commands remain
available for development without video calling. For other platforms, use
`npm run start:dev-client` or `npm run ios:dev-client`.

## Authentication scope

- Google and email/password sign-up, sign-in, password reset, and persistent
  sessions are implemented with Supabase Auth.
- Google sign-in uses Expo AuthSession and requires correctly configured
  platform OAuth client IDs and redirect URIs.
- Apple sign-in is implemented for supported iOS devices and requires Apple
  and Supabase provider setup.
- Phone OTP is optional and not enabled yet; it needs an app-verification
  flow before it is safe to expose.
- Profile and onboarding data are saved to Supabase and cached in device-local
  AsyncStorage. Daily 5 likes and passes are persisted; mutual matches and
  match-only text, image, video, and voice messages are persisted in Supabase.
  Chat media requires the `20261120220000_chat_attachments.sql` migration.

## Scripts

- `npm start` starts the project in Expo Go.
- `npm run android` / `npm run ios` start Expo Go on a connected device or simulator.
- `npm run start:dev-client` starts Metro for an installed development build.
- `npm run android:dev-client` / `npm run ios:dev-client` start the development
  build on a connected device or simulator.
- `npm run build:android:dev-client` creates an Android development build with
  EAS; install it on the device before running `npm run android:dev-client`.

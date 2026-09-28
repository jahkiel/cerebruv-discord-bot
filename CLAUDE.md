# Cerebruv — Heroes International Discord Bot

## What this is
**Cerebruv** is a Discord bot for the "Heroes International" **supergroup** in
Marvel Heroes Omega (MHO), played on Project T.A.H.I.T.I. — a public private
server built on MHServerEmu. We do NOT run or administer T.A.H.I.T.I., so there
is no server-side player data and no API to query. **All roster data is
self-reported by members through the bot.** Treat every stored
hero/level/prestige/artifact value as a claim, not a verified fact.

The name is spelled **Cerebruv** — not "Cerebro". Use that exact spelling in
user-facing text, the Developer Portal application name, the bot username, and
audit-log reason strings.

Built for Heroes International first, but multi-supergroup from day one: other
SGs may be onboarded onto the same instance later.

---

## Vocabulary (enforced — "guild" is ambiguous, do not use it loosely)
Discord's own API calls a server a "guild", which collides with the MHO term.
Rules:

| Concept | User-facing text | DB column | Code identifier |
|---|---|---|---|
| The in-game organisation | **supergroup** / **SG** | `supergroup_*` | `supergroup…` |
| A Discord server | **server** (never "guild") | `discord_server_id` | `guild` — **only** for a discord.js `Guild` object |

- Command is `/sgroster`, never `/guildroster`.
- All embeds, replies and README prose say "supergroup" and "server".
- The bare identifier `guild` in code means a discord.js object and nothing else.

**One Discord server = exactly one supergroup.** (Confirmed by Joewin,
2026-09-27.) No separate supergroup entity table; the SG *is* the server.

---

## Hard constraints (do not violate without flagging to Joewin first)
- **Free infrastructure only.** Deployment target is an **Oracle Cloud Always
  Free ARM (Ampere A1) VM**. No paid services, ever.
- **Storage:** a single local SQLite file next to the bot. No external database.
- **Stack:** Node.js 24 LTS + discord.js v14 + better-sqlite3. Keep dependencies
  minimal — think twice before adding a new package. Prefer Node built-ins
  (`node --env-file`, `node --test`, `Intl`) over packages.
- **Secrets:** bot token and IDs live in `.env` (never committed). `.env` and the
  `.db` file are gitignored. `.env.example` must exist and stay in sync with
  every env var actually read by the code.
- **Gateway intents:** `Guilds` only. Verified sufficient for v1 — nickname
  edits, single-member fetches and interaction payloads are all REST//payload
  based. `GuildMembers` would only be needed to auto-tag members on join, which
  is out of scope. Any privileged intent requires explicit justification first.
- **Slash commands:** server-scoped registration (instant updates) via a
  separate `deploy-commands` script. Global registration is a config option,
  not the default.

---

## Decisions made (do not re-litigate without reason)

### Nickname handling — derive, never restore from cache
Do **not** save a copy of the base nickname and later "restore" it. The
nickname string lives on Discord's side and the member can edit it at any time;
a cached copy goes stale and would clobber their edit.

Instead: read the member's **current** display name, strip a known tag pattern
off the end, then append the new tag. Tag patterns are ours, so they are
reliably detectable:
- trailing regional-indicator pair (flag emoji)
- trailing `[UTC±H]` or `[UTC±H:MM]`

This is idempotent (re-running replaces, never stacks), survives manual edits,
and self-heals after bot downtime. `base_nickname` is still stored, but as a
**fallback/dashboard cache only** — never as the source of truth.

### Timezone — store IANA zone, not a raw offset
Store `iana_tz` (e.g. `Australia/Sydney`) plus `country_code`. Compute offsets
and local times at render time with `Intl.DateTimeFormat` (Node built-in, zero
deps). Consequences:
- `/roster` shows the member's **correct current local time**, DST included.
- Flag nickname tags are DST-immune by nature.
- Offset nickname tags remain a snapshot and drift twice a year — this is
  accepted, documented in the README, and not worked around (re-editing every
  nickname twice a year is a rate-limit problem).

The member never sees or types an IANA name. The picker is
region → country → zone (zone step only shown for multi-zone countries).

### Flag emoji is derived, not stored
A flag emoji is computed from the ISO 3166-1 alpha-2 code via regional-indicator
offset maths. Do not store flag emoji in the data files — it removes a whole
class of data-entry error.

### Database
- **better-sqlite3** on Node 24 LTS. `node:sqlite` was evaluated and rejected:
  it is Stability 1.2 (Release Candidate) as of Node 24, and the docs advise
  caution for long-lived use. The Oracle ARM free tier has ample RAM to build
  the native module, so the usual native-build risk does not apply.
- All DB access goes through the data-access module, so swapping the driver is
  a one-file change.
- IDs are **TEXT, never INTEGER** — Discord snowflakes are 64-bit and exceed
  JavaScript's safe integer range; storing them as numbers silently corrupts
  them.
- `discord_server_id` on every user-data table, in every query. SG isolation is
  by construction, not by remembering to filter.
- WAL mode, simple numbered migrations, timestamped backup script.

### Permissions — three tiers
| Tier | Identified by |
|---|---|
| **Superadmin** | Discord user ID listed in `SUPERADMIN_IDS` in `.env`. Not a role — must work across every server the bot joins. |
| **SG Admin / Officer** | Server owner, OR Discord `Administrator` permission, OR the configured officer role. The first two are automatic fallbacks so a new SG is never locked out before configuring anything. |
| **Member** | Everyone else. |

| Action | Member | SG Admin | Superadmin |
|---|:---:|:---:|:---:|
| `/setup timezone`, `/setup clear` | self | self | self |
| `/setmains`, `/updatehero` | self | self | self |
| `/roster [user]`, `/whohas` | ✅ | ✅ | ✅ |
| `/sgroster` (ephemeral) | ✅ | ✅ | ✅ |
| `/forgetme` (hard-deletes own data) | ✅ | ✅ | ✅ |
| **Edit another member's data** | ❌ | ❌ | ❌ |
| `/admin panel`, `/admin reload` | ❌ | ✅ | ✅ |
| `/admin removeuser` (soft — mark departed) | ❌ | ✅ | ✅ |
| `/superadmin purge` (hard delete) | ❌ | ❌ | ✅ |
| Read data across servers | ❌ | ❌ | ✅ |

- **Nobody can edit another member's data — not even superadmin.** Superadmin
  can read and delete, never write. This keeps `/roster` honestly meaning
  "what this member claims".
- `/admin removeuser` is a **soft delete** (`status = 'departed'`): drops them
  from `/sgroster` and `/whohas`, keeps the rows, reversible if they return.
  Only `/superadmin purge` actually deletes.
- `/forgetme` gives every member unilateral self-service deletion, so no member
  is ever dependent on an admin to remove their data.
- Enforcement is **always in two places**: `default_member_permissions` at
  registration (so admin commands don't appear in the picker for members) AND a
  runtime check in the handler. The registration-time restriction is a UI hint
  only — server admins can override it in Server Settings → Integrations — so
  it is never the security boundary.
- **README must disclose** that the instance operator can read all SG data.
  This was accepted knowingly (2026-09-27) rather than mitigated; it is normal
  for self-hosted bots, but it gets stated plainly rather than left implicit.

### Command visibility (revised 2026-09-27)
Ephemeral was originally applied to everything, which was an over-application —
only the setup flow ever needed it.

| Public in channel | Ephemeral |
|---|---|
| `/roster`, `/profile`, `/sgroster`, `/whohas` | `/setup`, `/myheroes`, `/setmains`, `/updatehero`, `/admin *`, `/help` |

Reasoning:
- **Lookups are group questions.** A private answer to "who has Gambit?" is
  worse than useless — the asker just has to retype it into chat.
- **Data entry stays private.** Multi-step pickers would flood the channel, and
  nobody needs to watch someone tick 63 boxes.
- **`/help` stays private** because its content is caller-specific: the
  officers-only section renders for admins, so a public post would leak the
  admin command list to everyone nearby.

**Any public message with components must scope them to the invoker.**
`/sgroster` bakes the invoker's id into its button custom_ids
(`sgr:<page>:<invokerId>`) and refuses clicks from anyone else — otherwise a
passer-by flips the page under whoever is reading it. Apply the same rule to
any future public paginated view.

### Mains are a lookup feature, never a nickname feature
**Dropped 2026-09-27 at Joewin's request:** mains do NOT go in the nickname,
and there is no config toggle for it. The `server_config.mains_in_nickname`
column was removed in migration 002 — do not reintroduce it.

Mains surface in the roster views instead. `/sgroster` rows read:

    Playername | Main Hero | xx Heroes Unlocked

- `/sgroster` (list) shows the **primary main only**, for row width.
- `/roster [user]` (detail) shows all 1–3 mains.

### /sgroster is a fixed-width table (format set 2026-09-27)
Modelled on SWGoHBot's guild list, at Joewin's request. Columns:

    NAME           R CC MAIN HERO          # PRESTIGE
    Jahkiel        O AU Doctor Strange    37 Red

Name | Rank (O/M) | Country | Main Hero | Heroes unlocked | Highest prestige.

**Never put emoji inside this block.** Discord renders emoji at a variable
width even in monospace, which destroys the column alignment that is the entire
point of the format. That is why Country is the ISO code rather than the flag,
and prestige is the tier name rather than its colour emoji. Flags and prestige
colours belong in `/roster` and `/profile`, which have no alignment to protect.
- "Heroes Unlocked" is `COUNT(*) WHERE owned = 1` from the `roster` table —
  **slice (c) data, not mains data.**

### /sgroster ordering: officers first (decided 2026-09-27)
Officers sort to the top, then everyone else.

**Officer status resolves in this order** — see `permissions.js
resolveOfficerStatus()`:
1. an explicit override in `officer_overrides` (grant OR deny) — always wins
2. holding the configured `server_config.officer_role_id`
3. being the **server owner** or a Discord **Administrator** — default fallback

Step 3 exists because **Discord puts the server owner above all role
hierarchy: nobody, not even an Administrator, can assign them a role.** A
role-only rule would permanently exclude the one person most obviously in
charge. Step 1 exists because that fallback must not be mandatory — a server
owner who is not a supergroup officer has to be excludable, and some
supergroups will name officers individually and never set a role at all.

Superadmin is deliberately NOT an officer: it is a bot-operator capability from
`.env`, not a rank inside any supergroup.

`/admin officer user:@x status:<grant|deny|default>` manages overrides.

**The `Guilds`-only intent makes this non-trivial.** We cannot bulk-read who
holds a role: `GET /guilds/{id}/members` is privileged, and per-member REST
fetches for every row would be slow and rate-limited. Solution mirrors
`display_name_cache` — cache an `is_officer` flag on the users row, refreshed
whenever that member interacts with the bot, plus an admin-triggered resync
that fetches stored members by ID (unprivileged) in bulk.

**Accept the staleness rather than hiding it:** a newly-promoted officer sorts
to the top only after they next use the bot or an admin resyncs. This is a
deliberate trade to avoid a privileged intent.

**`GuildMembers` was explicitly offered and declined (2026-09-27.)** Joewin
chose to name officers with `/admin officer` instead. The consequence, accepted
knowingly: an officer identified **only by a Discord role** is invisible to the
bot until they first interact, because "who holds this role?" is a privileged
bulk read. `/admin officer` creates their row immediately and is the supported
path. Do not add the intent without asking again.

**Officers always appear in `/sgroster`, even with no recorded data** — members
with nothing recorded are filtered out, officers never are. Leadership missing
from the roster reads as a broken bot. Guarded by `test/sgroster.test.js`.

### Game progression rules — confirmed first-hand, do not "correct" from wikis
Confirmed by Joewin on 2026-09-27 from the server he actually plays on. This
outranks any online source: the 2017 "Biggest Update Ever" (patch 2.0,
19 Jan 2017) reworked progression, so most guides describe a game 1.52 no
longer is.

- **Level cap 60.**
- **Past the cap you prestige**: the hero restarts at level 1 and their name
  colour changes in game.
- **7 prestige tiers, 0–6:** White → Green → Blue → Purple → Orange → Red →
  Cosmic (yellow). Only "Cosmic" has a proper name; the rest are just colours.

**Level is therefore NOT monotonic progress.** A Cosmic hero at level 12 is far
further along than a White hero at level 60. Always sort and display on
(prestige, level) together — use `lib/game.js compareProgress()`, never a raw
level comparison. Roster rows show the prestige colour emoji so members read it
the same way they do in game.

Values live in `data/game.json` and are enforced in application code, not by SQL
CHECK constraints (see migration 002 for why).

### Infinity System deferred (decided 2026-09-27)
BUE replaced the older Omega System with the **Infinity System**, so 1.52 has a
second progression track beyond prestige. Joewin chose not to track it.
If it is ever added it is a new nullable column on `roster`, not a reshape.

### Artifacts deferred (decided 2026-09-27)
Artifacts are **out of scope for slice (c)** at Joewin's request. That drops
`data/artifacts.json`, the `roster_artifacts` table, artifact fields on
`/updatehero`, and `/whohas artifact:<name>`. `/whohas hero:<name>` stays.

Design so artifacts can be added later without reshaping anything: they are a
separate table keyed `(discord_server_id, discord_id, hero_id, slot)`, so
adding them is a new migration plus a new command — no change to `roster`.
Artifact slot count per hero still belongs in config when it lands.

### Recording hero ownership: /myheroes tick-list (decided 2026-09-27)
`/updatehero` alone would never produce an accurate "Heroes Unlocked" count —
63 heroes one command at a time means nobody fills it in and every row reads 0.
So ownership is captured by `/myheroes`: a multi-select tick-list, 25 options
per menu (Discord's cap), 3 pages for 63 heroes, pre-ticked from what is
already stored. `/updatehero` remains the *detail* command for level, prestige
and artifacts.

### Config location
`.env` holds only the bot token, client ID, dev server ID, superadmin IDs and
DB path. Per-server settings (officer role, panel channel/message, feature
toggles) live in a `server_config` table — required for multi-SG. `/admin
config` to edit it lands in slice (d); until then the owner/Administrator
fallbacks make everything work unconfigured.

---

## Conventions
- One file per command; a central command loader; shared helpers for nickname
  tagging, embeds, and pagination.
- Every interaction must be acknowledged (reply or defer) — never let Discord's
  3s timeout produce an "interaction failed."
- **Component state goes in the `custom_id`, never in an in-memory collector.**
  Collectors die on restart, which would silently break the pinned panel and
  `/sgroster` pagination after any redeploy. Route all components by `custom_id`
  through the central interaction handler.
- Use `flags: MessageFlags.Ephemeral`, not the deprecated `ephemeral: true`.
- Log errors to console with context; never crash the process on one failed
  command.
- Hero/artifact reference data lives in plain editable JSON
  (`data/heroes.json`, `data/artifacts.json`), keyed by a stable `id` — never
  key stored user data on display name, since names get edited. `/admin reload`
  hot-reloads these without a restart.
- Config-driven, not hard-coded: level caps, prestige tiers, artifact slot
  counts, officer role ID.
- Keep DB access in a dedicated data-access module, not inside command
  handlers — a future read-only web dashboard (Discord OAuth2 login) will read
  the same SQLite file and must not duplicate this logic.
- `display_name_cache` is refreshed on every interaction so `/sgroster` can
  render without Discord API calls or the `GuildMembers` intent. It is display
  only — never a key, never used for lookup.
- Unit tests (`node --test`, no framework) for pure logic: nickname tag
  replace/truncate, offset/local-time formatting, roster input validation.

---

## Known limits to respect, not silently work around
- Discord select menus: max 25 options per menu. Country pickers use
  subregion → country with ◀/▶ paging where a subregion overflows.
- **Autocomplete only exists on slash-command options, never inside a select
  menu.** The panel button flow therefore must use select menus; the
  `/setup timezone` command may additionally offer a `country:` autocomplete
  option. These are deliberately two different UX paths over one backend.
- Discord nickname limit: **32 CODE POINTS**, not 32 UTF-16 units. Confirmed
  empirically against the live API on 2026-09-27:

  | string | UTF-16 | code points | API |
  |---|---|---|---|
  | 32 ASCII | 32 | 32 | accepted |
  | 33 ASCII | 33 | 33 | rejected (50035) |
  | 30 ASCII + 🇦🇺 | **34** | **32** | **accepted** |
  | 31 ASCII + 🇦🇺 | 35 | 33 | rejected (50035) |

  So a regional-indicator flag costs **2**, and a name may legitimately exceed
  32 `String#length`. Always measure with `lib/nickname.js measure()`
  (`[...str].length`) — using `String#length` silently robs every member of two
  characters of their own name. Truncate the **base name**, never the tag.
- Discord bots can never change the **server owner's** nickname, regardless of
  permissions. Store the owner's choice anyway; tell them to apply it manually.
- Nickname changes require the bot to have Manage Nicknames and its role
  positioned above the target member's highest role. Fail gracefully with a
  clear ephemeral message when this isn't met.
- **Staff will often be un-taggable, and that is structural, not a bug.** Only
  the **server owner** can drag Cerebruv's role above an admin's role — Discord
  forbids anyone from moving a role above their own highest role. So until the
  owner does that, every admin is un-renameable, and the owner is permanently
  un-renameable. Every blocked outcome therefore hands the member the exact
  nickname string to paste in themselves; that self-service path is the
  primary fix, not an afterthought.
- **Never let a "nothing to change" shortcut run before the permission
  pre-flight.** A member whose nickname already matches would be reported as a
  success, hiding the fact that the bot could never apply it and would fail on
  their next change. This shipped and was caught in live testing on 2026-09-27;
  `test/memberTag.test.js` has the regression test. Applies to any future
  short-circuit of the same shape.
- Guild member edits are rate limited — any future bulk re-tag job must be
  throttled.
- **`Intl.supportedValuesOf('timeZone')` is ICU-build-specific and must NOT be
  used to validate zone ids.** The Windows dev box reports legacy canonical
  names (`Asia/Calcutta`, `Europe/Kiev`) while a Linux deploy host reports the
  modern ones (`Asia/Kolkata`, `Europe/Kyiv`), so the same correct data file
  passes on one machine and fails on the other. Validate by constructing an
  `Intl.DateTimeFormat` instead — every ICU build accepts both spellings for
  formatting. `data/countries.json` stores modern names so city labels derived
  from the zone id read correctly.
- If anything here conflicts with Discord's current API/limits, that gets
  flagged to Joewin — never silently worked around.

---

## Status
Design agreed 2026-09-27. Build proceeds in four approved slices, stopping after
each for Joewin to test:
  - **(a) skeleton + DB + timezone panel/nickname tagging — DONE**, live-tested
    2026-09-27. `/setup timezone`, `/setup clear`, `/admin panel`.
  - **(b) hero data + mains + autocomplete — DONE**, live-tested 2026-09-27.
    `/setmains`, `/admin reload`.
  - **(c) roster + views — BUILT, awaiting Joewin's live test.** 149 tests
    passing. `/myheroes`, `/updatehero`, `/roster`, `/profile`, `/sgroster`,
    `/whohas hero:`, `/admin config`, `/help`.

### /roster vs /profile (split 2026-09-27)
- **`/roster [user]`** is the *list* — every unlocked hero in three columns,
  best progress first, ⭐ on their mains. This is what members mean by "roster".
- **`/profile [user]`** is the *summary* — timezone, mains, unlock count,
  furthest-along heroes.
Do not merge them back. `/roster` was originally built as the summary and that
was the wrong name for it.

### /help must stay in sync
`src/commands/help.js` exports `HELP_SECTIONS` with hand-written prose (a
one-line command description is not a useful explanation). `test/help.test.js`
asserts every registered command appears there and nothing phantom does, so
**adding a command without documenting it fails the test suite.**
  - (d) `/admin removeuser`, `/forgetme`, `/superadmin purge`, README

### Slice (c) gotcha worth remembering
`/updatehero` builds its prestige choices from `game.json` **at module load
time**, when the SlashCommandBuilder is constructed. `lib/game.js` therefore
self-initialises on import rather than relying on an entry point to call
`loadGame()` first — otherwise adding a third entry point would silently
register the command with one prestige option instead of seven.

### Migrations: never use ALTER TABLE ... DROP COLUMN blindly
SQLite refuses `DROP COLUMN` when the column is named in a CHECK constraint,
an index, a view or a generated column — it fails with *"error in table X after
drop column"*. Migration 002 hit exactly this (`CHECK (mains_in_nickname IN
(0,1))` from 001) and had to become a full table rebuild: create new, copy,
drop old, rename. Caught by tests before it shipped; it would have thrown
inside the migration runner and stopped the bot from starting at all.
**Verify DROP COLUMN against the actual table, not a toy one.**

### Hero reference data
- `data/heroes.json`: **63 heroes**, client **1.52.0.1700** (patch 2.16a,
  7 Sep 2017 — the final PC build MHServerEmu targets).
- Confirmed by two independent research passes: store-catalog arithmetic
  (58 in `Catalog.json` + 5 in `CatalogRestoredHeroes.json`), an audit of every
  `As <Hero>,` achievement string in the client (exactly 63 distinct subjects),
  and Gazillion's own ordinal Steam announcements (Ultron 58th → Carnage 63rd,
  19 Jul 2017, the last hero ever released).
- **Display names follow CLIENT strings, not wiki page titles.** The wiki says
  "Mr. Fantastic"; the client says `Mister Fantastic` (7 hits vs 0). Likewise
  `Captain Marvel` (Carol was renamed from Ms. Marvel), `Doctor Strange`,
  `Doctor Doom`, `Thing` (no article), `Punisher` (no article).
- **Team-Ups are excluded** — Domino, Wasp, Gamora, Groot and ~36 others were
  sidekicks, not playable heroes. Including them would exceed 100 entries and
  wreck autocomplete. Gwenpool and Thanos were never in the game at all.
- Never released, also excluded: Spider-Woman, Odinson / Gladiator Thor,
  Agent Venom, Doop, Cloak and Dagger.
- **The five store-delisted heroes are confirmed still playable on
  T.A.H.I.T.I.** (Mister Fantastic, Invisible Woman, Human Torch, Thing, Silver
  Surfer) — verified in game by Joewin, 2026-09-27. The roster is 63, not 58.
  Do not "correct" it downward based on store-catalog sources.
- The console (PS4/Xbox) build was a **different client line** (`1.4.0.26`)
  with only **38** heroes — a clean subset. Using a console list would silently
  drop 25 heroes including Venom, Magneto and Rogue.
- `aliases` in the JSON exist so members can type what they know
  ("Ms Marvel", "Mr Fantastic", "Spidey", "Shadowcat") and still find the hero.

### Random Hero Box odds (`/boxodds`, added 2026-09-27)
**The box pool is 58, NOT the 63 playable heroes.** The Fantastic Four and
Silver Surfer cannot drop — they were pulled from the box along with their
June 2017 store delisting. Two independent sources agree:
- the community calculator at <https://mhtahiti.com/mh-random/>, which states
  the exclusion outright and that "all heroes have equal chances";
- the 1.52 client's own store data, where `Catalog.json` holds exactly **58**
  purchasable heroes and those 5 sit separately in `CatalogRestoredHeroes.json`.

Those 5 remain **playable** (Joewin confirmed in game) — they just cannot drop.
So a member's `/roster` count and their box-pool count are different numbers;
`/boxodds` intersects ownership with the pool rather than using the raw total.

**Boxes draw WITH REPLACEMENT** — a repeat gives a duplicate token rather than
re-rolling into something new. This is the part players get wrong, and it is why
owning 57 of 58 still leaves a 98.3% chance of a duplicate.

Maths lives in `lib/boxodds.js`, pure and tested:
- `pNew = missing / pool`
- `pAtLeastOneNew = 1 - (owned/pool)^boxes`
- `expectedNew = missing × (1 - ((pool-1)/pool)^boxes)` — **distinct** new
  heroes by linearity of expectation. Do NOT use `boxes × pNew`; that
  double-counts pulling the same new hero twice.

The exclusion list is `randomBoxExcludes` in `data/game.json`, editable with
`/admin reload` if T.A.H.I.T.I. turns out to differ.

**Team-up boxes: extend `/boxodds`, do NOT add a second command**
(decided 2026-09-27, before team-ups exist). When team-ups are added, give
`/boxodds` an optional `type:` choice defaulting to **hero**, so:
- the probability maths in `lib/boxodds.js` stays in one place — it is already
  generic, taking `poolSize`/`ownedInPool` and knowing nothing about heroes;
- members learn one command, and existing usage keeps working untouched;
- adding a pool becomes a data change plus one option, not a new command.

`lib/boxodds.js` needs no changes for this. Only the pool construction in
`commands/boxodds.js` is hero-specific.

**The decision that actually needs making first:** where team-up ownership
lives. Recommend a **separate `team_ups` table**, not a `kind` column on
`roster` — `/roster`, `/whohas` and every unlock count would otherwise need a
filter, and one forgotten filter silently inflates every member's hero count.
Separate tables make that mistake impossible.

Useful lead already in hand: the 1.52 client catalog contains **~40 team-ups**
(Domino, Wasp, Gamora, Groot, Drax, Kamala Khan, Spider-Gwen, Beta Ray Bill and
others) in `Data/v52/MTXStore/Catalog.json` — the same file that yielded the
58-hero box pool. That is where `data/teamups.json` should be sourced from.

### Reference data as built
- `data/countries.json`: 243 countries (193 UN members + 50 territories) across
  22 UN M49 subregions. 22 fits the 25-option select menu, so the region step
  needs no paging. **Caribbean (28) is the only subregion that overflows** and
  exercises the ◀ ▶ paging path — use it when testing.
- Uninhabited territories (AQ, BV, HM, GS, TF, UM, IO) are deliberately excluded.
- Kosovo (XK) is a user-assigned code and has no `Europe/Pristina` zone; it maps
  to `Europe/Belgrade`.

### Deviation from the original spec, accepted
The spec implied the UTC-offset format would be picked from a list of offsets
rather than via a country. Both exist: the normal path is
format → region → country → zone (so `iana_tz` is always populated and the
offset stays DST-correct), plus a *"Skip the country list, just pick an offset"*
button for members who would rather not disclose a country. That path stores
`utc_offset_minutes` with `iana_tz` NULL and warns the member it will drift.

## Open questions / unconfirmed data
- Final (2017) MHO level cap, prestige tier count/names, and artifact slot
  count per hero are not yet researched/confirmed. To be sourced and presented
  to Joewin before being baked into config. **Note:** T.A.H.I.T.I. runs
  MHServerEmu against an archived client build which may not match retail at
  shutdown, so the authoritative answer is what Joewin's server actually shows
  in-game. Config-driven values are therefore non-negotiable.
- Full hero list for the final version of the game not yet compiled/confirmed.
- Artifact list starts as a small placeholder set pending a full list.
- ~~Nickname length cost of a flag emoji~~ — **RESOLVED 2026-09-27**: 2 code
  points. See "Known limits" above.

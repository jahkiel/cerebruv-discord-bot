# Setup — getting slice (a) running

Enough to test the flag/timezone tagging on your own server. The full README
(Oracle Cloud deployment, pm2/systemd, backups on a schedule) lands in slice (d).

---

## 1. Create the bot

1. Go to <https://discord.com/developers/applications> and click **New Application**.
   Call it **Cerebruv**.
2. **Bot** tab → set the **Username** to `Cerebruv`.
   These are two separate fields: the *application* name shows in the Developer
   Portal and the OAuth consent screen, while the *bot username* is what your
   members actually see in the server. Set both, or you get a bot called
   "Cerebruv" that posts as something else.
3. Still on the **Bot** tab → **Reset Token** → copy it. Discord shows it
   **once**. If you lose it, reset again and use the new one.
4. Still on the **Bot** tab, turn **off** all three Privileged Gateway Intents
   (Presence, Server Members, Message Content). Cerebruv deliberately does not
   use them — `Guilds` alone is enough for everything in v1.
5. Turn **off** *Public Bot* unless you want other people adding it to servers.

## 2. Collect three IDs

Turn on Developer Mode first: Discord → **Settings → Advanced → Developer Mode**.

| Value | Where |
|---|---|
| `DISCORD_CLIENT_ID` | Developer Portal → **General Information** → Application ID |
| `DEV_SERVER_ID` | Right-click your server icon → **Copy Server ID** |
| `SUPERADMIN_IDS` | Right-click your own name → **Copy User ID** |

## 3. Invite the bot

Replace `YOUR_CLIENT_ID` and open this in a browser:

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=134310912&scope=bot%20applications.commands
```

Both scopes matter: `bot` lets it join, `applications.commands` lets it register
slash commands. **Missing the second one is the most common cause of
`npm run deploy` failing with a 403.**

That permission number grants exactly:

| Permission | Why |
|---|---|
| Manage Nicknames | the entire point — renaming members |
| View Channel, Send Messages, Embed Links | posting the panel |
| Read Message History | finding the existing panel to refresh it |
| Manage Messages | pinning the panel (optional — it degrades gracefully) |

## 4. ⚠️ Fix the role hierarchy — do not skip this

Discord will not let a bot rename someone whose highest role sits **above** the
bot's own role. Permissions alone are not enough.

**Server Settings → Roles → drag the bot's role ABOVE your members' roles.**

If you skip this, tagging fails for everyone with a role, and the bot will tell
them so rather than failing silently.

**Separately:** Discord *never* lets a bot rename the **server owner**, whatever
you do. If that's you, the bot saves your choice and shows you the exact
nickname to paste in yourself. This is a Discord limitation, not a bug.

## 5. Configure and run

```bash
cp .env.example .env     # then fill in the four values from steps 1-2
npm install
npm run deploy           # registers /setup and /admin — instant, server-scoped
npm start
```

`npm run deploy` only needs re-running when a command's **name, description or
options** change. Editing handler code just needs a restart.

---

## 6. Test checklist

Run these in order. Step 4 and step 6 are the ones that prove the design.

| # | Do this | Expect |
|---|---|---|
| 1 | `/admin panel` in a channel | Panel posts and pins |
| 2 | Click the button → **Country flag** → Oceania → Australia → Sydney | You become `YourName 🇦🇺` |
| 3 | Click it again → **UTC offset** → same path | `YourName [UTC+11]` — **not** `YourName 🇦🇺 [UTC+11]` |
| 4 | Manually rename yourself to `YourName (Cap main) [UTC+11]`, then re-run and pick the flag | `YourName (Cap main) 🇦🇺` — your edit survives |
| 5 | `/setup clear` | Tag gone, `(Cap main)` still there |
| 6 | Stop the bot, `npm start`, click the **pinned panel button again** | Still works |
| 7 | `/setup timezone country:` and type `aus` | Australia appears in autocomplete |
| 8 | `/admin panel` again | Edits the existing panel — does not post a second one |

Step 4 proves the bot derives your base name from your *current* nickname rather
than restoring a stale copy. Step 6 proves the panel is routed by `custom_id`
rather than an in-memory collector that dies on restart.

**Also worth trying:** the *"Skip the country list, just pick an offset"* button,
and a multi-page region — pick **Caribbean**, which has 28 countries and is the
only subregion that needs the ◀ ▶ paging.

---

## Troubleshooting

**`npm run deploy` → 403 Forbidden**
Re-invite using the URL in step 3. The bot was almost certainly added without
the `applications.commands` scope.

**`npm run deploy` → 401 Unauthorized**
`DISCORD_TOKEN` is wrong or has been reset. Reset it again and re-copy.

**Commands don't appear in Discord**
Check `DEV_SERVER_ID` matches the server you're looking at. Server-scoped
commands appear instantly; if you set `REGISTER_GLOBAL=true` they can take an
hour.

**"I don't have the Manage Nicknames permission"**
Server Settings → Roles → the bot's role → enable Manage Nicknames.

**"my role sits below yours"**
Step 4 above. Drag the bot's role higher.

**Nothing happens when I click the panel button**
Check the console. Every failure is logged with the member, server and
custom_id.

---

## Notes

- **A stored UTC offset does not follow daylight saving.** If you pick the
  offset format, your tag will read an hour out for part of the year. The flag
  format has no such problem, and `/roster` (slice c) will always show the
  correct current local time either way, because the bot stores your *timezone*
  (`Australia/Sydney`) rather than a fixed number.
- `npm test` runs the unit tests — no token or network needed.
- `npm run backup` writes a timestamped copy to `backups/` and keeps the newest
  14. Safe to run while the bot is live.
- `npm run validate:data` checks `data/countries.json`.
- **The person running this bot can read every supergroup's stored data.** That
  is normal for a self-hosted bot, but it is stated plainly rather than left
  implicit.

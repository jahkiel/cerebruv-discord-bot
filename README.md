# Cerebruv

A Discord bot that tracks who plays what in a **Marvel Heroes Omega**
supergroup, for guilds on [Project T.A.H.I.T.I.](https://mhtahiti.com) —
a private server built on MHServerEmu.

There is no connection to the game server, so **everything is self-reported**.
The roster is only as accurate as what members enter.

---

## What it does

| Command | |
|---|---|
| `/setup timezone` | Add a country flag or UTC offset to your name |
| `/setup clear` | Remove it |
| `/myheroes` | Tick which of the 63 heroes you have unlocked |
| `/setmains` | Set your 1–3 main heroes |
| `/updatehero` | Record level and prestige for one hero |
| `/bulkupdate` | Paste a list to update many heroes at once |
| `/roster [user]` | Every hero someone has unlocked, with a copy-as-text button |
| `/profile [user]` | Timezone, mains, unlock count, best heroes |
| `/sgroster` | The whole supergroup as a table, officers first |
| `/whohas hero:` | Who has a particular hero |
| `/boxodds [boxes]` | Your chance of a new hero from a Random Hero Box |
| `/help` | All of the above, in Discord |
| `/admin panel` | Post or refresh the timezone panel *(officers)* |
| `/admin config` | Set the officer role *(officers)* |
| `/admin officer` | Mark or exclude one person as an officer *(officers)* |
| `/admin reload` | Reload hero/country data after editing the files *(officers)* |

**Stack:** Node.js 24 · discord.js v14 · better-sqlite3. One SQLite file, no
external services, runs comfortably in under 200 MB of RAM.

---

# Part 1 — Create the Discord app

1. Go to <https://discord.com/developers/applications> → **New Application**.
   Call it **Cerebruv**.
2. **Bot** tab → set the **Username** to `Cerebruv`.
   These are two separate fields: the *application* name shows in the Developer
   Portal, the *bot username* is what members see. Set both.
3. Still on **Bot** → **Reset Token** → copy it. Discord shows it **once**.
4. Turn **off** all three Privileged Gateway Intents (Presence, Server Members,
   Message Content). Cerebruv deliberately does not use them.
5. Turn **off** *Public Bot* unless you want others adding it to servers.

## Collect four values

Enable Developer Mode first: Discord → **Settings → Advanced → Developer Mode**.

| Value | Where |
|---|---|
| `DISCORD_TOKEN` | Bot tab → Reset Token |
| `DISCORD_CLIENT_ID` | General Information → Application ID |
| `DEV_SERVER_ID` | Right-click your server icon → Copy Server ID |
| `SUPERADMIN_IDS` | Right-click your own name → Copy User ID |

## Invite it

Replace `YOUR_CLIENT_ID` and open in a browser:

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=134310912&scope=bot%20applications.commands
```

Both scopes matter. `bot` lets it join, `applications.commands` lets it register
slash commands — **missing the second is the most common cause of a 403 when
deploying commands.**

That permission number grants exactly: Manage Nicknames, View Channel, Send
Messages, Embed Links, Read Message History, Manage Messages (for pinning).

## ⚠️ Fix the role hierarchy

**Server Settings → Roles → drag Cerebruv's role ABOVE your members' roles.**

Discord will not let a bot rename anyone whose highest role sits above the
bot's. Skip this and tagging fails for everyone with a role.

Two things no permission can fix:

- **Discord never lets a bot rename the server owner.** Cerebruv saves their
  choice and shows them the nickname to paste in manually.
- **Only the server owner can move a role above an admin's role.** If your
  admins sit above Cerebruv, the owner has to be the one to reorder it.

---

# Part 2 — Run it locally (optional, for testing)

Requires [Node.js 24+](https://nodejs.org).

```bash
cp .env.example .env     # then fill in the four values
npm install
npm run deploy           # registers the slash commands — instant
npm start
```

`npm run deploy` only needs re-running when a command's **name, description or
options** change. Editing handler code just needs a restart.

The bot stops when you close the terminal. Part 3 fixes that.

---

# Part 3 — Deploy to Oracle Cloud Always Free

This gets Cerebruv running 24/7, restarting itself on crash and after reboots,
with no dependency on your own machine. Oracle's Always Free tier does not
expire and does not require payment.

## 3.1 Create the account

1. <https://www.oracle.com/cloud/free/> → **Start for free**.
2. **Choose your home region carefully — it cannot be changed later.** Pick the
   one closest to you (e.g. *Australia Southeast (Melbourne)* or
   *Australia East (Sydney)*). All your Always Free resources live there.
3. A **credit card is required for identity verification**. It is not charged,
   and Always Free resources stay free. Verification can take a few minutes.

## 3.2 Create the virtual machine

**Compute → Instances → Create instance.**

| Setting | Value |
|---|---|
| Name | `cerebruv` |
| Image | **Ubuntu 24.04** (change from the Oracle Linux default) |
| Shape | `VM.Standard.A1.Flex` — 1 OCPU, 6 GB RAM |
| SSH keys | **Generate a key pair for me** → download the **private key** |

> **If you get "Out of capacity"** — Oracle's free ARM tier is heavily
> oversubscribed. Switch the shape to **`VM.Standard.E2.1.Micro`** (AMD, 1 OCPU,
> 1 GB RAM), which is also Always Free and almost always available. Cerebruv
> uses well under 200 MB, so 1 GB is plenty. Everything below works identically.

Save that private key somewhere safe — it is the only way in, and Oracle will
not show it again.

When the instance finishes provisioning, copy its **Public IP address**.

**No firewall changes are needed.** Cerebruv only makes outbound connections to
Discord, so there are no ports to open beyond SSH, which is already allowed.

## 3.3 Connect

On Windows, in PowerShell, from wherever you saved the key:

```powershell
# Lock down the key file — SSH refuses to use a world-readable key
icacls .\ssh-key.key /inheritance:r
icacls .\ssh-key.key /grant:r "$($env:USERNAME):(R)"

ssh -i .\ssh-key.key ubuntu@YOUR_PUBLIC_IP
```

Type `yes` at the fingerprint prompt. You are now on the server — everything
from here runs there, not on your PC.

## 3.4 Install Node.js 24

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git
node --version     # should print v24.x
```

## 3.5 Get the code

```bash
git clone https://github.com/YOUR_USERNAME/cerebruv.git
cd cerebruv
npm install --omit=dev
```

For a **private repo**, GitHub will ask for a username and password — use a
[Personal Access Token](https://github.com/settings/tokens) as the password,
not your account password. A classic token with only the `repo` scope is enough.

## 3.6 Create the .env on the server

```bash
nano .env
```

Paste the same four values as Part 1, then `Ctrl+O`, `Enter`, `Ctrl+X` to save.

```
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DEV_SERVER_ID=...
SUPERADMIN_IDS=...
DATABASE_PATH=./data/bot.db
REGISTER_GLOBAL=false
```

Then lock it down so only your user can read the token:

```bash
chmod 600 .env
```

## 3.7 Register the commands and check it starts

```bash
npm run deploy
npm start
```

You should see `[bot] logged in as Cerebruv#...`. Press `Ctrl+C` to stop — the
next step makes it permanent.

## 3.8 Run it as a service

```bash
sudo cp deploy/cerebruv.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cerebruv
sudo systemctl status cerebruv
```

`enable --now` both starts it and sets it to start on boot. That is it —
Cerebruv now runs permanently, restarts itself if it crashes, and survives a
reboot of the server.

| Command | |
|---|---|
| `sudo systemctl restart cerebruv` | restart, e.g. after updating |
| `sudo systemctl status cerebruv` | is it running? |
| `journalctl -u cerebruv -f` | live logs (`Ctrl+C` to exit) |
| `journalctl -u cerebruv -n 100` | last 100 log lines |

## 3.9 Nightly backups

```bash
crontab -e
```

Add this line — it backs up at 4am and keeps the newest 14:

```
0 4 * * * cd /home/ubuntu/cerebruv && /usr/bin/npm run backup >> /home/ubuntu/backup.log 2>&1
```

The backup uses SQLite's online backup API, so it is safe to run while the bot
is live. A plain file copy would not be — in WAL mode, recent commits live in a
sidecar file and copying only the `.db` can silently lose them.

To copy a backup down to your PC:

```powershell
scp -i .\ssh-key.key ubuntu@YOUR_PUBLIC_IP:/home/ubuntu/cerebruv/backups/*.db .
```

---

# Part 4 — Updating

On your PC, push the changes. On the server:

```bash
cd ~/cerebruv
git pull
npm install --omit=dev        # only if dependencies changed
npm run deploy                # only if commands changed name/description/options
sudo systemctl restart cerebruv
```

**Your database is never touched by an update.** `data/*.db` is gitignored, so
`git pull` cannot overwrite it, and migrations only ever add to it.

---

# Troubleshooting

**`npm run deploy` → 403 Forbidden**
Re-invite the bot with the URL in Part 1. It was almost certainly added without
the `applications.commands` scope.

**`npm run deploy` → 401 Unauthorized**
`DISCORD_TOKEN` is wrong or has been reset.

**Commands don't appear in Discord**
Check `DEV_SERVER_ID` matches the server you are looking at. Server-scoped
commands appear instantly; `REGISTER_GLOBAL=true` can take an hour.

**"I don't have the Manage Nicknames permission"**
Server Settings → Roles → Cerebruv → enable Manage Nicknames.

**"my role sits below yours"**
Drag Cerebruv's role higher. Only the server owner can move it above an admin.

**The panel button does nothing**
Cerebruv needs **View Channel** in that channel. Discord does not deliver button
clicks to an app that cannot see the channel, so the button renders but nothing
happens. `/admin panel` checks this up front and will tell you.

**Bot is offline**
```bash
sudo systemctl status cerebruv
journalctl -u cerebruv -n 50
```

**`npm install` fails building better-sqlite3**
```bash
sudo apt-get install -y build-essential python3
npm install --omit=dev
```

---

# Notes and limitations

- **A stored UTC offset does not follow daylight saving.** Cerebruv stores your
  *timezone* (`Australia/Sydney`), so `/roster` and `/profile` always show the
  correct current local time — but a nickname tag written as `[UTC+10]` is a
  snapshot and will read an hour out for part of the year. Flag tags have no
  such problem.
- **Officers identified only by a Discord role are invisible until they use the
  bot once.** Reading who holds a role needs a privileged intent Cerebruv
  deliberately does not request. Use `/admin officer` to name someone
  immediately.
- **The person running this bot can read every supergroup's stored data.** That
  is normal for a self-hosted bot, but it is stated here rather than left
  implicit.
- **Hero data is editable.** `data/heroes.json`, `data/countries.json` and
  `data/game.json` are plain files. Edit one, run `npm run validate:data`, then
  `/admin reload` in Discord — no restart, no redeploy.

## Development

```bash
npm test                 # 253 tests, no token or network needed
npm run validate:data    # check the JSON data files
npm run backup           # timestamped database backup
```

See `CLAUDE.md` for design decisions and the reasoning behind them.

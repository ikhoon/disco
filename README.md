<p align="center">
  <img src="assets/disco-logo.png" alt="disco logo" width="160" height="160">
</p>

<h1 align="center">disco</h1>

<p align="center">
  <b>A Discord activity CLI.</b><br>
  Read channel history, threads, mentions, and search from the terminal — made for scripts, <code>jq</code>, and LLM pipelines.
</p>

<p align="center">
  <a href="https://github.com/ikhoon/disco/actions/workflows/ci.yml"><img src="https://github.com/ikhoon/disco/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/ikhoon/disco/releases/latest"><img src="https://img.shields.io/github/v/release/ikhoon/disco?sort=semver&color=2ea043" alt="Latest release"></a>
  <a href="https://github.com/ikhoon/homebrew-tap"><img src="https://img.shields.io/badge/brew-ikhoon%2Ftap%2Fdisco-f9a825?logo=homebrew&logoColor=white" alt="Homebrew"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ikhoon/disco?color=blue" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-000000?logo=apple&logoColor=white" alt="macOS · Apple Silicon">
</p>

- ⚡ **Fast** — a single self-contained binary; no Node, no npm install.
- 📖 **Read-only by design** — history, threads, single messages, mentions, search, DMs. It never posts.
- 🤖 **Scriptable** — `--json` on every command emits `{ "data": ... }`; logs go to stderr so pipes stay clean.
- 🎨 **Colored, readable output** — green timestamps, cyan authors, yellow IDs; off automatically when piped or with `--json`, or explicitly via `--no-color` / `NO_COLOR`.
- 🧭 **Polite to Discord** — honors rate limits (429/202), never retries 401/403.

<p align="center">
  <img src="assets/demo-cli.gif" alt="disco CLI demo — mentions, search, channel list, and --json piped to jq" width="820">
</p>

> ⚠️ **Read this first.** `disco` talks to Discord's REST API. To do the useful
> things (search, mentions, DMs, every server you're in) it needs a **user
> account token**, and automating a user account ("self-bot") **violates
> Discord's Terms of Service** and can get your account permanently banned —
> Discord enforces this more aggressively than Slack does. This is a personal,
> read-only tool for *your own* account; use it at your own risk. A **bot
> token** (`--bot`) is ToS-safe but can only read channels/threads/messages in
> servers where the bot is a member, and cannot search or list mentions
> (Discord doesn't expose those to bots).

---

## Contents

- [Install](#install)
- [Auth](#auth) — tokens and where they live
- [Quick start](#quick-start) — copy-paste cheat sheet
- [URLs, IDs, and time expressions](#urls-ids-and-time-expressions)
- [Scripting with JSON](#scripting-with-json)
- [Notes & limits](#notes--limits)
- [Configuration](#configuration)
- [Shell completion](#shell-completion)
- [Development](#development)

---

## Install

> Apple Silicon (arm64) macOS only for now.

### Homebrew (recommended)

```bash
brew install ikhoon/tap/disco
```

Installs the binary and zsh/bash completions in one shot (brew's completion
directory is already on `fpath`, so completion just works in a new shell).

### From a release

Download `disco-<version>-macos-arm64.zip` from
[Releases](https://github.com/ikhoon/disco/releases), unzip it, and follow
`README.txt` inside (clear the download quarantine, drop `disco` on your PATH).

### From source

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/ikhoon/disco ~/src/disco
cd ~/src/disco
bun run install-local     # builds a single binary → ~/.local/bin/disco
disco completions --install   # optional: per-user shell completion
```

Or run without installing: `bun run src/index.ts --help`.

---

## Auth

The easiest way is **`disco auth login`** — it opens Discord in your browser, you
log in normally, and disco captures your token straight into the macOS Keychain.

```bash
disco auth login                           # ← recommended: browser sign-in, no copy-paste
disco auth login --clipboard               # already copied the header? read it from the clipboard
disco auth login --manual                  # guided manual paste (any browser)
disco auth set --token "<your-token>"      # or store a token you already have (validates first)
echo "<your-token>" | disco auth set       # or via stdin
DISCORD_TOKEN="<token>" disco whoami        # or one-off via env
disco auth                                  # show status (who am I?)
disco auth clear                            # forget the token
disco auth set --token "<bot-token>" --bot  # store a bot token instead
```

**It's your own account, your own token.** Reading your own Discord data with your
own credentials isn't a hacking/"legal" problem — the only caveat is Discord's
Terms of Service on automating a user account (see the warning up top). The token
**never leaves your machine**: it's stored encrypted in the **macOS Keychain**
(or read once from `DISCORD_TOKEN`), and `disco` is **read-only** — it never posts.

### How `disco auth login` works

It launches a Chromium-family browser (Chrome / Chromium / Brave / Edge) against
an **isolated throwaway profile** with remote debugging on, you log in yourself,
and disco observes the `authorization` header your browser sends to
`discord.com/api` — i.e. it just automates the manual DevTools step below. It
never sees your password and never does a programmatic login. When it captures
the token it validates it (`/users/@me`), stores it in the Keychain, and closes
the browser. macOS only; if no supported browser is found it falls back to
`--manual`.

### Getting a user token manually (the `--manual` path)

1. Open Discord in your **browser** (not the desktop app) and log in.
2. Open DevTools (`Cmd+Opt+I`) → **Network** tab.
3. Do anything that triggers a request (click a channel), pick any request to
   `discord.com/api`, and copy the value of the **`authorization`** request
   header. That raw value *is* your token (no `Bot ` prefix).

Tokens rotate on password change / logout — re-run `disco auth login` if you
start getting 401s.

---

## Quick start

```bash
# READ ─────────────────────────────────────────────────────────────────
disco read <url>                 # auto: message URL → single message, else channel
disco channel <url|id> --days 7  # last 7 days of a channel (default)
disco channel <url|id> --limit 50
disco thread <url|id>            # all messages in a thread
disco message <messageUrl>       # one message  (also: message <channelId> <messageId>)

# INBOX (user token) ───────────────────────────────────────────────────
disco mention                    # your mentions in the last 10 minutes
disco mention --after 1d --json
disco mention --since 2026-06-01T09:00 --guild <guildId>

# SEARCH (user token) ──────────────────────────────────────────────────
disco search "deploy failed"                       # across all your servers
disco search "release" --guild <guildId> --count 25
disco search "invoice" --channel <dmChannelId>     # search a DM (IDs: disco dms)
disco search "bug" --sort relevance --json

# DISCOVER ─────────────────────────────────────────────────────────────
disco guilds                     # list servers (to get guild IDs)
disco channels <guildId>         # list a server's channels (grouped by category)
disco dms                        # list DM / group-DM channels + their IDs (user token)
disco whoami
```

---

## URLs, IDs, and time expressions

- Message: `https://discord.com/channels/<guild>/<channel>/<message>`
- Channel/thread: `https://discord.com/channels/<guild>/<channel>`
- Bare snowflake IDs work too (guild context for permalinks won't be known).
- DMs use the `@me` pseudo-guild.
- Time (`--after` / `--since` / `--until`): `10m`, `2h`, `3d`, `1w`, or an ISO
  date like `2026-06-01T09:00`.

---

## Scripting with JSON

Every command takes `--json` and emits `{ "data": ... }`:

```bash
disco channel <id> --days 3 --json | jq '.data[] | {ts, author: .author.name, content}'
disco mention --after 2h --json | jq '.data[].permalink'
```

Logs go to **stderr**, data to **stdout**, so pipes stay clean. Use `-q` to
silence info logs, `-v` for verbose request tracing.

Colored output is TTY-only: it turns itself off for pipes, redirects, and
`--json`, and can be disabled explicitly with `--no-color` or the
[`NO_COLOR`](https://no-color.org) env var — so you never have to strip ANSI
codes in scripts.

---

## Notes & limits

- **Rate limits** are honored automatically (429 `retry_after`, and 202 while a
  server's search index is still building). `disco` never retries 401/403 to
  avoid tripping Discord's invalid-request IP ban.
- **`mention`** only reaches back ~7 days (Discord's server-side inbox window).
- **`search`** returns ≤25 hits per page and has no cross-server endpoint — with
  no `--guild`, `disco` fans out across every server you're in and merges the
  results. Set a `default_guild` (below) or pass `--guild` to keep it fast.
- Bot tokens: `mention`, `dms`, and DM `search` are user-only and will error clearly.

---

## Configuration

`~/.config/disco/config.json` (optional):

```json
{
  "default_guild": "111111111111111111",
  "exclude_user_ids": []
}
```

```bash
disco config                       # show current config + path
disco config set-guild <guildId>   # set default_guild
```

---

## Shell completion

Installed automatically by `brew install`. For manual setups:

```bash
disco completions --install                # ~/.local/share/… for your $SHELL
disco completions --shell zsh              # or print the script to stdout
source <(disco completions --shell zsh)    # or source it ad hoc (add to ~/.zshrc)
```

`--install` targets the per-user XDG locations: zsh →
`~/.local/share/zsh/site-functions/_disco` (add that dir to `fpath` before
`compinit` — the command prints the exact line), bash →
`~/.local/share/bash-completion/completions/disco` (bash-completion@2 loads it
automatically).

---

## Development

```bash
bun run src/index.ts --help   # run from source
bun run typecheck             # tsc --noEmit (src + tests)
bun test                      # unit tests (client, commands, args, format, completions)
bun run build                 # compile a single binary → dist/disco
bash tests/smoke.sh           # smoke-test the compiled binary
bun run package-release       # build the release zip the Homebrew formula ships
```

Layout: `src/index.ts` (arg parsing + dispatch) · `src/commands.ts` (command
impls) · `src/client.ts` (REST + rate limits) · `src/format.ts` (human/JSON
output) · `src/color.ts` (ANSI styling, TTY-gated) · `completions/` (zsh/bash
scripts, embedded into the binary at build time).

The README demo gif is re-recorded with `bun run demo` (needs
[vhs](https://github.com/charmbracelet/vhs); `demo/bin/disco` is a mock that
prints fictional output, so recording never touches the Discord API). The logo
is re-rendered with `bun run make-icon` (draws `assets/disco-logo.png` via
`make-icon.swift`).

CI (`.github/workflows/ci.yml`) runs typecheck + tests + build + smoke on every
push/PR.

Releasing: bump `version` in `package.json` **and** `VERSION` in
`src/version.ts`, merge, then run the **Release** workflow (Actions → Release →
enter the version). It tags `v<version>`, rebuilds + retests, publishes the
GitHub release zip, and bumps `url`/`sha256` in `homebrew-tap/Formula/disco.rb`
automatically (needs the `HOMEBREW_TAP_TOKEN` repo secret).

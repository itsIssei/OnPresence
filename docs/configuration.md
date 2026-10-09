# Configuration

Everything about the card itself is set in the dashboard. Environment variables only control the server. All of them are optional.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8080` | HTTP port. |
| `DATA_DIR` | `./data` (`/app/data` in Docker) | Database, uploads, backups and imported decoration packs. |
| `DB_PATH` | `$DATA_DIR/onpresence.db` | Custom database location. |
| `PUBLIC_URL` | from the request | Your public address, e.g. `https://example.com`. Used for link previews (`og:image`), canonical URLs and the 2FA issuer name. Set it in production. |
| `TRUSTED_PROXIES` | empty | Comma-separated IPs/CIDRs of reverse proxies. Only these may set `X-Forwarded-For` / `X-Forwarded-Proto`. Rate limits and "secure" cookies depend on it. |
| `ADMIN_USERNAME` | `admin` | Username when the account is created from `ADMIN_PASSWORD`. |
| `ADMIN_PASSWORD` | empty | Creates the admin account on first start, instead of the setup screen. Ignored once an account exists. At least 10 characters. |
| `ADMIN_RESET_PASSWORD` | empty | `1` plus `ADMIN_PASSWORD` resets the password, turns off 2FA and signs out every session. Remove it after one restart. |
| `SESSION_TTL` | `168h` | How long a dashboard login lasts (Go duration, at least `1h`). |
| `BACKUP_KEEP` | `7` | Daily database snapshots to keep. `0` turns daily backups off. |
| `WEB_DIR` | empty | Serve the frontend from a folder instead of the built-in copy (development). |
| `DEV` | empty | `1` = readable text logs instead of JSON. |

## API keys

The Steam Web API key and the Last.fm API key are entered in **Dashboard → Integrations**. They are stored in the database, are never sent back to the browser, and are not part of JSON exports.

- Steam: <https://steamcommunity.com/dev/apikey>. Optional. Without it, the public community profile is used.
- Last.fm: <https://www.last.fm/api/account/create>. Required for "now playing".

## Short links

**Dashboard → Short links** turns the site into a small link shortener: `https://your-domain/<name>` answers with a `302` redirect to the saved URL and counts the visit.

- A name is 1 to 32 characters: lowercase letters, digits, `-` and `_`. Capital letters in the address still work. Leave the name empty to get a random 4-character one.
- Names the site itself uses (`admin`, `api`, `vault`, `go`, `uploads`, `img`, `assets`, `data`, `healthz`, `og`, `index`, `robots`, `manifest`, `favicon`) cannot be taken.
- The target must be an `https://` link, a `mailto:` link or a path on the site.
- A link that is switched off, or a name that does not exist, shows the card as usual.
- Only the signed-in owner can create short links, so the domain cannot be used as an open redirector.
- Short links are part of the JSON export and restore. Restoring a file made before this feature keeps the current short links.

## Security notes

- The dashboard uses a `SameSite=Strict`, `HttpOnly` cookie. Cross-site writes are blocked by `Sec-Fetch-Site` / `Origin` checks.
- Failed logins are limited to 5 per IP and 300 overall per 15 minutes.
- Server-side fetches (importers and presence) only connect to public IP addresses.
- Only the first account is created by the setup screen. Protect a fresh install until you have finished setup, because the setup code is in the logs.

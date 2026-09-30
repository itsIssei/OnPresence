# Install & update

OnPresence is one program that serves both the website and the dashboard. It stores everything in one folder (`DATA_DIR`), which holds the SQLite database, uploads, backups and caches. Pick one of the setups below.

| Setup | Good for |
|---|---|
| [Docker, port only](#1-docker-quick-try) | Trying it out, home servers |
| [Caddy + Docker](#2-caddy--docker-recommended-for-a-vps) | A VPS with nothing else on it. HTTPS is automatic. |
| [Traefik](#3-behind-an-existing-traefik) | A server that already runs Traefik |
| [nginx](#4-behind-nginx) | A server that already runs nginx |
| [Binary + systemd](#5-binary-without-docker) | No Docker |

Whichever you choose, the first start prints a **setup code** in the logs. Open `/admin`, enter the code, and create your account. The code stops working once the account exists.

## 1. Docker (quick try)

```bash
docker run -d --name onpresence --restart unless-stopped \
  -p 8080:8080 -v onpresence-data:/app/data \
  ghcr.io/itsissei/onpresence:latest
docker logs onpresence
```

Or use `compose.yaml` from this repository: `docker compose up -d`.

## 2. Caddy + Docker (recommended for a VPS)

1. Point your domain's DNS **A** record (and **AAAA** if you use IPv6) at the server.
2. Open ports 80 and 443 in the firewall.
3. Run:

```bash
git clone https://github.com/itsIssei/OnPresence.git && cd OnPresence/deploy/caddy
DOMAIN=example.com docker compose up -d
docker compose logs onpresence
```

Caddy gets and renews the certificate on its own. To keep `DOMAIN` without typing it every time, put `DOMAIN=example.com` in a `.env` file next to `compose.yaml`.

## 3. Behind an existing Traefik

```bash
cd deploy/traefik
cp ../../.env.example .env
# set DOMAIN, TRAEFIK_NETWORK (docker network ls), CERT_RESOLVER and entrypoint names
docker compose up -d
```

Find your values:

- Network: `docker inspect traefik --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'`
- Entrypoints and resolver: your Traefik static config (`--entrypoints.websecure.address=:443`, `--certificatesresolvers.letsencrypt...`)

## 4. Behind nginx

Run the container with `-p 127.0.0.1:8080:8080` and set `TRUSTED_PROXIES=127.0.0.1` and `PUBLIC_URL=https://example.com`. Then:

```nginx
server {
    server_name example.com;
    client_max_body_size 30m;   # uploads up to 25 MB

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # listen 443 ssl; ... (certbot --nginx adds this)
}
```

## 5. Binary (without Docker)

Download the archive for your OS from Releases and unpack it. It contains one file; the frontend is built in.

```bash
./onpresence                         # Linux / macOS
.\onpresence.exe                     # Windows
DATA_DIR=/srv/onpresence PORT=9000 ./onpresence
```

To run it as a service on Linux, see [`deploy/systemd/onpresence.service`](../deploy/systemd/onpresence.service).

## Updating

| Setup | Update |
|---|---|
| Docker Compose | `docker compose pull && docker compose up -d` |
| `docker run` | `docker pull ghcr.io/itsissei/onpresence:latest`, then remove and re-create the container (the data volume stays) |
| Binary | Replace the file and restart |

Database changes run on their own at start-up. To stay on one major version, pin the image tag, for example `ghcr.io/itsissei/onpresence:1`.

## Backups

- A database snapshot is written every day to `DATA_DIR/backups` (the last 7 are kept; see `BACKUP_KEEP`). You can also make one or download it under **Dashboard → Security & data**.
- **Export content (JSON)** downloads your profile and collections. **Restore from JSON** loads such a file back. A backup is always taken first.
- **Profile history** keeps the last 30 versions of your profile and appearance. You can restore any of them with one click.
- Uploaded files live in `DATA_DIR/uploads`. To back up everything, copy the whole data folder:

```bash
docker run --rm -v onpresence-data:/data -v "$PWD":/backup alpine tar czf /backup/onpresence-data.tgz -C /data .
```

## Forgot the password or lost the 2FA device?

Set these, restart once, sign in, then remove both. This also turns off 2FA:

```
ADMIN_PASSWORD=a-new-long-password
ADMIN_RESET_PASSWORD=1
```

Recovery codes (shown when you turn 2FA on) also work in place of an authenticator code.

## Build it yourself

```bash
docker build -t onpresence .
# or without Docker (needs Node 22+ and Go 1.26+):
cd web && npm ci && npm run build && cd .. && go build -o onpresence ./server
```

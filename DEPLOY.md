# Deploy: Miri FloodSense (`mcc-flood`)

Deployment on the astrikos.xyz server, following `deployment_context.md`.

## Processes

| Tier | Port | Public URL | pm2 name | Cloudflare |
| --- | --- | --- | --- | --- |
| Frontend (React SPA, `build/`) | 3347 | https://mcc-flood.astrikos.xyz:8443 | `mcc-flood_3347` | Orange |
| Backend (FastAPI, REST only) | 4347 | https://mcc-flood-api.astrikos.xyz:8443 | `mcc-flood_be_4347` | Gray |

Registry row: `| mcc-flood | 3347 | 4347 | live |`

How this POC differs from the template:

- **The frontend is Create React App, not Vite.** The build output is `build/`, not `dist/`, and env vars must start with `REACT_APP_`. The API URL is `REACT_APP_API_URL` in `.env.production`.
- **There is no websocket.** The UI polls the REST API, so there is one URL and no `SOCKET_URL`. The backend block still has the upgrade headers, as in the template.
- **The backend needs CORS.** The UI and API are on different subdomains, so the API allows the UI origin through `CORS_ORIGINS`, which is set on the pm2 command.
- **The backend block raises `client_max_body_size` to 16m.** CCTV photo uploads are posted as base64 JSON and can be up to 15 MB, and nginx's default limit of 1 MB would reject them with a 413 error.

## Prerequisites

Node 18+, Python 3.10+ with `venv`, pm2, and `serve` (`npm i -g serve`).

## Build and start

Run everything from the repo root.

```bash
# ── Frontend (static SPA) ─────────────────────────────────────────
npm install && npm run build                       # → build/, API URL from .env.production
pm2 start serve --name "mcc-flood_3347" -- ./build -s -p 3347

# ── Backend (FastAPI on 127.0.0.1:4347) ──────────────────────────
python3 -m venv .venv
.venv/bin/pip install -r server/requirements.txt
.venv/bin/python -m server.train                   # once, ~3 min: builds server/artifacts/
PORT=4347 CORS_ORIGINS=https://mcc-flood.astrikos.xyz:8443 \
  pm2 start .venv/bin/python --name "mcc-flood_be_4347" --interpreter none -- -u -m server

pm2 save
```

If you skip the training step, the backend trains on its first start, and nginx returns 502 for about 3 minutes until it finishes.

Optional: to turn on Claude (CCTV vision and alert drafting), create `server/.env` containing `ANTHROPIC_API_KEY=sk-ant-...` and run `pm2 restart mcc-flood_be_4347`. Without a key the app uses its offline fallbacks.

## nginx

`/etc/nginx/conf/astrikos.conf` (frontend):

```nginx
server {
    listen 8443 ssl;
    ssl_certificate     /etc/certs/astrikos.xyz/fullchain.pem;
    ssl_certificate_key /etc/certs/astrikos.xyz/privkey.pem;
    server_name mcc-flood.astrikos.xyz;
    location / {
        add_header 'Access-Control-Allow-Origin' '*' always;
        proxy_pass http://127.0.0.1:3347;
    }
}
```

`/etc/nginx/conf/astriverse.conf` (backend; the file's existing `map $http_upgrade $connection_upgrade {…}` covers it):

```nginx
server {
    listen 8443 ssl;
    ssl_certificate     /etc/certs/astrikos.xyz/fullchain.pem;
    ssl_certificate_key /etc/certs/astrikos.xyz/privkey.pem;
    server_name mcc-flood-api.astrikos.xyz;
    client_max_body_size 16m;                      # CCTV photo uploads (base64, up to 15 MB)
    location / {
        proxy_pass http://127.0.0.1:4347;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
        proxy_buffering off;
    }
}
```

Apply: `sudo nginx -t && sudo systemctl reload nginx`

## Cloudflare DNS

- `mcc-flood.astrikos.xyz` → **Orange** (proxied)
- `mcc-flood-api.astrikos.xyz` → **Gray** (DNS only)

## Verify

```bash
curl -k https://mcc-flood.astrikos.xyz:8443                     # SPA HTML
curl -k https://mcc-flood-api.astrikos.xyz:8443/api/health      # {"ok":true,...}

# CORS preflight from the UI origin: expect 200 and
# access-control-allow-origin: https://mcc-flood.astrikos.xyz:8443
curl -k -i -X OPTIONS https://mcc-flood-api.astrikos.xyz:8443/api/alerts/draft \
  -H "Origin: https://mcc-flood.astrikos.xyz:8443" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

Then open https://mcc-flood.astrikos.xyz:8443. The header should show the feed running, not "offline".

## Update after a code change

```bash
git pull
npm install && npm run build                       # serve picks up the new build/ without a restart
.venv/bin/pip install -r server/requirements.txt
pm2 restart mcc-flood_be_4347
```

## Changing the domain or ports

- **API URL:** edit `.env.production`, then rebuild. The URL is baked into the bundle at build time.
- **UI origin:** if the UI origin changes, update the backend's CORS setting with `pm2 delete mcc-flood_be_4347` and rerun the backend `pm2 start` line with the new `CORS_ORIGINS`.
- **Ports:** change the pm2 commands and nginx blocks.

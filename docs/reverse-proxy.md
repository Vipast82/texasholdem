# Running behind a reverse proxy (production)

This guide puts the **Saloon Hold'em** production server behind Nginx or Apache
and runs it as a `systemd` service on a Linux host. The app itself is a single
Node process that:

- serves the built client from `frontend/dist`,
- exposes `GET /health` for load-balancer / proxy health checks,
- speaks **Socket.IO** (WebSocket + polling fallback) on the `/socket.io` path.

Because of the WebSocket traffic, the proxy **must** upgrade connections and
forward the `Upgrade` / `Connection` headers. Everything below assumes the app
listens on `127.0.0.1:3000` (or `0.0.0.0:3000` if you want it reachable directly
without the proxy — prefer binding to loopback only when a proxy fronts it).

> Node 18+ is required. Build the client once before first start:
> `npm install && npm run build`.

---

## 1. The app as a `systemd` service

Create `/etc/systemd/system/saloon.service`:

```ini
[Unit]
Description=Saloon Hold'em poker server
After=network.target

[Service]
Type=simple
# Run as a dedicated, unprivileged user.
User=saloon
Group=saloon
WorkingDirectory=/opt/saloon
# The repo root is /opt/saloon; `npm run start` launches the server workspace.
ExecStart=/usr/bin/npm run start
# App env. Keep it bound to loopback when a proxy fronts it.
Environment=HOST=127.0.0.1
Environment=PORT=3000
# Helpful for log rotation / monitoring.
Restart=on-failure
RestartSec=3
# Hardening (optional but recommended).
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
# Log to journald.
StandardOutput=journal
StandardError=journal
SyslogIdentifier=saloon

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -r -s /usr/sbin/nologin saloon        # service account (no shell)
sudo cp -r /path/to/repo /opt/saloon
sudo chown -R saloon:saloon /opt/saloon
sudo systemctl daemon-reload
sudo systemctl enable --now saloon
systemctl status saloon
journalctl -u saloon -f                               # follow logs
curl -sS http://127.0.0.1:3000/health                 # {"ok":true,"name":"saloon-server"}
```

Restart after deploying new code: `sudo systemctl restart saloon`.

---

## 2. Nginx (recommended)

Nginx handles WebSockets with `proxy_http_version 1.1` + the `Upgrade` header.

`/etc/nginx/conf.d/saloon.conf`:

```nginx
# One upstream is enough for a single-node deployment.
upstream saloon_app {
    server 127.0.0.1:3000;
    keepalive 16;
}

server {
    listen 80;
    server_name poker.example.com;

    # Socket.IO: long-lived, so relax read timeouts and allow large frames.
    client_max_body_size 25m;

    # Proxy health checks if you want to expose them (optional).
    location = /health {
        proxy_pass http://saloon_app;
        access_log off;
    }

    # Socket.IO (WebSocket + polling fallback) and all app traffic.
    location / {
        proxy_pass http://saloon_app;
        proxy_http_version 1.1;

        # --- WebSocket upgrade (required for Socket.IO) ---
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # --- Real client identity / TLS termination ---
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # --- Socket.IO-friendly timeouts (0 = no timeout) ---
        proxy_read_timeout    3600s;
        proxy_send_timeout    3600s;
        proxy_connect_timeout 5s;
        proxy_buffering       off;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Adding TLS with Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d poker.example.com
```

Certbot will insert an `ssl_certificate` block and an HTTP→HTTPS redirect.
Socket.IO works fine over `wss://` once TLS is terminated at Nginx.

---

## 3. Apache (mod_proxy)

Enable the modules:

```bash
sudo a2enmod proxy proxy_http proxy_wstunnel rewrite
```

`/etc/apache2/sites-available/saloon.conf`:

```apache
<VirtualHost *:80>
    ServerName poker.example.com

    # Proxy health checks (optional).
    ProxyPass        /health    http://127.0.0.1:3000/health
    ProxyPassReverse /health    http://127.0.0.1:3000/health

    # Socket.IO over WebSockets — proxy_wstunnel does the Upgrade handling.
    ProxyPass        /socket.io ws://127.0.0.1:3000/socket.io
    ProxyPassReverse /socket.io ws://127.0.0.1:3000/socket.io

    # Everything else (static client, HTTP fallback).
    ProxyPreserveHost On
    ProxyPass        /          http://127.0.0.1:3000/
    ProxyPassReverse /          http://127.0.0.1:3000/

    RequestHeader set X-Forwarded-Proto expr=%{https:scheme}
    ErrorLog  ${APACHE_LOG_DIR}/saloon_error.log
    CustomLog ${APACHE_LOG_DIR}/saloon_access.log combined
</VirtualHost>
```

```bash
sudo a2dissite 000-default.conf
sudo a2ensite saloon.conf
sudo systemctl reload apache2
```

### Adding TLS

```bash
sudo apt install apache2 ssl-cert
sudo a2enmod ssl
# Obtain certs (e.g. via certbot --apache -d poker.example.com), then add:
#   SSLEngine on
#   SSLCertificateFile      /etc/letsencrypt/live/poker.example.com/fullchain.pem
#   SSLCertificateKeyFile   /etc/letsencrypt/live/poker.example.com/privkey.pem
```

---

## 4. Smoke-test the deployment

```bash
# Through the proxy:
curl -i  http://poker.example.com/            # 200 + the built index.html
curl -s  http://poker.example.com/health      # {"ok":true,"name":"saloon-server"}
```

Open `http://poker.example.com` in a browser, join a table, and confirm a hand
plays. Then run the e2e smoke against the **real** server to re-verify the
Socket.IO + privacy path end-to-end:

```bash
SMOKE_PORT=3000 node scripts/ci-e2e-smoke.mjs
```

---

## 5. Notes & gotchas

- **WebSocket upgrade is non-negotiable.** Without the `Upgrade` /
  `Connection: upgrade` headers (Nginx) or `proxy_wstunnel` (Apache), Socket.IO
  will silently fall back to long-polling — the game works but with noticeable
  latency and more connections. Verify in the browser devtools *Network* tab:
  the `/socket.io/?EIO=4...` request should show `Upgrade: websocket`.
- **Timeouts.** The server keeps sockets open indefinitely while a player is
  idle at the table. Default proxy read timeouts (60 s) will sever those
  sockets mid-hand. The snippets above set 1 hour; raise to your preference but
  never below your longest expected idle period.
- **Buffering.** Turn Nginx `proxy_buffering off` (Apache passes WebSocket
  frames through fine). Buffering a Socket.IO stream delays state updates by
  the buffer flush interval.
- **Bind the app to loopback when proxied.** `HOST=127.0.0.1` keeps the app off
  the public interface; only the proxy is reachable. Without a proxy, the
  default `HOST=0.0.0.0` works but put TLS in front for anything beyond a LAN.
- **CORS is wide-open in this app** (`app.use(cors())` and
  `io = new Server(server, { cors: { origin: '*' } })`) for local-network play.
  For a public deployment consider tightening `origin` to your `Host` value —
  both are one-line changes in `server/src/index.js`.
- **Scaling out** requires a shared Socket.IO adapter (e.g.
  `@socket.io/redis-adapter`); no proxy-side session stickiness is needed on a
  single node.

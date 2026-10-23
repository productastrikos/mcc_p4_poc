"""Run the API: python -m server

Listens on $HOST:$PORT (default 127.0.0.1:8000). In production pm2 sets PORT and
nginx proxies the public API subdomain to it (see DEPLOY.md).
"""
import os

import uvicorn

uvicorn.run("server.main:app", host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8000")))

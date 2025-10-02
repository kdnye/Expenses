#!/bin/sh
set -eu

PORT="${PORT:-8080}"

cat <<CONFIG >/etc/nginx/conf.d/default.conf
server {
    listen       ${PORT};
    listen  [::]:${PORT};
    server_name  _;

    root   /usr/share/nginx/html;
    index  index.html;

    location / {
        try_files \$uri /index.html =404;
    }

    # Service workers should not be aggressively cached to ensure updates roll out.
    location = /service-worker.js {
        add_header Cache-Control "no-store";
    }
}
CONFIG

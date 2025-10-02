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

    # Static assets can be cached by browsers, but HTML should always be revalidated
    # so that styling or layout changes deploy immediately. Split the handling into
    # two locations so we can attach the appropriate cache headers.
    location ~* \.(?:css|js|png|jpg|jpeg|gif|svg|webp|ico|json)$ {
        try_files \$uri =404;
        add_header Cache-Control "public, max-age=3600, must-revalidate" always;
    }

    location / {
        try_files \$uri /index.html =404;
        add_header Cache-Control "no-store, must-revalidate" always;
    }

    # Service workers should not be aggressively cached to ensure updates roll out.
    location = /service-worker.js {
        add_header Cache-Control "no-store" always;
    }
}
CONFIG

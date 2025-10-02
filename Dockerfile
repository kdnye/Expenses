FROM nginx:1.27-alpine

ENV PORT=8080

# Replace the default server configuration so we can control the listen port
# through the PORT environment variable expected by Cloud Run and other PaaS
# platforms.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY docker/configure-nginx.sh /docker-entrypoint.d/10-configure-nginx.sh
RUN chmod +x /docker-entrypoint.d/10-configure-nginx.sh

# Copy static assets into the nginx public directory.
COPY index.html /usr/share/nginx/html/index.html
COPY admin.html /usr/share/nginx/html/admin.html
COPY styles.css /usr/share/nginx/html/styles.css
COPY manifest.webmanifest /usr/share/nginx/html/manifest.webmanifest
COPY fsi-logo.png /usr/share/nginx/html/fsi-logo.png
COPY src /usr/share/nginx/html/src
COPY service-worker.js /usr/share/nginx/html/service-worker.js

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]

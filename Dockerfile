FROM nginx:1.27-alpine

# Copy static assets into the nginx public directory.
COPY index.html /usr/share/nginx/html/index.html
COPY styles.css /usr/share/nginx/html/styles.css
COPY manifest.webmanifest /usr/share/nginx/html/manifest.webmanifest
COPY src /usr/share/nginx/html/src

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

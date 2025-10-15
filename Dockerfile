FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine

ENV PORT=8080

# Replace the default server configuration so we can control the listen port
# through the PORT environment variable expected by Cloud Run and other PaaS
# platforms.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY docker/configure-nginx.sh /docker-entrypoint.d/10-configure-nginx.sh
RUN chmod +x /docker-entrypoint.d/10-configure-nginx.sh

# Copy built assets into the nginx public directory.
COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY admin.html /usr/share/nginx/html/admin.html
COPY styles.css /usr/share/nginx/html/styles.css
COPY src /usr/share/nginx/html/src

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]

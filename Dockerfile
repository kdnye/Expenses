# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM nginx:1.25-alpine AS runner
ENV PORT=8080
COPY docker/configure-nginx.sh /docker-entrypoint.d/50-configure-nginx.sh
RUN chmod +x /docker-entrypoint.d/50-configure-nginx.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["/docker-entrypoint.sh", "nginx", "-g", "daemon off;"]

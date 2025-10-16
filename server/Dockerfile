# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/prisma ./prisma
RUN npx prisma generate

FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY server/tsconfig.json ./
COPY server/src ./src
COPY --from=deps /app/node_modules ./node_modules
RUN npm run build

FROM node:20-bookworm-slim AS frontend
WORKDIR /frontend
COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/
RUN npm ci
COPY index.html ./
COPY admin.html ./
COPY vite.config.js ./
COPY styles.css ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app
COPY server/package.json server/package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY server/package.json server/package-lock.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY server/prisma ./prisma
COPY --from=frontend /frontend/dist ./public

RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "dist/index.js"]

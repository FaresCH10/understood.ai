# syntax=docker/dockerfile:1

FROM node:24.5.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html operator.html ./
COPY src ./src
COPY server ./server
COPY public ./public
COPY scripts/public-shell.mjs ./scripts/public-shell.mjs
RUN npm run build

FROM node:24.5.0-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24.5.0-bookworm-slim AS runtime
ENV NODE_ENV=production \
    TZ=UTC
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server ./server
COPY scripts ./scripts
COPY --from=build /app/dist ./dist
USER node
EXPOSE 10000
STOPSIGNAL SIGTERM
CMD ["node", "scripts/postgres-hosted.mjs", "api"]

# Stage 1: Build frontend and backend
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci

COPY . .

RUN npm run build:web && npm run build:server

# Stage 2: Production image
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server

ENV SQUARED_STATIC_DIR=dist
ENV SQUARED_DATA_DIR=/tmp/data
ENV PORT=8080

RUN addgroup --system app && adduser --system --ingroup app app \
    && mkdir -p /tmp/data/uploads && chown -R app:app /tmp/data

EXPOSE 8080

USER app

CMD ["node", "dist-server/server/index.js"]

# ---------- Build stage ----------
FROM node:20-alpine AS builder
WORKDIR /app

# argon2 compiles native bindings — need a toolchain. libc6-compat keeps
# a few prebuilt binaries (prisma engines) happy on Alpine's musl.
RUN apk add --no-cache python3 make g++ libc6-compat openssl \
  && ln -sf python3 /usr/bin/python

# Copy only manifests first so the dependency layer is cached across builds.
COPY package.json package-lock.json ./

# No BuildKit cache mount (Railway's Kaniko builder doesn't support the
# --mount=type=cache syntax). `--legacy-peer-deps` insulates us from any
# transient peer drift between Nest plugin versions.
RUN npm ci --legacy-peer-deps --no-audit --no-fund

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build \
  && echo '--- dist tree (sanity) ---' \
  && ls -la dist \
  && test -f dist/main.js || (echo '❌ dist/main.js not produced — tsconfig rootDir misconfig?' && ls -R dist && exit 1)

# ---------- Runtime stage ----------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# Force unbuffered stdout/stderr so errors during module load reach Railway
# before the container exits. Without this, crashes look silent.
ENV NODE_NO_WARNINGS=1
ENV FORCE_COLOR=0

# Prisma's query engine binary is dynamically linked — libc6-compat +
# openssl are required on Alpine/musl for it to load at runtime.
RUN apk add --no-cache libc6-compat openssl tini \
  && addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/prisma ./prisma
COPY --from=builder --chown=app:app /app/package.json ./

USER app
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3333)+'/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# tini as PID 1 — proper signal handling + reaps zombies.
# Migrations run before the app boots so the schema matches the code.
# `node --enable-source-maps` gives us readable stack traces from dist/.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "echo '[start] pwd='$(pwd) && ls dist && npx prisma migrate deploy && exec node --enable-source-maps dist/main.js"]

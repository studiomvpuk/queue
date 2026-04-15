# ---------- Build stage ----------
FROM node:20-alpine AS builder
WORKDIR /app

# Install build dependencies for argon2 (native module)
RUN apk add --no-cache python3 make g++ \
  && ln -sf python3 /usr/bin/python

COPY package.json pnpm-lock.yaml* package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# ---------- Runtime stage ----------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/prisma ./prisma
COPY --from=builder --chown=app:app /app/package.json ./

USER app
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3333)+'/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Railway runs this on every deploy. Migrations run before the app boots
# so the schema always matches the code that's about to start serving.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]

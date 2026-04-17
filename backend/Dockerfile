# ── Stage 1: deps ────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: runtime ─────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Prisma braucht openssl
RUN apk add --no-cache openssl

# Nur production node_modules aus Stage 1
COPY --from=deps /app/node_modules ./node_modules

# Quellcode
COPY src ./src
COPY public ./public
COPY prisma ./prisma
COPY package.json ./

# Prisma Client generieren
RUN npx prisma generate

EXPOSE 3000

# Migrationen anwenden, dann Server starten
CMD ["sh", "-c", "npx prisma migrate deploy && node src/app.js"]

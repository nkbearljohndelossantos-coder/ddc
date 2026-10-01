# ==========================================
# STAGE 1: Build & Prune
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache libc6-compat python3 make g++

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
COPY agents/windows-scanner-agent/package*.json ./agents/windows-scanner-agent/
COPY agents/dcc-background-agent/package*.json ./agents/dcc-background-agent/

RUN npm ci --legacy-peer-deps || npm install

COPY . .

RUN npx prisma generate --schema=apps/api/prisma/schema.prisma
RUN npx tsc -p apps/api/tsconfig.json

# ==========================================
# STAGE 2: Production Minimal Image
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-eng dumb-init

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 dccapp

COPY --from=builder --chown=dccapp:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=dccapp:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=dccapp:nodejs /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder --chown=dccapp:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=dccapp:nodejs /app/apps/api/package*.json ./apps/api/
COPY --from=builder --chown=dccapp:nodejs /app/package*.json ./

RUN mkdir -p /app/uploads/documents /app/uploads/packages /app/uploads/scans && \
    chown -R dccapp:nodejs /app/uploads

USER dccapp

EXPOSE 3000

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "apps/api/dist/server.js"]

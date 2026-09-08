# =====================================================================
# SafeSphere EHS — one image, two roles (web + worker)
# The worker runs the same code as the web app, so escalation logic and
# request logic can never drift apart.
# =====================================================================

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable pnpm
WORKDIR /app

# --- deps: cached unless the lockfile changes -------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# --- builder ----------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
# next.config.js must set `output: 'standalone'`
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# --- runner: web ------------------------------------------------------
FROM base AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

# --- runner: worker (pg-boss consumer + cron) -------------------------
# Same build, different entrypoint. No HTTP port.
FROM base AS worker
ENV NODE_ENV=production JOBS_ENABLED=true
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs_user -u 1001 -G nodejs
COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist-worker ./dist-worker
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
USER nodejs_user
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node dist-worker/healthcheck.js
CMD ["node", "dist-worker/index.js"]

# --- migrator: one-shot, uses the privileged migration role -----------
FROM base AS migrator
COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/db ./db
CMD ["pnpm", "prisma", "migrate", "deploy"]

FROM node:22.19.0-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Prisma client generation reads the datasource URL from prisma.config.ts but
# does not connect to it. Supply a throwaway build-only URL so image builds
# never need a deployment credential (and cannot accidentally bake one in).
RUN DATABASE_URL=postgresql://prisma:prisma@localhost:5432/prisma pnpm prisma:generate && pnpm build

# Production migration and seed commands need the Prisma CLI, tsx, dotenv,
# the schema, and seed source. Keep those development-only tools in a
# separately targeted image; the application image below remains pruned.
FROM node:22.19.0-alpine AS db-tools
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=app:app /app/src/generated ./src/generated
USER app
CMD ["corepack", "pnpm", "prisma:migrate:deploy"]

FROM build AS production-deps
RUN pnpm prune --prod

FROM node:22.19.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/package.json /app/pnpm-lock.yaml ./
COPY --from=production-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/src/generated ./src/generated
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=app:app /app/assets ./assets
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health/live').then((r) => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]

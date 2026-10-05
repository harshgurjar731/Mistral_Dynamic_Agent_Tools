# Production image for the TanStack Start frontend.
#
# Used by deploy/docker-compose.yml. Local development is unchanged
# (`npm run dev`), and the default build still targets Cloudflare/Lovable —
# only this image switches Nitro to the Node server preset.

# ── Build ─────────────────────────────────────────────────────────────────
FROM node:22-slim AS build
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
# bun.lock is not always regenerated alongside package.json edits, so the
# install is not frozen; it still reuses the lockfile's pins where they match.
RUN bun install --network-concurrency 16 --concurrent-scripts 2

COPY . .
ENV NITRO_PRESET=node-server
RUN npx vite build

# ── Run ───────────────────────────────────────────────────────────────────
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=node:node /app/.output ./.output
USER node

EXPOSE 3000
# A static file, not "/": probing a page starts an SSR stream the probe never
# reads, which the server then logs as exceeding its maximum lifetime.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:3000/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]

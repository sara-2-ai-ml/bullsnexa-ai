# Build tools keep future native dependencies such as better-sqlite3 feasible.
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update \
    && apt-get install --no-install-recommends -y python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Synthetic policy documents read by the searchCampaignPolicies tool.
COPY --chown=node:node data ./data
# Single-file UI served at /.
COPY --chown=node:node public ./public
# SQLite file for runs and approvals; mount a volume here to keep data across containers.
RUN mkdir -p /app/var && chown node:node /app/var
ENV DATABASE_PATH=/app/var/bullsnexa.sqlite
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]

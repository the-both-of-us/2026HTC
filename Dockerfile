# Build stage: installs everything, including dev tools, and runs next build.
FROM node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# Run stage: only the self-contained server that next build traced.
# node:24-slim has both amd64 and arm64 versions, and AWS runs the arm64 one.
FROM node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# Keep idle connections open longer than the load balancer does (130 s, set in
# scripts/deploy-aws.sh). Otherwise it can reuse a connection the server just
# closed, and the visitor gets a random 502.
ENV KEEP_ALIVE_TIMEOUT=135000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

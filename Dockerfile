FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY client ./client
RUN npm run build

FROM node:22-slim
# fontconfig untuk teks dalam imej OG
RUN apt-get update && apt-get install -y --no-install-recommends fontconfig ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data HOST=0.0.0.0 PORT=8460 NODE_NO_WARNINGS=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY fonts ./fonts
COPY --from=build /app/public ./public
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8460
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8460/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]

# syntax=docker/dockerfile:1

# ---- web UI build ------------------------------------------------------------
FROM node:24-trixie-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- server dependencies -----------------------------------------------------
FROM node:24-trixie-slim AS server
WORKDIR /src/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- runtime: Ubuntu's HandBrakeCLI (built with Intel QSV/VPL) + Node -------
FROM ubuntu:26.04
ARG TARGETARCH
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      handbrake-cli ca-certificates tini \
 && if [ "$TARGETARCH" = "amd64" ]; then \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        intel-media-va-driver-non-free libvpl2 libmfx-gen1.2 ; \
    fi \
 && rm -rf /var/lib/apt/lists/*

COPY --from=web /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=server /src/server/node_modules server/node_modules
COPY server/package.json server/
COPY server/src server/src
COPY --from=web /src/web/dist web/dist

ENV NODE_ENV=production \
    PORT=8095 \
    DATA_DIR=/data \
    WEB_DIR=/app/web/dist \
    HOME=/tmp

RUN mkdir -p /data && chmod 777 /data
VOLUME /data
EXPOSE 8095

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/info').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# tini forwards SIGTERM so the running encode is stopped cleanly.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.js"]

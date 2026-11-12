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

# ---- HandBrakeCLI built from upstream source ---------------------------------
# Ubuntu's handbrake-cli package links the system FFmpeg, which lacks
# HandBrake's QSV patches: every qsv_* encode then fails in the muxer with
# "non monotonically increasing dts". The upstream build bundles its patched
# FFmpeg. This stage doesn't depend on the app's source, so Docker caches it
# and only rebuilds it when HANDBRAKE_VERSION changes (~45-60 min on a 4-thread CPU).
# Dolby Vision metadata (libdovi) is left out: it needs a Rust toolchain.
FROM ubuntu:26.04 AS handbrake
ARG TARGETARCH
ARG HANDBRAKE_VERSION=1.11.2
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates git python3 curl pkg-config xz-utils bzip2 patch tar make cmake nasm ninja-build meson \
      autoconf automake build-essential libtool libtool-bin \
      libass-dev libbz2-dev libfontconfig1-dev libfreetype6-dev libfribidi-dev libharfbuzz-dev libjansson-dev \
      liblzma-dev libmp3lame-dev libnuma-dev libturbojpeg0-dev libssl-dev libogg-dev libopus-dev \
      libsamplerate-dev libspeex-dev libtheora-dev libvorbis-dev libx264-dev libxml2-dev libvpx-dev \
      zlib1g-dev libva-dev libdrm-dev \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --depth 1 --branch "$HANDBRAKE_VERSION" https://github.com/HandBrake/HandBrake.git
WORKDIR /src/HandBrake
RUN QSV=$([ "$TARGETARCH" = "amd64" ] && echo --enable-qsv || echo --disable-qsv) \
 && ./configure --disable-gtk $QSV --disable-nvenc --launch-jobs="$(nproc)" --launch \
 && install -m 755 -s build/HandBrakeCLI /usr/local/bin/HandBrakeCLI \
 && rm -rf /src/HandBrake/build /src/HandBrake/download

# ---- Intel Media SDK runtime for older iGPUs (amd64 only) --------------------
# Ubuntu 26.04 only ships the VPL GPU runtime (libmfx-gen), which supports
# Tiger Lake (11th gen) and newer. 6th-10th gen iGPUs (e.g. Comet Lake UHD 620)
# need the legacy Media SDK runtime (libmfxhw64), last packaged in 24.04.
FROM ubuntu:24.04 AS msdk
ARG TARGETARCH
RUN mkdir -p /debs \
 && if [ "$TARGETARCH" = "amd64" ]; then \
      apt-get update && cd /debs && apt-get download libmfx1 && rm -rf /var/lib/apt/lists/* ; \
    fi

# ---- runtime: HandBrakeCLI + its libraries, Intel QSV runtimes, Node ---------
FROM ubuntu:26.04
ARG TARGETARCH
COPY --from=msdk /debs/ /tmp/debs/
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ffmpeg mkvtoolnix ca-certificates tini \
      libass9 libjansson4 libnuma1 libturbojpeg0 libmp3lame0 libopus0 libspeex1 libtheora1 libvorbis0a \
      libvorbisenc2 libogg0 libx264-165 libxml2-16 libvpx12 libsamplerate0 libva2 libva-drm2 libdrm2 \
      libfribidi0 libharfbuzz0b libfreetype6 libfontconfig1 libbz2-1.0 liblzma5 zlib1g libssl3t64 \
 && if [ "$TARGETARCH" = "amd64" ]; then \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        intel-media-va-driver-non-free libvpl2 libmfx-gen1.2 \
      && dpkg -i /tmp/debs/libmfx1_*.deb ; \
    fi \
 && rm -rf /tmp/debs /var/lib/apt/lists/*
COPY --from=handbrake /usr/local/bin/HandBrakeCLI /usr/local/bin/HandBrakeCLI
# Fail the build here, not at the first encode, if a shared library is missing.
RUN ! ldd /usr/local/bin/HandBrakeCLI | grep "not found"

COPY --from=web /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=server /src/server/node_modules server/node_modules
COPY package.json CHANGELOG.md LICENSE ./
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
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# tini forwards SIGTERM so the running encode is stopped cleanly.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.js"]

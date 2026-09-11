# syntax=docker/dockerfile:1.7
# Image chung cho pipeline dữ liệu MapsLibVN: dùng trên máy dev, máy chủ nội bộ và GitHub Actions.
FROM ubuntu:24.04 AS tools
ARG DEBIAN_FRONTEND=noninteractive

# Mirror mặc định archive.ubuntu.com/security.ubuntu.com hay bị nghẽn/timeout từ mạng VN;
# đổi sang mirror trong nước để build ổn định.
RUN sed -i \
      -e 's|http://archive.ubuntu.com/ubuntu/|http://mirror.bizflycloud.vn/ubuntu/|' \
      -e 's|http://security.ubuntu.com/ubuntu/|http://mirror.bizflycloud.vn/ubuntu/|' \
      /etc/apt/sources.list.d/ubuntu.sources

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip git build-essential libsqlite3-dev zlib1g-dev \
      openjdk-21-jre-headless osmium-tool python3 python3-venv postgresql-client-16 zstd \
    && rm -rf /var/lib/apt/lists/*

# Rclone bản Ubuntu 24.04 là 1.60.1-DEV và phát sinh 501 khi ghi object lên R2.
# Pin bản stable chính thức, kiểm SHA-256 riêng cho amd64/arm64.
ARG RCLONE_RELEASE=1.75.0
ARG RCLONE_SHA256_AMD64=aa2804e08f48250e71009c727124b6341cd0288465804a9a09d14663cabafbaa
ARG RCLONE_SHA256_ARM64=d0ad88ba4c8e285b7c9efa591e0ab643280a91741e13c27f3a9c0957ccfa5203
RUN ARCH="$(dpkg --print-architecture)"; \
    case "$ARCH" in \
      amd64) SHA="$RCLONE_SHA256_AMD64" ;; \
      arm64) SHA="$RCLONE_SHA256_ARM64" ;; \
      *) echo "Kiến trúc rclone không hỗ trợ: $ARCH" >&2; exit 1 ;; \
    esac; \
    FILE="rclone-v${RCLONE_RELEASE}-linux-${ARCH}.zip"; \
    curl -fsSL --retry 5 --retry-all-errors -o "/tmp/${FILE}" \
      "https://downloads.rclone.org/v${RCLONE_RELEASE}/${FILE}"; \
    echo "${SHA}  /tmp/${FILE}" | sha256sum -c -; \
    unzip -q "/tmp/${FILE}" -d /tmp/rclone; \
    install -m 0755 "/tmp/rclone/rclone-v${RCLONE_RELEASE}-linux-${ARCH}/rclone" /usr/local/bin/rclone; \
    rm -rf "/tmp/${FILE}" /tmp/rclone; \
    rclone version

# tippecanoe (BSD-2) — build từ source theo tag
ARG TIPPECANOE_VERSION=2.62.5
RUN curl -fsSL --retry 5 --retry-all-errors \
      -o /tmp/tippecanoe.tar.gz \
      "https://codeload.github.com/felt/tippecanoe/tar.gz/refs/tags/${TIPPECANOE_VERSION}" \
    && mkdir -p /tmp/tippecanoe \
    && tar -xzf /tmp/tippecanoe.tar.gz --strip-components=1 -C /tmp/tippecanoe \
    && make -C /tmp/tippecanoe -j"$(nproc)" \
    && make -C /tmp/tippecanoe install \
    && rm -rf /tmp/tippecanoe /tmp/tippecanoe.tar.gz

# DuckDB CLI (MIT) — chọn theo kiến trúc
ARG DUCKDB_VERSION=1.5.3
RUN ARCH="$(dpkg --print-architecture)"; \
    case "$ARCH" in amd64) D=amd64 ;; arm64) D=arm64 ;; *) echo "Kiến trúc không hỗ trợ: $ARCH" >&2; exit 1 ;; esac; \
    curl -fsSL -o /tmp/duckdb.zip "https://github.com/duckdb/duckdb/releases/download/v${DUCKDB_VERSION}/duckdb_cli-linux-${D}.zip" \
    && unzip -q /tmp/duckdb.zip -d /usr/local/bin \
    && chmod +x /usr/local/bin/duckdb \
    && rm /tmp/duckdb.zip

# Planetiler (Apache-2.0)
ARG PLANETILER_VERSION=0.10.2
ARG PLANETILER_SIZE=93278824
ARG PLANETILER_SHA256=f310bd0413e2e4512b27f4046d418664e8e1d3bf31603c2a70e23de06c167e4d
RUN --mount=type=cache,id=mapslibvn-planetiler,target=/var/cache/mapslibvn \
    set -eu; \
    URL="https://github.com/onthegomap/planetiler/releases/download/v${PLANETILER_VERSION}/planetiler.jar"; \
    SIZE="${PLANETILER_SIZE}"; PARTS=8; CHUNK=$(( (SIZE + PARTS - 1) / PARTS )); PIDS=""; \
    for I in $(seq 0 $((PARTS - 1))); do \
      START=$((I * CHUNK)); END=$((START + CHUNK - 1)); \
      if [ "$END" -ge "$SIZE" ]; then END=$((SIZE - 1)); fi; \
      EXPECTED=$((END - START + 1)); FILE="/var/cache/mapslibvn/planetiler-${PLANETILER_VERSION}.part-${I}"; \
      ACTUAL="$(test -f "$FILE" && wc -c < "$FILE" || echo 0)"; \
      if [ "$ACTUAL" -ne "$EXPECTED" ]; then \
        rm -f "$FILE"; \
        curl -fsSL --retry 5 --retry-all-errors --range "${START}-${END}" -o "$FILE" "$URL" & \
        PIDS="$PIDS $!"; \
      fi; \
    done; \
    for PID in $PIDS; do wait "$PID"; done; \
    JAR="/var/cache/mapslibvn/planetiler-${PLANETILER_VERSION}.jar"; : > "$JAR"; \
    for I in $(seq 0 $((PARTS - 1))); do cat "/var/cache/mapslibvn/planetiler-${PLANETILER_VERSION}.part-${I}" >> "$JAR"; done; \
    test "$(wc -c < "$JAR")" -eq "$SIZE"; \
    echo "${PLANETILER_SHA256}  $JAR" | sha256sum -c -; \
    mkdir -p /opt/planetiler; \
    cp "$JAR" /opt/planetiler/planetiler.jar; \
    printf '#!/bin/sh\nexec java ${JAVA_OPTS:--Xmx4g} -jar /opt/planetiler/planetiler.jar "$@"\n' > /usr/local/bin/planetiler; \
    chmod +x /usr/local/bin/planetiler

# cloudflared (Apache-2.0) — `cloudflared access tcp` khi chạy data:update/db:restore từ máy dev qua Tunnel (M2 Task 1)
ARG CLOUDFLARED_VERSION=2026.8.2
RUN ARCH="$(dpkg --print-architecture)"; \
    curl -fsSL --retry 5 --retry-all-errors -o /usr/local/bin/cloudflared \
      "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${ARCH}" \
    && chmod +x /usr/local/bin/cloudflared

# pyosmium (BSD) trong venv riêng
ARG PYOSMIUM_VERSION=4.0.2
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir "osmium==${PYOSMIUM_VERSION}" "pytest==8.3.3"
ENV PATH="/opt/venv/bin:${PATH}"

# Node 22 + pnpm
ARG PNPM_VERSION=9.15.0
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate

FROM tools AS app
WORKDIR /app
ENV MAPSLIBVN_IN_CONTAINER=1 MAPSLIBVN_WORK=/app/work MAPSLIBVN_OUT=/app/out
COPY . .
RUN pnpm install --frozen-lockfile --filter . --filter "./pipelines/*" --filter "@mapslibvn/style" --filter "@mapslibvn/core" \
    && pnpm --filter @mapslibvn/core build \
    && node packages/style/scripts/build.mjs
# Cài sẵn extension DuckDB cho @duckdb/node-api (chạy offline/nhanh; extension lưu trong ~/.duckdb của image)
RUN cd pipelines/poi && node -e "import('@duckdb/node-api').then(async (m) => { const i = await m.DuckDBInstance.create(':memory:'); const c = await i.connect(); await c.run('INSTALL spatial; INSTALL httpfs;'); console.log('duckdb node-api + extensions OK'); })"
CMD ["node", "--version"]

# syntax=docker/dockerfile:1.7
# Image chung cho pipeline dữ liệu MapsLibVN: dùng trên máy dev, máy chủ nội bộ và GitHub Actions.
FROM ubuntu:24.04 AS tools
ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip git build-essential libsqlite3-dev zlib1g-dev \
      openjdk-21-jre-headless osmium-tool rclone python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

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
RUN pnpm install --frozen-lockfile --filter . --filter "./pipelines/*" --filter "@mapslibvn/style" \
    && node packages/style/scripts/build.mjs
CMD ["node", "--version"]

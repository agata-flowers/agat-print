FROM postgres:16-alpine
ARG MC_VERSION=RELEASE.2025-08-13T08-35-41Z
ARG MC_SHA256=01f866e9c5f9b87c2b09116fa5d7c06695b106242d829a8bb32990c00312e891
RUN apk add --no-cache bash curl ca-certificates jq restic && \
    curl -fsSL "https://github.com/minio/mc/releases/download/${MC_VERSION}/mc.linux-amd64.${MC_VERSION}" -o /usr/local/bin/mc && \
    echo "${MC_SHA256}  /usr/local/bin/mc" | sha256sum -c - && \
    chmod 0755 /usr/local/bin/mc
WORKDIR /opt/agat
COPY ops/backup/backup.sh ops/backup/restore.sh ./
RUN chmod 0555 backup.sh restore.sh

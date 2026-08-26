FROM postgres:16-alpine
ARG RESTIC_VERSION=0.18.0
RUN apk add --no-cache bash curl ca-certificates jq restic && \
    curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc && chmod 0755 /usr/local/bin/mc
WORKDIR /opt/agat
COPY ops/backup/backup.sh ops/backup/restore.sh ./
RUN chmod 0555 backup.sh restore.sh

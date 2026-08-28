FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/tmp \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      libreoffice-core \
      libreoffice-writer \
      poppler-utils \
      python3 \
      python3-opencv \
      python3-pil \
      tesseract-ocr \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 65532 processor \
    && useradd --uid 65532 --gid 65532 --no-create-home --shell /usr/sbin/nologin processor

COPY --chown=65532:65532 process.py /opt/agat/process.py

USER 65532:65532
WORKDIR /work
ENTRYPOINT ["python3", "/opt/agat/process.py"]

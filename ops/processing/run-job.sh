#!/bin/sh
set -eu

if [ "$#" -ne 3 ]; then
  echo "usage: run-job.sh INPUT OUTPUT KIND" >&2
  exit 64
fi

input_file=$1
output_file=$2
kind=$3
case "$kind" in
  PDF|DOCX|JPEG|PNG) ;;
  *) echo "unsupported processing kind" >&2; exit 64 ;;
esac
test -f "$input_file"

image=${PROCESSING_IMAGE:-agat-processing:local}
timeout_seconds=${PROCESSING_TIMEOUT_SECONDS:-120}
profile=${PROCESSING_SECCOMP_PROFILE:-ops/processing/seccomp.json}
max_pages=${PROCESSING_MAX_PAGES:-100}
max_pixels=${PROCESSING_MAX_IMAGE_PIXELS:-40000000}
test -f "$profile"

suffix=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
input_volume="agat-processing-input-$suffix"
output_volume="agat-processing-output-$suffix"
cleanup() {
  docker volume rm -f "$input_volume" "$output_volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker volume create "$input_volume" >/dev/null
docker volume create "$output_volume" >/dev/null

docker run --rm -i \
  --network none \
  --read-only \
  --cap-drop ALL \
  --cap-add CHOWN \
  --security-opt no-new-privileges:true \
  --pids-limit 16 \
  --memory 64m \
  --cpus 0.25 \
  --mount "type=volume,source=$input_volume,target=/data" \
  busybox:1.37 sh -c 'umask 077; cat > /data/source; chown 65532:65532 /data/source; chmod 0400 /data/source' < "$input_file"

docker run --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --cap-add CHOWN \
  --security-opt no-new-privileges:true \
  --pids-limit 16 \
  --memory 64m \
  --cpus 0.25 \
  --mount "type=volume,source=$output_volume,target=/data" \
  busybox:1.37 chown 65532:65532 /data

timeout --signal=KILL "$timeout_seconds" docker run --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --security-opt "seccomp=$profile" \
  --pids-limit 64 \
  --memory 768m \
  --memory-swap 768m \
  --cpus 1 \
  --user 65532:65532 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m,uid=65532,gid=65532 \
  --mount "type=volume,source=$input_volume,target=/input,readonly" \
  --mount "type=volume,source=$output_volume,target=/output" \
  --env "AGAT_MAX_PAGES=$max_pages" \
  --env "AGAT_MAX_IMAGE_PIXELS=$max_pixels" \
  "$image" --kind "$kind"

output_parent=$(dirname "$output_file")
mkdir -p "$output_parent"
docker run --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 16 \
  --memory 64m \
  --cpus 0.25 \
  --mount "type=volume,source=$output_volume,target=/data,readonly" \
  busybox:1.37 cat /data/result.pdf > "$output_file"
test -s "$output_file"

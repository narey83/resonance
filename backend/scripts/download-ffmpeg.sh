#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$SCRIPT_DIR/../tools/ffmpeg"

if [ -f "$DEST" ]; then
    exit 0
fi

# Only run on Linux
if [[ "$(uname -s)" != "Linux" ]]; then
    exit 0
fi

echo "  Downloading bundled ffmpeg binary..."

mkdir -p "$(dirname "$DEST")"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

ARCH="$(uname -m)"
case "$ARCH" in
    x86_64)  PLATFORM="linux64" ;;
    aarch64) PLATFORM="linuxarm64" ;;
    *)
        echo "  Unsupported architecture: $ARCH — install ffmpeg manually"
        exit 0
        ;;
esac

URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-${PLATFORM}-gpl.tar.xz"

if ! curl -s -L --fail -o "$TMP/ffmpeg.tar.xz" "$URL"; then
    echo "  ffmpeg download failed — skipping (transcoding unavailable)"
    exit 0
fi

tar -xJf "$TMP/ffmpeg.tar.xz" -C "$TMP"

FFMPEG_BIN="$(find "$TMP" -name "ffmpeg" -type f | head -1)"
if [ -z "$FFMPEG_BIN" ]; then
    echo "  Could not find ffmpeg binary in archive — skipping"
    exit 0
fi

cp "$FFMPEG_BIN" "$DEST"
chmod +x "$DEST"

echo "  ffmpeg ready at tools/ffmpeg"

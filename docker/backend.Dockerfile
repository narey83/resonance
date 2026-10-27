# Dev image for the Resonance backend.
#
# This image carries ONLY the toolchain (dotnet SDK + ffmpeg). Application source
# is bind-mounted at runtime and `dotnet watch` rebuilds on change, so the image
# is built once and editing code never requires a rebuild.
# Native Essentia build stage, including Linux ARM64 where PyPI has no wheel.
ARG BGUTIL_IMAGE=brainicism/bgutil-ytdlp-pot-provider@sha256:d7d34108b76e52c7d3b575fe9e797e4bf41c1b2a08f80c5292eff6f851ce8472
FROM $BGUTIL_IMAGE AS bgutil-provider

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS analysis-tools
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl build-essential pkg-config python3 python3-dev python3-venv libeigen3-dev libyaml-dev libfftw3-dev libavcodec-dev libavformat-dev libavutil-dev libswresample-dev libsamplerate0-dev libtag1-dev libchromaprint-dev \
    && rm -rf /var/lib/apt/lists/*
ARG ESSENTIA_REF=33108c70929684ed14091dfb671a30264cf8bb84
ARG ESSENTIA_SOURCE_SHA256=ca3aefcdee066f15c5bf99ae3ccfd34cd7266cd723fdbf7a001267e68747b8d1
COPY docker/scripts/install-essentia.sh /tmp/install-essentia.sh
RUN ESSENTIA_REF=$ESSENTIA_REF ESSENTIA_SOURCE_SHA256=$ESSENTIA_SOURCE_SHA256 sh /tmp/install-essentia.sh

FROM mcr.microsoft.com/dotnet/sdk:10.0

# ffmpeg       — Resonance shells out to it for audio analysis / conversion.
# procps       — `ps`/diagnostics inside the container.
# curl         — health checks / debugging.
# xz-utils     — GNU tar shells out to `xz` to extract the .tar.xz archives that
#                FfmpegService/yt-dlp's self-update downloads; without it, tar fails
#                with "xz: Cannot exec" and every self-update silently no-ops.
# python3+venv — host for Essentia (BPM and musical-key detection).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libatomic1 curl procps xz-utils python3 python3-venv libfftw3-single3 libyaml-0-2 libsamplerate0 libtag1v5 libchromaprint1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=analysis-tools /opt/keyenv /opt/keyenv
RUN /opt/keyenv/bin/python -c "import essentia.standard"

# Speed up first-run restore and keep the watcher responsive on bind mounts.
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_USE_POLLING_FILE_WATCHER=1 \
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1

# Bundle tools while building the image; startup never needs root or apt/pip.
ARG TARGETARCH
ARG YTDLP_VERSION=latest
ARG DENO_VERSION=latest
ARG FFMPEG_VERSION=latest
COPY docker/install-media-tools.py /tmp/install-media-tools.py
RUN TARGETARCH=$TARGETARCH YTDLP_VERSION=$YTDLP_VERSION DENO_VERSION=$DENO_VERSION FFMPEG_VERSION=$FFMPEG_VERSION python3 /tmp/install-media-tools.py \
    && /opt/resonance-tools/yt-dlp --version \
    && /opt/resonance-tools/deno --version \
    && /opt/resonance-tools/ffmpeg -version \
    && /opt/resonance-tools/ffprobe -version \
    && rm /tmp/install-media-tools.py
ENV RESONANCE_BUNDLED_TOOLS=/opt/resonance-tools

# Stable bgutil 2.0.2 with the matching checked-in yt-dlp plugin; update through development.
COPY --from=bgutil-provider /app /opt/resonance-bgutil
COPY --from=bgutil-provider /usr/local/bin/node /opt/resonance-bgutil/node
RUN /opt/resonance-bgutil/node -e "if (require('/opt/resonance-bgutil/package.json').version !== '2.0.2') process.exit(1)"
COPY docker/scripts/with-helper.py /opt/resonance/with-helper.py
ENV RESONANCE_BGUTIL_ROOT=/opt/resonance-bgutil

ARG DEV_UID=1000
ARG DEV_GID=1000
RUN mkdir -p /home/dev /cache/nuget /src/backend/bin /src/backend/obj /src/tests/bin /src/tests/obj \
    && chown -R $DEV_UID:$DEV_GID /home/dev /cache /src
ENV HOME=/home/dev DOTNET_CLI_HOME=/home/dev
USER $DEV_UID:$DEV_GID
WORKDIR /src

# Forward container stop signals to the application before stopping dotnet watch.
COPY docker/scripts/backend-watch.sh /usr/local/bin/resonance-backend-watch
ENTRYPOINT ["python3", "/opt/resonance/with-helper.py", "backend", "/bin/sh", "/usr/local/bin/resonance-backend-watch"]

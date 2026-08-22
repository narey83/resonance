# Dev image for the Resonance backend.
#
# This image carries ONLY the toolchain (dotnet SDK + ffmpeg). Application source
# is bind-mounted at runtime and `dotnet watch` rebuilds on change, so the image
# is built once and editing code never requires a rebuild.
FROM mcr.microsoft.com/dotnet/sdk:10.0

# ffmpeg       — Resonance shells out to it for audio analysis / conversion.
# procps       — `ps`/diagnostics inside the container.
# curl         — health checks / debugging.
# xz-utils     — GNU tar shells out to `xz` to extract the .tar.xz archives that
#                FfmpegService/yt-dlp's self-update downloads; without it, tar fails
#                with "xz: Cannot exec" and every self-update silently no-ops.
# python3+venv — host for Essentia (BPM and musical-key detection).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl procps xz-utils python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Essentia provides BPM and key detection (Analysis.EssentiaProfile='edma' by default),
# invoked by the backend as a subprocess via /opt/keyenv/bin/python. Isolated in its own venv
# so it never touches the system Python.
RUN python3 -m venv /opt/keyenv \
    && /opt/keyenv/bin/pip install --no-cache-dir essentia \
    && /opt/keyenv/bin/python -c "import essentia.standard"

# Speed up first-run restore and keep the watcher responsive on bind mounts.
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_USE_POLLING_FILE_WATCHER=1 \
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1

WORKDIR /src

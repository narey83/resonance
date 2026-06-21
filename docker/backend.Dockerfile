# Dev image for the Resonance backend.
#
# This image carries ONLY the toolchain (dotnet SDK + ffmpeg). Application source
# is bind-mounted at runtime and `dotnet watch` rebuilds on change, so the image
# is built once and editing code never requires a rebuild.
FROM mcr.microsoft.com/dotnet/sdk:10.0

# ffmpeg  — Resonance shells out to it for audio analysis / conversion.
# procps  — `ps`/diagnostics inside the container.
# curl    — health checks / debugging.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl procps \
    && rm -rf /var/lib/apt/lists/*

# Speed up first-run restore and keep the watcher responsive on bind mounts.
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_USE_POLLING_FILE_WATCHER=1 \
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1

WORKDIR /src

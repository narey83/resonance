# Production image for the Resonance backend — API only, no web UI.
# The GUI is served by the separate web image (docker/web.Dockerfile).
# Build from the repo root: docker build -f docker/prod.Dockerfile .

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY backend/ backend/
RUN dotnet publish backend/resonance.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0
# Same runtime deps as the dev image: ffmpeg for audio analysis/conversion,
# python venv hosting Essentia for key detection.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/keyenv \
    && /opt/keyenv/bin/pip install --no-cache-dir essentia \
    && /opt/keyenv/bin/python -c "import essentia.standard"

WORKDIR /app
COPY --from=build /app .
EXPOSE 5030
ENTRYPOINT ["dotnet", "resonance.dll"]

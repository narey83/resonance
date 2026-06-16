#!/usr/bin/env bash

echo "Stopping resonance services..."
systemctl --user stop resonance-frontend resonance-backend

# kill any stuck ffmpeg spawned by key analysis
ffmpeg_pids=$(ps aux | grep ffmpeg | grep -v grep | awk '{print $1}')
if [ -n "$ffmpeg_pids" ]; then
  echo "Killing ffmpeg processes: $ffmpeg_pids"
  for p in $ffmpeg_pids; do kill "$p" 2>/dev/null; done
fi

echo "Done."

# Resonance Cookie Sync — Browser Extension

Automatically syncs your YouTube cookies to the Resonance backend so yt-dlp can access age-restricted content.

## Installation

### Chromium (Brave, Chrome, Edge, Opera, Vivaldi, Arc)

1. Copy `manifest.chrome.json` → `manifest.json` in this directory
2. Open `brave://extensions` (or `chrome://extensions`)
3. Enable **Developer Mode** (top right toggle)
4. Click **Load unpacked** → select this `extension/` directory
5. Click the extension icon in the toolbar → enter your server URL and API key → Save & Sync

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** → select `manifest.firefox.json`
3. Click the extension icon → enter your server URL and API key → Save & Sync

> **Note:** Temporary add-ons are removed when Firefox restarts. For permanent install, sign the extension with a [Firefox account](https://addons.mozilla.org/en-US/developers/).

## Setup

- **Server URL**: The full base URL of your Resonance server, e.g. `http://192.168.0.254:5030`
- **API Key**: Found in System → Options → Web Server → API Key

## How it works

- On first save: syncs all `.youtube.com` cookies immediately
- Hourly: re-syncs automatically via the browser alarm API
- On change: debounced 5s re-sync when a YouTube cookie changes (e.g. after login)
- The cookie file is stored at `{resonance-data}/ytdlp-cookies.txt` on the server
- All yt-dlp downloads automatically include `--cookies` pointing to this file

#!/usr/bin/env python3
"""Image-build only: install verified upstream tools; no package manager runs at startup."""
import hashlib
import io
import json
import os
import pathlib
import tarfile
import urllib.request
import zipfile

root = pathlib.Path(os.environ.get('MEDIA_TOOLS_DEST', '/opt/resonance-tools'))
arch = os.environ.get('TARGETARCH', '')
if arch not in ('amd64', 'arm64'):
    raise SystemExit(f'Unsupported container architecture: {arch}')
root.mkdir(parents=True, exist_ok=True)
manifest = {}


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'resonance-image-build'})
    with urllib.request.urlopen(req, timeout=180) as response:
        return response.read()


def release(repo, version):
    suffix = 'latest' if version == 'latest' else 'tags/' + version
    return json.loads(fetch(f'https://api.github.com/repos/{repo}/releases/{suffix}'))


def asset(repo, metadata, name):
    item = next(a for a in metadata['assets'] if a['name'] == name)
    digest = item.get('digest', '')
    if not digest.startswith('sha256:'):
        raise RuntimeError(f'No upstream SHA-256 for {name}')
    url = item['browser_download_url']
    if not url.startswith(f'https://github.com/{repo}/releases/download/'):
        raise RuntimeError('Unexpected dependency source')
    data = fetch(url)
    if hashlib.sha256(data).hexdigest() != digest[7:]:
        raise RuntimeError(f'Checksum mismatch: {name}')
    return data


def write(name, data, source, version):
    target = root / name
    target.write_bytes(data)
    target.chmod(0o755)
    manifest[name] = {'sha256': hashlib.sha256(data).hexdigest(), 'source': source, 'version': version}


yt = release('yt-dlp/yt-dlp', os.environ.get('YTDLP_VERSION', 'latest'))
yt_asset = 'yt-dlp_linux_aarch64' if arch == 'arm64' else 'yt-dlp_linux'
write('yt-dlp', asset('yt-dlp/yt-dlp', yt, yt_asset), yt['html_url'], yt['tag_name'])
(root / 'yt-dlp-release.txt').write_text(yt['tag_name'])

deno = release('denoland/deno', os.environ.get('DENO_VERSION', 'latest'))
deno_asset = f"deno-{'aarch64' if arch == 'arm64' else 'x86_64'}-unknown-linux-gnu.zip"
with zipfile.ZipFile(io.BytesIO(asset('denoland/deno', deno, deno_asset))) as archive:
    write('deno', archive.read('deno'), deno['html_url'], deno['tag_name'])
(root / 'deno-release.txt').write_text(deno['tag_name'])

ff = release('yt-dlp/FFmpeg-Builds', os.environ.get('FFMPEG_VERSION', 'latest'))
ff_asset = f"ffmpeg-master-latest-{'linuxarm64' if arch == 'arm64' else 'linux64'}-gpl.tar.xz"
with tarfile.open(fileobj=io.BytesIO(asset('yt-dlp/FFmpeg-Builds', ff, ff_asset)), mode='r:xz') as archive:
    for name in ('ffmpeg', 'ffprobe'):
        member = next(m for m in archive.getmembers() if m.isfile() and m.name.endswith('/bin/' + name))
        write(name, archive.extractfile(member).read(), ff['html_url'], ff['published_at'])
    notices = root / 'ffmpeg-notices'
    notices.mkdir(exist_ok=True)
    for member in archive.getmembers():
        if member.isfile() and pathlib.PurePosixPath(member.name).name.startswith(('LICENSE', 'COPYING', 'README')):
            (notices / pathlib.PurePosixPath(member.name).name).write_bytes(archive.extractfile(member).read())
(root / 'ffmpeg-release.txt').write_text(ff['published_at'])
(root / 'manifest.json').write_text(json.dumps(manifest, indent=2))
# Keep upstream license/source notices alongside the distributed executables.
for repo, name, ref, license_name in [('yt-dlp/yt-dlp', 'yt-dlp', yt['tag_name'], 'LICENSE'), ('denoland/deno', 'deno', deno['tag_name'], 'LICENSE.md')]:
    (root / (name + '.LICENSE')).write_bytes(fetch(f'https://raw.githubusercontent.com/{repo}/{ref}/{license_name}'))
print('Verified media tools bundled:', ', '.join(manifest))

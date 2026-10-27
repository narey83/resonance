import hashlib
import io
import json
import os
import pathlib
import runpy
import tarfile
import tempfile
import unittest
import zipfile
from unittest.mock import patch

SCRIPT = pathlib.Path(__file__).parents[1] / 'install-media-tools.py'


class ToolImageTests(unittest.TestCase):
    def run_installer(self, arch, corrupt=False):
        runtime = io.BytesIO()
        with zipfile.ZipFile(runtime, 'w') as archive:
            archive.writestr('deno', b'runtime')
        ff = io.BytesIO()
        with tarfile.open(fileobj=ff, mode='w:xz') as archive:
            for name in ['ffmpeg', 'ffprobe', 'LICENSE.txt']:
                data = name.encode()
                info = tarfile.TarInfo('build/' + ('bin/' if name != 'LICENSE.txt' else '') + name)
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        yt_name = 'yt-dlp_linux_aarch64' if arch == 'arm64' else 'yt-dlp_linux'
        deno_name = f"deno-{'aarch64' if arch == 'arm64' else 'x86_64'}-unknown-linux-gnu.zip"
        ff_name = f"ffmpeg-master-latest-{'linuxarm64' if arch == 'arm64' else 'linux64'}-gpl.tar.xz"
        binaries = {yt_name: b'downloader', deno_name: runtime.getvalue(), ff_name: ff.getvalue()}

        def download(request, timeout=None):
            url = request.full_url
            if 'api.github.com' in url:
                repo = url.split('/repos/')[1].split('/releases/')[0]
                names = [ff_name] if repo.endswith('FFmpeg-Builds') else [deno_name] if repo.startswith('denoland') else [yt_name]
                assets = [{'name': name, 'digest': 'sha256:' + ('0' * 64 if corrupt else hashlib.sha256(binaries[name]).hexdigest()), 'browser_download_url': f'https://github.com/{repo}/releases/download/v1/{name}'} for name in names]
                data = json.dumps({'tag_name': 'v1', 'html_url': f'https://github.com/{repo}/releases/v1', 'published_at': '2026-10-24', 'assets': assets}).encode()
            elif 'raw.githubusercontent.com' in url:
                self.assertTrue(url.endswith(('LICENSE', 'LICENSE.md')))
                data = b'license'
            else:
                data = binaries[url.rsplit('/', 1)[1]]
            return io.BytesIO(data)

        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'MEDIA_TOOLS_DEST': directory, 'TARGETARCH': arch}), patch('urllib.request.urlopen', side_effect=download):
            runpy.run_path(str(SCRIPT), run_name='__main__')
            root = pathlib.Path(directory)
            manifest = json.loads((root / 'manifest.json').read_text())
            self.assertEqual(set(manifest), {'yt-dlp', 'deno', 'ffmpeg', 'ffprobe'})
            self.assertEqual((root / 'ffprobe').read_bytes(), b'ffprobe')
            self.assertTrue((root / 'deno.LICENSE').exists())

    def test_amd64_and_arm64_images_have_all_tools_and_notices(self):
        for arch in ['amd64', 'arm64']:
            with self.subTest(arch=arch):
                self.run_installer(arch)

    def test_checksum_failure_stops_the_image_build(self):
        with self.assertRaisesRegex(RuntimeError, 'Checksum mismatch'):
            self.run_installer('arm64', corrupt=True)


if __name__ == '__main__':
    unittest.main()

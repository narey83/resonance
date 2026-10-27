#!/bin/sh
set -eu
python3 -m venv /opt/keyenv
/opt/keyenv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel
# Prefer a published wheel. ARM64 currently needs a native source build.
if /opt/keyenv/bin/pip install --no-cache-dir --only-binary=:all: essentia; then
  /opt/keyenv/bin/python -c 'import essentia.standard'
  exit 0
fi
/opt/keyenv/bin/pip install --no-cache-dir 'numpy<3' pyyaml six
: "${ESSENTIA_REF:?Pinned Essentia revision is required}"
: "${ESSENTIA_SOURCE_SHA256:?Pinned source checksum is required}"
curl --fail --location --retry 3 "https://codeload.github.com/MTG/essentia/tar.gz/$ESSENTIA_REF" -o /tmp/essentia.tar.gz
printf '%s  %s\n' "$ESSENTIA_SOURCE_SHA256" /tmp/essentia.tar.gz | sha256sum -c -
mkdir /tmp/essentia-src
tar -xzf /tmp/essentia.tar.gz -C /tmp/essentia-src --strip-components=1
cd /tmp/essentia-src
# The pinned source targets FFmpeg 8; Ubuntu 24.04 ships FFmpeg 6.
# Preserve the same format selection using the older codec field when needed.
/opt/keyenv/bin/python - <<'PYCOMPAT'
from pathlib import Path
path = Path('src/essentia/utils/audiocontext.cpp')
source = path.read_text()
start = source.index('  if (avcodec_get_supported_config(')
end = source.index('    bool found = false;', start)
modern = source[start:end]
legacy = """  sample_fmts = audioCodec->sample_fmts;
  if (sample_fmts) {
    while (sample_fmts[nb_sample_fmts] != AV_SAMPLE_FMT_NONE) ++nb_sample_fmts;
  }
  if (nb_sample_fmts > 0) {
"""
source = source[:start] + '#if LIBAVCODEC_VERSION_MAJOR >= 61\n' + modern + '#else\n' + legacy + '#endif\n' + source[end:]
path.write_text(source)
PYCOMPAT
site_packages=$(/opt/keyenv/bin/python -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')
/opt/keyenv/bin/python waf configure --build-static --with-python --no-msse --prefix=/opt/keyenv --pythondir="$site_packages"
/opt/keyenv/bin/python waf build -j2
/opt/keyenv/bin/python waf install
mkdir -p /opt/keyenv/share/essentia
cp COPYING.txt /opt/keyenv/share/essentia/ 2>/dev/null || cp LICENSE* /opt/keyenv/share/essentia/
printf 'Source: https://github.com/MTG/essentia/tree/%s\n' "$ESSENTIA_REF" > /opt/keyenv/share/essentia/SOURCE.txt
/opt/keyenv/bin/python -c 'import essentia.standard as es; print(es.RhythmExtractor2013, es.KeyExtractor)'
rm -rf /tmp/essentia-src /tmp/essentia.tar.gz /opt/keyenv/include/essentia /opt/keyenv/lib/libessentia.a

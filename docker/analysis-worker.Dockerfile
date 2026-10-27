# Enhanced analysis runs in the existing backend, with persistent model assets.
ARG BASE_IMAGE=resonance-backend-dev:bridge-worker
FROM ${BASE_IMAGE} AS analysis-builder
USER root
RUN python3 -m venv /opt/resonance/venvs/beats \
 && /opt/resonance/venvs/beats/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/resonance/venvs/beats/bin/pip install --no-cache-dir torch==2.10.0 torchaudio==2.10.0 --index-url https://download.pytorch.org/whl/cpu \
 && /opt/resonance/venvs/beats/bin/pip install --no-cache-dir numpy==1.26.4 scipy beat-this==1.1.0 transformers==4.57.6 demucs==4.0.1 hydra-core librosa soundfile einops rotary-embedding-torch \
 && /opt/resonance/venvs/beats/bin/pip freeze --all > /opt/resonance/installed-analysis-requirements.txt
RUN apt-get update && apt-get install -y --no-install-recommends build-essential python3-dev git && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/resonance/venvs/dbn \
 && /opt/resonance/venvs/dbn/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/resonance/venvs/dbn/bin/pip install --no-cache-dir numpy==1.26.4 scipy Cython==0.29.37 setuptools wheel mido \
 && /opt/resonance/venvs/dbn/bin/pip install --no-cache-dir --no-build-isolation git+https://github.com/CPJKU/madmom.git@27f032e8947204902c675e5e341a3faf5dc86dae \
 && /opt/resonance/venvs/dbn/bin/pip freeze --all > /opt/resonance/installed-dbn-requirements.txt
FROM ${BASE_IMAGE}
USER root
COPY --from=analysis-builder /opt/resonance/venvs /opt/resonance/venvs
COPY --from=analysis-builder /opt/resonance/installed-analysis-requirements.txt /opt/resonance/installed-analysis-requirements.txt
COPY --from=analysis-builder /opt/resonance/installed-dbn-requirements.txt /opt/resonance/installed-dbn-requirements.txt
# Keep inference security updates separate from the costly native decoder cache.
RUN /opt/resonance/venvs/beats/bin/pip install --disable-pip-version-check --no-cache-dir --upgrade torch==2.11.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cpu \
 && /opt/resonance/venvs/beats/bin/pip install --disable-pip-version-check --no-cache-dir --upgrade transformers==5.21.0 \
 && /opt/resonance/venvs/beats/bin/pip freeze --all > /opt/resonance/installed-analysis-requirements.txt
# Patch packaging/locking helpers without downloading tensor wheels again.
RUN /opt/resonance/venvs/beats/bin/pip install --disable-pip-version-check --no-cache-dir --upgrade filelock==4.2.1 setuptools==84.2.1 \
 && /opt/resonance/venvs/beats/bin/pip freeze --all > /opt/resonance/installed-analysis-requirements.txt
COPY tools/analysis-worker/ /opt/resonance-analysis/worker/
COPY docker/scripts/music-mount-guard.py /opt/resonance-analysis/music-mount-guard.py
ENV HF_HUB_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 OMP_NUM_THREADS=2 MKL_NUM_THREADS=2
USER 1000:1000

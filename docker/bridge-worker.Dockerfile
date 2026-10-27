# Extend the existing backend image without rebuilding or changing its media/analysis tools.
ARG BASE_IMAGE=resonance-backend-dev:integrated-tools
FROM ${BASE_IMAGE} AS export-builder
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git python3-venv && rm -rf /var/lib/apt/lists/*
COPY tools/usb-export/ /opt/resonance-usb-export/worker/
RUN python3 -m venv /opt/resonance-usb-export/venv
RUN /opt/resonance-usb-export/venv/bin/pip install --disable-pip-version-check --no-cache-dir --upgrade pip
RUN /opt/resonance-usb-export/venv/bin/pip install --disable-pip-version-check --no-cache-dir -r /opt/resonance-usb-export/worker/requirements.txt
RUN /opt/resonance-usb-export/venv/bin/pip freeze --all > /opt/resonance-usb-export/installed-requirements.txt
RUN cd /opt/resonance-usb-export/worker && /opt/resonance-usb-export/venv/bin/python -m unittest discover -v
RUN python3 -m venv /tmp/bridge-audit \
 && /tmp/bridge-audit/bin/pip install --disable-pip-version-check --no-cache-dir pip-audit \
 && /tmp/bridge-audit/bin/pip-audit --path /opt/resonance-usb-export/venv/lib/python3.12/site-packages --format json --output /opt/resonance-usb-export/security-audit.json
FROM ${BASE_IMAGE}
USER root
COPY --from=export-builder /opt/resonance-usb-export /opt/resonance-usb-export
ENV RESONANCE_USB_EXPORT_PYTHON=/opt/resonance-usb-export/venv/bin/python \
 RESONANCE_USB_EXPORT_WORKER=/opt/resonance-usb-export/worker/usb_export.py \
 RESONANCE_USB_EXPORT_FFMPEG=/opt/resonance-tools/ffmpeg
# The export root is configured by deployment only after batch support is ready.
USER 1000:1000

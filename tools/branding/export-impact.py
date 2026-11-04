"""Encode the native Big Play animation from the browser-rendered frames."""
from pathlib import Path
import sys

from PIL import Image

frames = []
for path in sorted(Path(sys.argv[1]).glob("*.png")):
    with Image.open(path) as image:
        frames.append(image.convert("RGBA"))

if len(frames) != 90:
    raise SystemExit("Expected 90 Impact frames")
frames[0].save(sys.argv[2], save_all=True, append_images=frames[1:],
               duration=40, disposal=2, loop=0)

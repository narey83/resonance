#!/usr/bin/env python3
"""Generate Resonance brand assets. See branding/README.md for the pinned toolchain."""
import argparse
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import tempfile
from urllib.request import urlopen

import cairosvg
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
FONT_REVISION = "6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec"
TILE_COLOR = "#121F20"
NS = "http://www.w3.org/2000/svg"


def generate(destination):
    written = []

    def write(path, data):
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data.encode() if isinstance(data, str) else data)
        written.append(path)

    master = (ROOT / "branding/mark.svg").read_text()
    # Export no text, external resources, filters or fonts in the symbol.
    def svg(scale=1, background=None, color=None, radius=0):
        content = master[master.index(">") + 1:master.rindex("</svg>")].strip()
        if color:
            content = content.replace('fill="#9BE3D1"', f'fill="{color}"')
        inset = (96 - 96 * scale) / 2
        bg = f'<rect width="96" height="96" rx="{radius}" fill="{background}"/>' if background else ''
        return f'<svg xmlns="{NS}" viewBox="0 0 96 96" fill="none">{bg}<g transform="translate({inset} {inset}) scale({scale})">{content}</g></svg>\n'

    def png(vector, size):
        return cairosvg.svg2png(bytestring=vector.encode(), output_width=size, output_height=size)

    write("frontend/public/assets/brand/mark.svg", master)
    badge = svg(background=TILE_COLOR, radius=21)
    write("frontend/src/assets/resonance-mark.svg", badge)
    write("frontend/public/assets/brand/mark-mono.svg", svg(color="#FFFFFF"))
    tile = svg(background=TILE_COLOR)
    write("frontend/public/favicon.svg", badge)
    write("desktop/bridge/assets/favicon.svg", badge)
    icon = Image.open(BytesIO(png(badge, 256)))
    ico = BytesIO()
    icon.save(ico, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    write("frontend/public/favicon.ico", ico.getvalue())
    # NSIS installer icons use bitmap entries rather than PNG-compressed entries.
    bridge_ico = BytesIO()
    icon.save(bridge_ico, format="ICO", bitmap_format="bmp", sizes=[(16, 16), (32, 32), (48, 48)])
    write("desktop/bridge/assets/favicon.ico", bridge_ico.getvalue())
    write("desktop/bridge/assets/tray.png", png(badge, 32))
    write("desktop/bridge/assets/tray-template.png", png(svg(color="#000000"), 36))
    icns = BytesIO()
    Image.open(BytesIO(png(badge, 1024))).save(icns, format="ICNS")
    write("desktop/bridge/assets/bridge.icns", icns.getvalue())
    write("frontend/public/apple-touch-icon.png", png(tile, 180))
    for size in (192, 512):
        write(f"frontend/public/assets/brand/icon-{size}.png", png(tile, size))
    for name, size, vector in (
        ("icon.png", 1024, tile),
        ("icon-dev.png", 1024, tile),
        ("splash-icon.png", 512, badge),
        ("android-icon-foreground.png", 1080, svg(.5)),
        ("android-icon-monochrome.png", 1080, svg(.5, color="#FFFFFF")),
        ("android-icon-background.png", 1080, svg(0, TILE_COLOR)),
        ("android-icon-background-dev.png", 1080, svg(0, TILE_COLOR)),
        ("aa-icon-foreground.png", 1080, svg(.5, color="#24685A")),
        ("aa-app-icon.png", 512, svg(background="#FFFFFF", color="#24685A")),
        ("favicon.png", 64, tile),
    ):
        write(f"mobile/assets/{name}", png(vector, size))

    for family, weights in (("Inter", (400, 500, 600, 700)), ("Outfit", (600,))):
        source = ROOT / f"branding/fonts/{family}.ttf"
        font = TTFont(source, recalcTimestamp=False)
        font.flavor = "woff2"
        buffer = BytesIO()
        font.save(buffer)
        write(f"frontend/public/fonts/{family}.woff2", buffer.getvalue())
        for weight in weights:
            axes = {"wght": weight}
            if family == "Inter":
                axes["opsz"] = 14
            instance = instantiateVariableFont(TTFont(source, recalcTimestamp=False), axes, inplace=True, updateFontNames=True)
            buffer = BytesIO()
            instance.save(buffer)
            name = {400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold"}[weight]
            write(f"mobile/assets/fonts/{family}-{name}.ttf", buffer.getvalue())
            if family == "Outfit":
                glyphs = instance.getGlyphSet()
                cmap = instance.getBestCmap()
                units = instance["head"].unitsPerEm
                x = 0
                paths = []
                for char in "Resonance":
                    glyph = glyphs[cmap[ord(char)]]
                    pen = SVGPathPen(glyphs)
                    glyph.draw(pen)
                    paths.append(f'<path transform="translate({x} 0)" d="{pen.getCommands()}"/>')
                    x += glyph.width - units * .015
                scale = 58 / units
                width = round(118 + x * scale)
                for variant, color in (("light", "#0C1020"), ("dark", "#F7F8FC"), ("mono", "#FFFFFF")):
                    mark = svg(color={"light": "#24685A", "dark": None, "mono": "#FFFFFF"}[variant])
                    body = mark[mark.index('>') + 1:mark.rindex('</svg>')]
                    wordmark = f'<svg xmlns="{NS}" viewBox="0 0 {width} 96" fill="none" role="img" aria-label="Resonance">{body}<g fill="{color}" transform="translate(112 68) scale({scale} {-scale})">{"".join(paths)}</g></svg>\n'
                    write(f"frontend/public/assets/brand/wordmark-{variant}.svg", wordmark)
        license_text = (ROOT / f"branding/fonts/{family}-OFL.txt").read_bytes()
        write(f"frontend/public/fonts/{family}-OFL.txt", license_text)
        write(f"mobile/assets/fonts/{family}-OFL.txt", license_text)

    manifest = ''.join(f'{sha256((destination / path).read_bytes()).hexdigest()}  {path}\n' for path in sorted(written))
    write("branding/assets.sha256", manifest)


def fetch_fonts():
    for family, filename in (("Outfit", "Outfit%5Bwght%5D.ttf"), ("Inter", "Inter%5Bopsz,wght%5D.ttf")):
        for remote, local in ((filename, f"{family}.ttf"), ("OFL.txt", f"{family}-OFL.txt")):
            target = ROOT / "branding/fonts" / local
            target.parent.mkdir(parents=True, exist_ok=True)
            url = f"https://raw.githubusercontent.com/google/fonts/{FONT_REVISION}/ofl/{family.lower()}/{remote}"
            with urlopen(url, timeout=60) as response:
                data = response.read()
                if remote == "OFL.txt":
                    data = ("\n".join(line.rstrip() for line in data.decode().splitlines()) + "\n").encode()
                target.write_bytes(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch-fonts", action="store_true", help="Fetch the pinned upstream fonts and licenses")
    parser.add_argument("--check", action="store_true", help="Check generated assets without modifying the checkout")
    args = parser.parse_args()
    if args.fetch_fonts:
        fetch_fonts()
    if args.check:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            generate(output)
            stale = [str(p.relative_to(output)) for p in output.rglob("*") if p.is_file() and (not (ROOT / p.relative_to(output)).exists() or p.read_bytes() != (ROOT / p.relative_to(output)).read_bytes())]
            if stale:
                raise SystemExit("Stale brand assets: " + ", ".join(stale))
        print("All generated brand assets match the master and fonts.")
    else:
        generate(ROOT)


if __name__ == "__main__":
    main()

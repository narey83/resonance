"""Checks for the shipping brand assets, including native icon mask constraints."""
import json
from io import BytesIO

from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

import cairosvg
from fontTools.ttLib import TTFont
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]


class BrandingTests(unittest.TestCase):
    def test_ios_icon_is_square_opaque_and_high_resolution(self):
        icon = Image.open(ROOT / "mobile/assets/icon.png").convert("RGBA")
        self.assertEqual(icon.size, (1024, 1024))
        self.assertEqual(icon.getchannel("A").getextrema(), (255, 255))

    def test_android_layers_fit_even_the_circular_safe_zone(self):
        for name in ("android-icon-foreground.png", "android-icon-monochrome.png", "aa-icon-foreground.png"):
            with self.subTest(name=name):
                icon = Image.open(ROOT / "mobile/assets" / name).convert("RGBA")
                self.assertEqual(icon.size, (1080, 1080))
                alpha = icon.getchannel("A")
                self.assertEqual(alpha.getpixel((0, 0)), 0)
                points = [(x, y) for y in range(1080) for x in range(1080) if alpha.getpixel((x, y)) > 0]
                self.assertTrue(points)
                self.assertTrue(all((x - 540) ** 2 + (y - 540) ** 2 < 330 ** 2 for x, y in points))
        mono = Image.open(ROOT / "mobile/assets/android-icon-monochrome.png").convert("RGBA")
        self.assertTrue(all(r == g == b == 255 for r, g, b, a in mono.get_flattened_data() if a))

    def test_wordmarks_are_self_contained_outlines(self):
        ns = {"s": "http://www.w3.org/2000/svg"}
        for variant in ("light", "dark", "mono"):
            svg = ET.parse(ROOT / f"frontend/public/assets/brand/wordmark-{variant}.svg")
            self.assertFalse(svg.findall(".//s:text", ns))
            self.assertFalse(svg.findall(".//s:image", ns))
            self.assertGreater(len(svg.findall(".//s:path", ns)), 9)
            self.assertEqual(svg.getroot().get("aria-label"), "Resonance")

    def test_wordmark_cutouts_stay_transparent_on_every_surface(self):
        for variant in ("light", "dark", "mono"):
            with self.subTest(variant=variant):
                png = cairosvg.svg2png(bytestring=(ROOT / f"frontend/public/assets/brand/wordmark-{variant}.svg").read_bytes())
                with Image.open(BytesIO(png)) as image:
                    pixels = image.convert("RGBA")
                    self.assertEqual(pixels.getpixel((55, 34))[3], 0)
                    self.assertEqual(pixels.getpixel((35, 34))[3], 255)
                    self.assertIsNotNone(pixels.crop((112, 0, image.width, 96)).getchannel("A").getbbox())

    def test_fonts_are_real_faces_with_expected_weight_and_brand_glyphs(self):
        for family, weights in (("Inter", {"Regular": 400, "Medium": 500, "SemiBold": 600, "Bold": 700}), ("Outfit", {"SemiBold": 600})):
            for face, weight in weights.items():
                font = TTFont(ROOT / f"mobile/assets/fonts/{family}-{face}.ttf")
                self.assertEqual(font["OS/2"].usWeightClass, weight)
                self.assertNotIn("fvar", font)
                self.assertTrue(all(ord(char) in font.getBestCmap() for char in "Resonance£€é"))

    def test_browser_manifest_and_favicon_sizes(self):
        manifest = json.loads((ROOT / "frontend/public/manifest.webmanifest").read_text())
        self.assertEqual(manifest["start_url"], "./")
        for icon in manifest["icons"]:
            path = ROOT / "frontend/public" / icon["src"]
            with Image.open(path) as image:
                self.assertEqual("x".join(map(str, image.size)), icon["sizes"])
        with Image.open(ROOT / "frontend/public/favicon.ico") as ico:
            self.assertEqual(ico.ico.sizes(), {(16, 16), (32, 32), (48, 48), (64, 64)})


if __name__ == "__main__":
    unittest.main()

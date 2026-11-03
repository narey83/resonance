# Resonance identity

Big Play is the Resonance identity. The mint `#9BE3D1` R has a transparent play triangle and sits on a deep teal `#121F20` launch tile. Platform launcher assets use the appropriate square, rounded or adaptive treatment. The mark colours are independent of the selected UI accent.

`mark.svg` is the editable vector master. The outlined Outfit SemiBold wordmarks in `frontend/public/assets/brand/` include light, dark and monochrome variants and require no installed fonts. The frontend imports the generated rounded badge, which also serves as the bridge dashboard icon. The bridge uses a monochrome template in the macOS menu bar.

Web typography uses self-hosted variable Outfit for headings/brand and Inter for body text and controls. Mobile bundles static Inter Regular/Medium/SemiBold/Bold and Outfit SemiBold via the existing Expo Font runtime. App-owned `Text` and `TextInput` primitives preserve native props and refs, select actual face weights, inherit nested text styles and fall back to system fonts if loading fails. Monospaced technical labels and third-party icon fonts retain their intended families.

## Exports and regeneration

Generated files are recorded in `assets.sha256`. All outputs derive from the master and the original fonts under `fonts/`. Those originals and their SIL Open Font License notices come from [Google Fonts](https://github.com/google/fonts) revision `6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec` (`ofl/outfit` and `ofl/inter`). The generator embeds the revision for an explicit optional re-fetch. Outfit is by the Outfit Project Authors; Inter is by Rasmus Andersson and the Inter Project Authors. Their licenses are also shipped alongside runtime fonts in each app.

Run on the development build host, with Python 3 and Cairo available:

```sh
python3 -m venv .venv/branding
.venv/branding/bin/pip install -r tools/branding/requirements.txt
.venv/branding/bin/python tools/branding/generate.py
.venv/branding/bin/python tools/branding/generate.py --check
.venv/branding/bin/python tools/branding/test_branding.py
```

Normal regeneration is offline. `--fetch-fonts` explicitly re-downloads the pinned originals. Keep the locked generator versions to reproduce the PNG, WOFF2, TTF and ICO bytes.

The iOS universal icon is an opaque 1024px square, without baked-in corner rounding. Android adaptive and themed monochrome layers are 1080px transparent PNGs; every visible pixel fits inside the central 66/108 circular safe zone. The background fills the entire tile. Existing Android Auto app-icon assets receive the same identity; its neutral missing-artwork placeholder remains separate. No vehicle feature behaviour changes.

The web includes SVG/ICO favicons, a 180px Apple touch icon, 192/512px web icons and a relative manifest that supports URL prefixes. The manifest supplies install metadata; it does not add offline API caching.

Native app icon and splash configuration require rebuilding the Android and iOS binaries. The Expo 57 splash-screen plugin owns launch resources; a development client does not fully reproduce the release splash screen. Validate the final splash on a release build. iOS native builds require a Mac runtime exception under this repository's current host rule.

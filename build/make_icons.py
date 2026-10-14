"""Genere les icones de VideoGrab a partir de build/logo_1024.png (rendu de ui/logo.svg)."""
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = Image.open(os.path.join(ROOT, "build", "logo_1024.png")).convert("RGBA")

src.save(os.path.join(ROOT, "ui", "logo.ico"),
         sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
src.resize((256, 256), Image.LANCZOS).save(os.path.join(ROOT, "ui", "logo.png"))
src.save(os.path.join(ROOT, "ui", "logo.icns"))  # icone de l'application macOS

site = os.path.join(ROOT, "docs")
os.makedirs(site, exist_ok=True)
src.resize((180, 180), Image.LANCZOS).save(os.path.join(site, "apple-touch-icon.png"))
src.resize((512, 512), Image.LANCZOS).save(os.path.join(site, "logo-512.png"))
src.resize((32, 32), Image.LANCZOS).save(os.path.join(site, "favicon-32.png"))
print("icones generees")

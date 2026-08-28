import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path

import cv2
from PIL import Image


INPUT = Path("/input/source")
OUTPUT_DIR = Path("/output")
OUTPUT = OUTPUT_DIR / "result.pdf"
MAX_PAGES = int(os.environ.get("AGAT_MAX_PAGES", "100"))
MAX_IMAGE_PIXELS = int(os.environ.get("AGAT_MAX_IMAGE_PIXELS", "40000000"))


def page_count(path: Path) -> int:
    completed = subprocess.run(
        ["pdfinfo", str(path)],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
        env={"PATH": os.environ.get("PATH", "")},
    )
    for line in completed.stdout.splitlines():
        if line.startswith("Pages:"):
            return int(line.split(":", 1)[1].strip())
    raise RuntimeError("page count unavailable")


def normalize(kind: str) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if kind == "PDF":
        shutil.copyfile(INPUT, OUTPUT)
        return
    if kind == "DOCX":
        subprocess.run(
            [
                "libreoffice",
                "--headless",
                "--nologo",
                "--nodefault",
                "--nolockcheck",
                "--norestore",
                "-env:UserInstallation=file:///tmp/lo-profile",
                "--convert-to",
                "pdf",
                "--outdir",
                str(OUTPUT_DIR),
                str(INPUT),
            ],
            check=True,
            timeout=90,
            env={
                "HOME": "/tmp",
                "PATH": os.environ.get("PATH", ""),
                "SAL_DISABLE_SYNCHRONOUS_PRINTER_DETECTION": "1",
            },
        )
        converted = OUTPUT_DIR / "source.pdf"
        if not converted.exists():
            raise RuntimeError("conversion output missing")
        converted.replace(OUTPUT)
        return

    encoded = cv2.imread(str(INPUT), cv2.IMREAD_UNCHANGED)
    if encoded is None or encoded.shape[0] * encoded.shape[1] > MAX_IMAGE_PIXELS:
        raise RuntimeError("image decode rejected")
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    with Image.open(INPUT) as image:
        image.verify()
    with Image.open(INPUT) as image:
        image.convert("RGB").save(OUTPUT, "PDF", resolution=300.0)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=["PDF", "DOCX", "JPEG", "PNG"], required=True)
    args = parser.parse_args()
    normalize(args.kind)
    if not OUTPUT.read_bytes().startswith(b"%PDF-"):
        raise RuntimeError("invalid result signature")
    pages = page_count(OUTPUT)
    if pages < 1 or pages > MAX_PAGES:
        raise RuntimeError("result page limit exceeded")
    (OUTPUT_DIR / "result.json").write_text(
        json.dumps({"mediaType": "application/pdf", "pages": pages}),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

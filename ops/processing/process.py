import argparse
import json
import os
import shutil
import subprocess
import re
from pathlib import Path

import cv2
from PIL import Image


INPUT = Path("/input/source")
OUTPUT_DIR = Path("/output")
OUTPUT = OUTPUT_DIR / "result.pdf"
MAX_PAGES = int(os.environ.get("AGAT_MAX_PAGES", "100"))
MAX_IMAGE_PIXELS = int(os.environ.get("AGAT_MAX_IMAGE_PIXELS", "40000000"))
TARGET_WIDTH_MM = int(os.environ.get("AGAT_TARGET_WIDTH_MM", "210"))
TARGET_HEIGHT_MM = int(os.environ.get("AGAT_TARGET_HEIGHT_MM", "297"))
PHOTO_DOCUMENT = os.environ.get("AGAT_PHOTO_DOCUMENT", "false") == "true"


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


def normalize(kind: str) -> dict[str, object]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if kind == "PDF":
        shutil.copyfile(INPUT, OUTPUT)
        return {}
    if kind == "DOCX":
        typed_input = Path("/tmp/source.docx")
        shutil.copyfile(INPUT, typed_input)
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
                str(typed_input),
            ],
            check=True,
            timeout=90,
            env={
                "HOME": "/tmp",
                "PATH": os.environ.get("PATH", ""),
                "SAL_DISABLE_SYNCHRONOUS_PRINTER_DETECTION": "1",
                "SAL_DISABLE_MACROS": "1",
            },
        )
        converted = OUTPUT_DIR / "source.pdf"
        if not converted.exists():
            raise RuntimeError("conversion output missing")
        converted.replace(OUTPUT)
        return {}

    encoded = cv2.imread(str(INPUT), cv2.IMREAD_UNCHANGED)
    if encoded is None or encoded.shape[0] * encoded.shape[1] > MAX_IMAGE_PIXELS:
        raise RuntimeError("image decode rejected")
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    with Image.open(INPUT) as image:
        image.verify()
    with Image.open(INPUT) as image:
        width, height = image.size
        image.convert("RGB").save(OUTPUT, "PDF", resolution=300.0)
    width_inches = TARGET_WIDTH_MM / 25.4
    height_inches = TARGET_HEIGHT_MM / 25.4
    effective_dpi = min(width / width_inches, height / height_inches)
    border = encoded[
        : max(1, encoded.shape[0] // 20), :
    ]
    background_confidence = float(cv2.mean(border)[0]) / 255.0
    return {
        "imageWidth": width,
        "imageHeight": height,
        "effectiveDpi": round(effective_dpi, 2),
        "backgroundConfidence": round(background_confidence, 3),
        "headPositionConfidence": 0.5 if PHOTO_DOCUMENT else 1.0,
        "photoSizeConfidence": 0.5 if PHOTO_DOCUMENT else 1.0,
    }


def pdf_metadata(path: Path) -> dict[str, object]:
    completed = subprocess.run(
        ["pdfinfo", "-box", str(path)],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
        env={"PATH": os.environ.get("PATH", "")},
    )
    pages = page_count(path)
    size_match = re.search(
        r"Page size:\s+([0-9.]+) x ([0-9.]+) pts", completed.stdout
    )
    if not size_match:
        raise RuntimeError("page dimensions unavailable")
    width = float(size_match.group(1))
    height = float(size_match.group(2))
    # The pilot accepts common sheet/photo sizes and sends unreasonable page
    # geometry to a quality failure instead of producing a printable artifact.
    print_suitable = 0 < width <= 5669.3 and 0 < height <= 5669.3
    return {
        "mediaType": "application/pdf",
        "pages": pages,
        "pageWidthPoints": width,
        "pageHeightPoints": height,
        "orientation": "LANDSCAPE" if width > height else "PORTRAIT",
        "printSuitable": print_suitable,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=["PDF", "DOCX", "JPEG", "PNG"], required=True)
    parser.add_argument(
        "--operation", choices=["NORMALIZE", "PREFLIGHT"], default="NORMALIZE"
    )
    args = parser.parse_args()
    source_metadata = normalize(args.kind)
    if not OUTPUT.read_bytes().startswith(b"%PDF-"):
        raise RuntimeError("invalid result signature")
    metadata = pdf_metadata(OUTPUT)
    pages = int(metadata["pages"])
    if pages < 1 or pages > MAX_PAGES:
        raise RuntimeError("result page limit exceeded")
    (OUTPUT_DIR / "result.json").write_text(
        json.dumps(
            {
                **metadata,
                **source_metadata,
                "operation": args.operation,
            }
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

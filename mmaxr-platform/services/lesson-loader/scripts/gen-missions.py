#!/usr/bin/env python3
"""
Build the mission-lab lessons (Atom Builder, Ionic Bonding, Plant vs Animal Cell) from the MMAXR
modules they were ported from: missions, hints, checkpoint questions and narration, word for word.
The cell lab is read from XR's own copy (mmaxr-cell-explorer), which adds organelle chapters.
Narration audio is copied into mmaxr-assets/audio/<lab>/ and served by the lesson loader.

Usage: python3 scripts/gen-missions.py /path/to/MMAXR
"""
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"
ASSETS = HERE.parents[3] / "mmaxr-assets"
ASSET_URL = "http://localhost:3007/assets"

LABS = [
    {
        "module": "chem-atom-builder",
        "lessonId": "atom-builder",
        "type": "chemistry_atom_builder",
        "subject": "Chemistry",
        "summary": "Build atoms and ions particle by particle on the bench, then check your model.",
        "difficulty": "Core",
        "intro": "module-started",
        "invalid": "invalid-placement",
        "audio": True,
        "modelUrl": f"{ASSET_URL}/models/chemistry_lab_bench.glb",
    },
    {
        "module": "chem-ionic-bonding",
        "lessonId": "ionic-bonding",
        "type": "chemistry_ionic_bonding",
        "subject": "Chemistry",
        "summary": "Move an electron from sodium to chlorine, then join the ions to make sodium chloride.",
        "difficulty": "Core",
        "intro": "module-started",
        "invalid": "invalid-transfer",
        "audio": True,
        "modelUrl": f"{ASSET_URL}/models/chemistry_lab_bench.glb",
    },
    {
        "module": "bio-cell-explorer",
        "lessonId": "cell-explorer",
        "type": "biology_cell_explorer",
        "subject": "Biology",
        "summary": "Fly in close to a plant cell and an animal cell and find out what makes them different.",
        "difficulty": "Core",
        # The cell explorer narrates itself inside its own bundle.
        "intro": None,
        "invalid": None,
        "audio": False,
        "bundleUrl": "/cell-explorer/index.html",
        # XR extends this lab (more organelle chapters), so its source is XR's own copy, not MMAXR.
        "root": HERE.parents[3] / "mmaxr-cell-explorer" / "modules" / "bio-cell-explorer",
    },
]


def narration(root: Path, lab: dict, cue: str | None):
    if not cue:
        return None
    text_file = root / "narration" / "en" / f"{cue}.json"
    if not text_file.exists():
        return None
    text = json.loads(text_file.read_text())["text"]
    audio = root / "narration" / "en" / "generated" / f"{cue}.mp3"
    url = None
    if lab["audio"] and audio.exists():
        target = ASSETS / "audio" / lab["lessonId"] / audio.name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(audio, target)
        url = f"{ASSET_URL}/audio/{lab['lessonId']}/{audio.name}"
    return {"text": text, "audioUrl": url}


def question(item: dict) -> dict:
    ids = [o["id"] for o in item["options"]]
    return {
        "id": item["id"],
        "prompt": item["prompt"],
        "options": [{"id": o["id"], "label": o["text"]} for o in item["options"]],
        "answer": ids[item["correctOptionIndex"]],
        "explanation": item["explanation"],
    }


def build(mmaxr: Path, lab: dict) -> dict:
    root = lab.get("root") or mmaxr / "modules" / lab["module"]
    manifest = json.loads((root / "module.json").read_text())
    items = {}
    for f in sorted((root / "assessments").glob("*.json")):
        for item in json.loads(f.read_text()):
            items[item["id"]] = question(item)
    missions = []
    for m in manifest["missions"]:
        missions.append({
            "id": m["id"],
            "title": m["title"],
            "goalText": m["goalText"],
            "goal": m["goal"],
            "hints": m.get("hints", []),
            "start": narration(root, lab, f"{m['id']}-start"),
            "complete": narration(root, lab, f"{m['id']}-complete"),
            "questions": [items[i] for i in m.get("onComplete", {}).get("triggerAssessments", [])],
        })
    lesson = {
        "lessonId": lab["lessonId"],
        "type": lab["type"],
        "title": manifest["title"]["en"],
        "subject": lab["subject"],
        "summary": lab["summary"],
        "durationMinutes": manifest.get("estimatedMinutes"),
        "difficulty": lab["difficulty"],
        "intro": narration(root, lab, lab["intro"]),
        "invalid": narration(root, lab, lab["invalid"]),
        "missions": missions,
    }
    if lab.get("modelUrl"):
        lesson["modelUrl"] = lab["modelUrl"]
    if lab.get("bundleUrl"):
        lesson["bundleUrl"] = lab["bundleUrl"]
    return lesson


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    mmaxr = Path(sys.argv[1]).expanduser().resolve()
    for lab in LABS:
        lesson = build(mmaxr, lab)
        out = DATA / f"{lab['lessonId']}.json"
        out.write_text(json.dumps(lesson, indent=2, ensure_ascii=False) + "\n")
        print(f"{out.name}: {len(lesson['missions'])} missions, {sum(len(m['questions']) for m in lesson['missions'])} questions")


if __name__ == "__main__":
    main()

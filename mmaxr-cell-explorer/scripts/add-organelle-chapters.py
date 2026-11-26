#!/usr/bin/env python3
"""
Adds the organelle chapters to the Plant vs Animal Cell journey (XR extension of the MMAXR module):
cell wall, cell membrane, nucleus, ribosomes, endoplasmic reticulum, Golgi apparatus, lysosomes and vacuoles.

Order: outside in (wall, membrane), the control centre (nucleus), then the path a protein takes (ribosome, ER,
Golgi, and the lysosomes the Golgi makes), storage (vacuoles), and energy (mitochondria, chloroplasts) before
the recap. Writes module.json, the narration scripts and the assessment files; safe to run again.

Usage: python3 scripts/add-organelle-chapters.py
"""
import json
import re
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "modules" / "bio-cell-explorer"
CONCEPTS = Path(__file__).resolve().parents[1] / "packages" / "curriculum" / "concepts.json"

PLANT_TARGETS = [f"cell:plant:{o}" for o in ["cell-wall", "cell-membrane", "nucleus", "endoplasmic-reticulum", "golgi-apparatus", "vacuole", "chloroplast", "mitochondrion", "lysosome", "ribosome"]]


def beat(id, text, shot, highlight=None, ms=None):
    words = len(text.split())
    b = {"id": id, "cueId": id, "captionText": text, "shot": shot, "durationMs": ms or max(4500, words * 380)}
    if highlight:
        b["highlight"] = highlight
    return b


def q(id, prompt, options, answer, explanation, concept):
    return {
        "id": id,
        "prompt": prompt,
        "options": [{"id": k, "text": t} for k, t in zip("abcd", options)],
        "correctOptionIndex": answer,
        "explanation": explanation,
        "conceptIds": [concept, "sci.bio.cell.structure"],
        "reviewStatus": "pending",
    }


# (chapter, mission, questions file, questions)
CHAPTERS = [
    (
        {
            "id": "cell-wall",
            "title": "Cell wall",
            "missionId": "cx-cell-wall",
            "beats": [
                beat("wall-spot", "Only the plant cell has this thick outer layer. It is the cell wall.", "plant", "cell:plant:cell-wall"),
                beat("wall-cellulose", "The wall is made mostly of cellulose. Long cellulose fibres cross over each other, like threads in cloth.", "wall-detail", "detail:cell-wall:cellulose-fibres"),
                beat("wall-lamella", "Between two neighbouring plant cells is the middle lamella. It glues the cells together.", "wall-detail", "detail:cell-wall:middle-lamella"),
                beat("wall-channels", "Tiny channels called plasmodesmata pass through the walls, so neighbouring cells can share materials.", "wall-detail", "detail:cell-wall:plasmodesmata"),
                beat("wall-job", "The wall gives the plant cell its shape and strength, and protects it. Water and dissolved substances pass through it freely.", "wall-detail"),
            ],
            "checkpoint": {
                "kind": "tap",
                "id": "tap-cellulose",
                "prompt": "Tap the cellulose fibres.",
                "explanation": "Yes. Criss-crossing cellulose fibres make the cell wall strong.",
                "defaultFeedback": "Look for the long strands that cross over each other.",
                "correctTargets": ["detail:cell-wall:cellulose-fibres"],
                "wrongFeedback": {
                    "detail:cell-wall:middle-lamella": "That is the middle lamella, the layer that glues two cells together.",
                    "detail:cell-wall:plasmodesmata": "That is a plasmodesma, a channel through the wall.",
                },
            },
        },
        {"title": "Cell wall", "goalText": "Find what the cell wall is made of.", "hints": ["The fibres are long strands that cross over each other.", "Cellulose fibres make up the thick wall itself."]},
        "cell-wall.json",
        [
            q("assess.cell.wall.01", "What is the plant cell wall mainly made of?", ["Starch", "Cellulose", "Fat (lipid)", "Protein"], 1, "The plant cell wall is made mainly of cellulose. Its long fibres make the wall strong.", "sci.bio.cell.wall"),
            q("assess.cell.wall.02", "Why does a plant cell keep a box-like shape?", ["Its nucleus holds it in shape", "It has no cell membrane", "Its rigid cell wall supports it", "Its vacuole is always empty"], 2, "The rigid cell wall supports the plant cell and gives it a fixed, box-like shape.", "sci.bio.cell.wall"),
        ],
    ),
    (
        {
            "id": "cell-membrane",
            "title": "Membrane",
            "missionId": "cx-cell-membrane",
            "beats": [
                beat("mem-spot", "Every cell has a cell membrane. In the animal cell it is the outer boundary.", "animal", "cell:animal:cell-membrane"),
                beat("mem-plant", "In the plant cell, the membrane lies just inside the cell wall.", "plant", "cell:plant:cell-membrane"),
                beat("mem-bilayer", "Up close, the membrane is two layers of phospholipids, called a lipid bilayer.", "membrane-detail", "detail:cell-membrane:phospholipid-heads"),
                beat("mem-tails", "Their water-loving heads face outwards. Their water-hating fatty tails point into the middle.", "membrane-detail", "detail:cell-membrane:lipid-tails"),
                beat("mem-proteins", "Proteins sit in the membrane. Some form channels that let chosen substances in and out.", "membrane-detail", "detail:cell-membrane:membrane-protein"),
                beat("mem-job", "So the membrane is selectively permeable. It lets some substances through and keeps others out.", "membrane-detail"),
            ],
            "checkpoint": {
                "kind": "tap",
                "id": "tap-protein-channel",
                "prompt": "Tap a protein channel.",
                "explanation": "Yes. Protein channels let chosen substances cross the membrane.",
                "defaultFeedback": "Look for the larger shapes that cross the whole membrane.",
                "correctTargets": ["detail:cell-membrane:membrane-protein"],
                "wrongFeedback": {
                    "detail:cell-membrane:phospholipid-heads": "Those are phospholipid heads. The protein channels cross the whole membrane.",
                    "detail:cell-membrane:lipid-tails": "Those are the fatty tails in the middle of the bilayer.",
                },
            },
        },
        {"title": "Cell membrane", "goalText": "Find what controls what enters and leaves the cell.", "hints": ["Proteins are the larger shapes sitting across the membrane.", "Look for the shape with a passage through its middle."]},
        "cell-membrane.json",
        [
            q("assess.cell.membrane.01", "Why is the cell membrane called selectively permeable?", ["It lets some substances pass and stops others", "It lets every substance pass", "It lets nothing pass", "It is found only in plant cells"], 0, "The cell membrane lets some substances pass and keeps others out, so it is selectively permeable.", "sci.bio.cell.membrane"),
            q("assess.cell.membrane.02", "What is the cell membrane mainly made of?", ["Cellulose", "Starch and sugar", "DNA", "Lipids and proteins"], 3, "The cell membrane is a double layer of lipids (phospholipids) with proteins set into it.", "sci.bio.cell.membrane"),
        ],
    ),
    (
        {
            "id": "nucleus",
            "title": "Nucleus",
            "missionId": "cx-nucleus",
            "beats": [
                beat("nuc-spot", "This large, round organelle is the nucleus. It is the control centre of the cell.", "animal", "cell:animal:nucleus"),
                beat("nuc-plant", "The plant cell has a nucleus too, pushed to one side by its big vacuole.", "plant", "cell:plant:nucleus"),
                beat("nuc-envelope", "The nucleus is wrapped in a double membrane called the nuclear envelope.", "nucleus-detail", "detail:nucleus:nuclear-envelope"),
                beat("nuc-pores", "Pores in the envelope let messages and materials pass between the nucleus and the cytoplasm.", "nucleus-detail", "detail:nucleus:nuclear-pore"),
                beat("nuc-chromatin", "Inside is chromatin, made of DNA. DNA carries the instructions for building and running the cell.", "nucleus-detail", "detail:nucleus:chromatin"),
                beat("nuc-nucleolus", "The dark, dense body is the nucleolus. It makes ribosomes.", "nucleus-detail", "detail:nucleus:nucleolus"),
            ],
            "checkpoint": {
                "kind": "tap",
                "id": "tap-nucleolus",
                "prompt": "Tap the nucleolus.",
                "explanation": "Yes. The nucleolus is the dense body inside the nucleus that makes ribosomes.",
                "defaultFeedback": "The nucleolus is the dark ball inside the nucleus.",
                "correctTargets": ["detail:nucleus:nucleolus"],
                "wrongFeedback": {
                    "detail:nucleus:chromatin": "That is chromatin, the DNA. The nucleolus is the dark ball.",
                    "detail:nucleus:nuclear-envelope": "That is the nuclear envelope around the nucleus.",
                    "detail:nucleus:nuclear-pore": "That is a nuclear pore, an opening in the envelope.",
                },
            },
        },
        {"title": "Nucleus", "goalText": "Find the parts of the nucleus.", "hints": ["The nucleolus is the dark ball inside the nucleus.", "Look through the open wedge of the envelope."]},
        "nucleus.json",
        [
            q("assess.cell.nucleus.01", "Why is the nucleus called the control centre of the cell?", ["It makes energy from food", "It holds the DNA that directs the cell's work", "It makes food from sunlight", "It stores water"], 1, "The nucleus holds the DNA, the instructions that direct everything the cell does.", "sci.bio.cell.nucleus"),
            q("assess.cell.nucleus.02", "What do nuclear pores do?", ["Make ribosomes", "Break down waste", "Let materials pass in and out of the nucleus", "Store food"], 2, "Nuclear pores are openings in the envelope that let materials and messages pass in and out of the nucleus.", "sci.bio.cell.nucleus"),
        ],
    ),
    (
        {
            "id": "ribosomes",
            "title": "Ribosomes",
            "missionId": "cx-ribosomes",
            "beats": [
                beat("ribo-spot", "These tiny dark dots are ribosomes. There are thousands in every cell.", "animal", "cell:animal:ribosome"),
                beat("ribo-where", "Plant cells are full of them too. Some float free in the cytoplasm, and others sit on the endoplasmic reticulum.", "plant", "cell:plant:ribosome"),
                beat("ribo-parts", "A ribosome has two parts: a large subunit and a small subunit.", "ribosome-detail", "detail:ribosome:large-subunit"),
                beat("ribo-message", "Between them runs a message from the nucleus, called messenger RNA.", "ribosome-detail", "detail:ribosome:mrna"),
                beat("ribo-protein", "The ribosome reads the message and joins building blocks into a chain. That chain becomes a protein.", "ribosome-detail", "detail:ribosome:protein-chain"),
            ],
            "checkpoint": {
                "kind": "tap",
                "id": "tap-protein-chain",
                "prompt": "Tap the growing protein chain.",
                "explanation": "Yes. Ribosomes build proteins, one link at a time.",
                "defaultFeedback": "Look for the beaded strand coming out of the ribosome.",
                "correctTargets": ["detail:ribosome:protein-chain"],
                "wrongFeedback": {
                    "detail:ribosome:mrna": "That is the messenger RNA, the message being read.",
                    "detail:ribosome:large-subunit": "That is the large subunit. The chain comes out of it.",
                    "detail:ribosome:small-subunit": "That is the small subunit, which holds the message.",
                },
            },
        },
        {"title": "Ribosomes", "goalText": "Find what ribosomes make.", "hints": ["The protein chain comes out of the large subunit.", "It is the beaded strand leaving the top of the ribosome."]},
        "ribosomes.json",
        [
            q("assess.cell.ribosome.01", "What do ribosomes make?", ["Energy", "Food", "Proteins", "Cellulose"], 2, "Ribosomes read the message from the nucleus and build proteins.", "sci.bio.cell.ribosome"),
            q("assess.cell.ribosome.02", "Which part of the cell makes ribosomes?", ["The nucleolus", "The Golgi apparatus", "The lysosome", "The vacuole"], 0, "The nucleolus, inside the nucleus, makes ribosomes.", "sci.bio.cell.ribosome"),
        ],
    ),
    (
        {
            "id": "endoplasmic-reticulum",
            "title": "ER",
            "missionId": "cx-er",
            "beats": [
                beat("er-spot", "Around the nucleus is a folded network of membranes: the endoplasmic reticulum, or ER.", "animal", "cell:animal:endoplasmic-reticulum"),
                beat("er-rough", "Rough ER is covered in ribosomes. It carries the proteins they make through the cell.", "er-detail", "detail:endoplasmic-reticulum:rough-er"),
                beat("er-smooth", "Smooth ER has no ribosomes. It makes fats, called lipids, and helps remove harmful substances.", "er-detail", "detail:endoplasmic-reticulum:smooth-er"),
                beat("er-network", "Together they form a network of channels, a transport system inside the cell.", "er-detail"),
            ],
            "checkpoint": {
                "kind": "tap",
                "id": "tap-smooth-er",
                "prompt": "Tap the smooth ER.",
                "explanation": "Yes. Smooth ER has no ribosomes on it.",
                "defaultFeedback": "Smooth ER is the tangle of tubes with no dots on it.",
                "correctTargets": ["detail:endoplasmic-reticulum:smooth-er"],
                "wrongFeedback": {"detail:endoplasmic-reticulum:rough-er": "That is rough ER. Look for the tubes with no ribosomes."},
            },
        },
        {"title": "Endoplasmic reticulum", "goalText": "Tell rough ER from smooth ER.", "hints": ["Smooth ER has no dots on it.", "It looks like a tangle of smooth tubes."]},
        "endoplasmic-reticulum.json",
        [
            q("assess.cell.er.01", "What makes rough ER look rough?", ["Small vacuoles", "Ribosomes attached to it", "Cellulose fibres", "Chromatin"], 1, "Rough ER is studded with ribosomes, which make it look rough.", "sci.bio.cell.endoplasmic-reticulum"),
            q("assess.cell.er.02", "Which job belongs to the smooth ER?", ["Making food using sunlight", "Releasing energy from food", "Controlling the cell", "Making lipids (fats)"], 3, "Smooth ER makes lipids (fats) and helps remove harmful substances.", "sci.bio.cell.endoplasmic-reticulum"),
        ],
    ),
    (
        {
            "id": "golgi",
            "title": "Golgi",
            "missionId": "cx-golgi",
            "beats": [
                beat("golgi-spot", "This stack of flattened sacs is the Golgi apparatus.", "animal", "cell:animal:golgi-apparatus"),
                beat("golgi-sacs", "Each flat sac is called a cisterna. Proteins from the ER arrive at one side of the stack.", "golgi-detail", "detail:golgi-apparatus:cisternae"),
                beat("golgi-pack", "The Golgi changes, sorts and packs them, like the post office of the cell.", "golgi-detail"),
                beat("golgi-vesicles", "Packed materials leave in small bubbles called vesicles, to be sent inside or outside the cell.", "golgi-detail", "detail:golgi-apparatus:vesicles"),
            ],
            "checkpoint": {
                "kind": "choice",
                "id": "golgi-job",
                "prompt": "What does the Golgi apparatus do?",
                "explanation": "Yes. The Golgi apparatus packs materials and sends them where they are needed.",
                "defaultFeedback": "Think of a post office.",
                "options": [{"id": "energy", "text": "Releases energy from food"}, {"id": "pack", "text": "Packs and sends materials"}, {"id": "food", "text": "Makes food from sunlight"}],
                "correctOptionId": "pack",
                "wrongFeedback": {"energy": "Mitochondria release energy from food.", "food": "Chloroplasts make food from sunlight."},
            },
        },
        {"title": "Golgi apparatus", "goalText": "Find out what the Golgi apparatus does.", "hints": ["Think of a post office.", "Vesicles carry its packages away."]},
        "golgi.json",
        [
            q("assess.cell.golgi.01", "What are the small bubbles that bud off the Golgi apparatus called?", ["Vesicles", "Cristae", "Grana", "Chromosomes"], 0, "Vesicles are small membrane bubbles that carry the packed materials away.", "sci.bio.cell.golgi"),
            q("assess.cell.golgi.02", "Where do most proteins reach the Golgi apparatus from?", ["The cell wall", "The rough ER", "The vacuole", "The chloroplast"], 1, "Proteins made on the rough ER travel to the Golgi apparatus to be packed.", "sci.bio.cell.golgi"),
        ],
    ),
    (
        {
            "id": "lysosomes",
            "title": "Lysosomes",
            "missionId": "cx-lysosomes",
            "beats": [
                beat("lyso-spot", "These small round sacs are lysosomes. They are made by the Golgi apparatus.", "animal", "cell:animal:lysosome"),
                beat("lyso-enzymes", "A lysosome is a membrane bag full of digestive enzymes.", "lysosome-detail", "detail:lysosome:enzymes"),
                beat("lyso-job", "The enzymes break down waste, worn-out parts of the cell, and germs that get in.", "lysosome-detail"),
                beat("lyso-membrane", "Its membrane keeps the enzymes inside, so they do not digest the rest of the cell.", "lysosome-detail", "detail:lysosome:lysosome-membrane"),
                beat("lyso-suicide", "If the cell is badly damaged, lysosomes may burst and digest it. So they are called suicide bags.", "lysosome-detail"),
            ],
            "checkpoint": {
                "kind": "tap",
                "id": "tap-enzymes",
                "prompt": "Tap the digestive enzymes.",
                "explanation": "Yes. The enzymes inside a lysosome break things down.",
                "defaultFeedback": "The enzymes are the small particles inside the bag.",
                "correctTargets": ["detail:lysosome:enzymes"],
                "wrongFeedback": {"detail:lysosome:lysosome-membrane": "That is the membrane that keeps the enzymes in. Look inside it."},
            },
        },
        {"title": "Lysosomes", "goalText": "Find what is inside a lysosome.", "hints": ["The enzymes are the small particles inside.", "Look inside the open bag."]},
        "lysosomes.json",
        [
            q("assess.cell.lysosome.01", "Why are lysosomes called suicide bags?", ["They store the cell's DNA", "They make the cell's energy", "Their enzymes can digest the cell itself", "They push water out of the cell"], 2, "If the cell is damaged, lysosomes can burst and their enzymes digest the cell itself.", "sci.bio.cell.lysosome"),
            q("assess.cell.lysosome.02", "What keeps a lysosome's enzymes from digesting the rest of the cell?", ["Its membrane", "The cell wall", "The nucleolus", "Chlorophyll"], 0, "The lysosome's membrane keeps its digestive enzymes inside.", "sci.bio.cell.lysosome"),
        ],
    ),
    (
        {
            "id": "vacuoles",
            "title": "Vacuoles",
            "missionId": "cx-vacuoles",
            "beats": [
                beat("vac-plant", "The plant cell has one large central vacuole. It can fill most of the cell.", "plant", "cell:plant:vacuole"),
                beat("vac-animal", "Animal cells have small vacuoles, and only a few.", "animal", "cell:animal:vacuole"),
                beat("vac-sap", "The vacuole is filled with cell sap: water with dissolved sugars, salts and other substances.", "vacuole-detail", "detail:vacuole:cell-sap"),
                beat("vac-tonoplast", "Its membrane is called the tonoplast.", "vacuole-detail", "detail:vacuole:tonoplast"),
                beat("vac-firm", "A full vacuole presses outwards against the wall. That keeps the plant cell firm, so plants stand upright.", "vacuole-detail"),
                beat("vac-back", "Now look at the plant cell again.", "plant", None, 3500),
            ],
            "checkpoint": {
                "kind": "tap",
                "id": "tap-central-vacuole",
                "prompt": "Tap the large central vacuole.",
                "explanation": "Yes. The plant cell's large central vacuole is full of cell sap.",
                "defaultFeedback": "It is the big, clear, pale blue sac.",
                "correctTargets": ["cell:plant:vacuole"],
                "wrongFeedback": {
                    "cell:plant:chloroplast": "That is a chloroplast. The vacuole is the large, clear sac in the middle.",
                    "cell:plant:mitochondrion": "That is a mitochondrion. The vacuole is the large, clear sac in the middle.",
                    "cell:plant:nucleus": "That is the nucleus. The vacuole is the large, clear sac beside it.",
                },
            },
        },
        {"title": "Vacuoles", "goalText": "Find the large central vacuole.", "hints": ["It is the big, clear, pale blue sac.", "Look in the plant cell."]},
        "vacuoles.json",
        [
            q("assess.cell.vacuole.01", "What fills a plant cell's central vacuole?", ["Air", "Cell sap", "Chlorophyll", "Cytoplasm only"], 1, "The central vacuole is filled with cell sap: water with dissolved sugars and salts.", "sci.bio.cell.vacuole"),
            q("assess.cell.vacuole.02", "How does a full vacuole help a plant?", ["It makes food from sunlight", "It releases energy from food", "It makes proteins", "It keeps the cell firm, so the plant stands upright"], 3, "A full vacuole presses against the cell wall and keeps the cell firm, so the plant stands upright.", "sci.bio.cell.vacuole"),
        ],
    ),
]

NEW_CONCEPTS = ["sci.bio.cell.wall", "sci.bio.cell.membrane", "sci.bio.cell.nucleus", "sci.bio.cell.ribosome", "sci.bio.cell.endoplasmic-reticulum", "sci.bio.cell.golgi", "sci.bio.cell.lysosome", "sci.bio.cell.vacuole"]

RECAP_LIST = beat(
    "recap-list",
    "Both cells have a membrane, a nucleus, ribosomes, ER, a Golgi apparatus, lysosomes and mitochondria. Only the plant cell has a cell wall, chloroplasts and a large central vacuole.",
    "wide",
)


def cue(id, text):
    return {
        "id": id,
        "trigger": "journey_beat",
        "script": f"narration/en/{id}.json",
        "audio": f"narration/en/generated/{id}.mp3",
        "captions": f"narration/en/generated/{id}.vtt",
        "captionText": text,
        "interruptible": True,
    }


def write_script(id, text):
    (MODULE / "narration" / "en" / f"{id}.json").write_text(json.dumps({"text": text, "reviewStatus": "pending"}, indent=2) + "\n")


def main():
    manifest = json.loads((MODULE / "module.json").read_text())
    chapters = manifest["journey"]["chapters"]
    by_id = {c["id"]: c for c in chapters}
    order = ["two-cells"] + [c[0]["id"] for c in CHAPTERS] + ["mitochondria", "chloroplasts", "recap"]
    for chapter, _, _, _ in CHAPTERS:
        by_id[chapter["id"]] = chapter
    recap = by_id["recap"]
    recap["beats"] = [RECAP_LIST] + [b for b in recap["beats"] if b["id"] != RECAP_LIST["id"]]
    manifest["journey"]["chapters"] = [by_id[i] for i in order]

    missions = {m["id"]: m for m in manifest["missions"]}
    for chapter, mission, _, questions in CHAPTERS:
        missions[chapter["missionId"]] = {
            "id": chapter["missionId"],
            "title": mission["title"],
            "goalText": mission["goalText"],
            "goal": {"chapter": chapter["id"]},
            "hints": mission["hints"],
            "onComplete": {"triggerAssessments": [x["id"] for x in questions]},
        }
    manifest["missions"] = [missions[by_id[i]["missionId"]] for i in order]

    cues = {c["id"]: c for c in manifest["narration"]["cues"]}
    for chapter in [by_id[i] for i in order]:
        for b in chapter["beats"]:
            if b["cueId"] not in cues:
                cues[b["cueId"]] = cue(b["cueId"], b["captionText"])
                write_script(b["cueId"], b["captionText"])
    for _, _, file, questions in CHAPTERS:
        (MODULE / "assessments" / file).write_text(json.dumps(questions, indent=2, ensure_ascii=False) + "\n")
        for x in questions:
            cid = "answer-" + x["id"].replace(".", "-")
            text = f"The correct answer is: {x['options'][x['correctOptionIndex']]['text']}. {x['explanation']}"
            cues[cid] = cue(cid, text)
            write_script(cid, text)
    manifest["narration"]["cues"] = list(cues.values())

    inter = manifest["interactions"]
    inter["missions"] = [m["id"] for m in manifest["missions"]]
    inter["check"] = [i for m in manifest["missions"] for i in m.get("onComplete", {}).get("triggerAssessments", [])]
    manifest["concepts"] = list(dict.fromkeys(manifest["concepts"] + NEW_CONCEPTS))
    manifest["estimatedMinutes"] = 20
    manifest["levels"][0]["features"] = list(dict.fromkeys(manifest["levels"][0]["features"] + ["cell-wall", "cell-membrane", "nucleus", "ribosomes", "endoplasmic-reticulum", "golgi-apparatus", "lysosomes", "vacuoles"]))
    (MODULE / "module.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    concepts = json.loads(CONCEPTS.read_text())
    for c in NEW_CONCEPTS:
        concepts.setdefault(c, {"classes": [8, 9, 10], "boards": ["CBSE", "ICSE", "STATE"]})
    text = json.dumps(concepts, indent=2)
    # Keep the file's one-line arrays.
    text = re.sub(r"\[\s+([^\[\]]*?)\s+\]", lambda m: "[" + ", ".join(x.strip() for x in m.group(1).split(",")) + "]", text)
    CONCEPTS.write_text(text + "\n")
    print(f"{len(manifest['journey']['chapters'])} chapters, {len(manifest['missions'])} missions, {len(inter['check'])} questions, {len(cues)} narration cues")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Rebuild the two biology contracts as a view-only tour plus a short randomised quiz.

Per checkpoint the contract keeps what the tour teaches (explanation, animLabels) and a pool of quiz questions
(`quiz`, answers stay on the server). The old prediction groups, choice pools, per-stop keywords and "what if?"
scenarios are removed. Safe to re-run: animLabels are computed once from the old answers and then kept.
Usage: python3 scripts/gen-biology.py
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from bio_quiz_digestive import QUIZ as DIG
from bio_quiz_respiratory import QUIZ as RESP

DATA = os.path.join(os.path.dirname(__file__), '..', 'data')
CAP = lambda k: k[0].upper() + k[1:]
DROP_CP = ['prompt', 'answers', 'target', 'targetNutrient', 'expectedKeywords', 'keywordSynonyms', 'revealExplanation',
           'glandsInvolved', 'juicesInvolved', 'componentsInvolved', 'structuresInvolved',
           'answerGlands', 'answerJuices', 'answerComponents', 'answerNutrients']
DROP_TOP = ['choices', 'groups', 'transfer', 'revealLabels']

DIG_FINAL = {
    'prompt': 'You are back at the mouth. In your own words, follow a piece of bread from the mouth to the large intestine: say which juices and enzymes work on it, and how its nutrients reach the blood.',
    'minWords': 25,
    'expectedKeywords': ['saliva', 'amylase', 'stomach', 'pepsin', 'bile', 'pancreas', 'small intestine', 'villi', 'glucose', 'blood'],
    'keywordSynonyms': {
        'saliva': ['salivary'], 'amylase': ['ptyalin'], 'stomach': ['gastric', 'hcl', 'acid'], 'pepsin': ['protease'],
        'bile': ['gallbladder', 'liver', 'emulsify'], 'pancreas': ['pancreatic', 'lipase', 'trypsin'],
        'small intestine': ['duodenum', 'ileum', 'intestinal'], 'villi': ['villus', 'surface area'],
        'glucose': ['sugar', 'maltose', 'amino acids'], 'blood': ['capillaries', 'capillary', 'bloodstream'],
    },
    'modelAnswer': 'Chewing breaks the bread up while saliva with amylase starts turning starch into maltose. Peristalsis pushes the bolus down the oesophagus to the stomach, where acid and pepsin start on proteins and the food becomes chyme. In the duodenum, bile from the liver emulsifies fats and pancreatic juice (amylase, trypsin, lipase) continues the digestion, and intestinal enzymes finish it, so starch ends as glucose, proteins as amino acids and fats as fatty acids and glycerol. The villi, one cell thick with capillaries and a lacteal, absorb these into the blood and lymph. The large intestine absorbs water and the rest leaves as faeces.',
}

def labels_from_old(b, cp):
    keys = b.get('revealLabels') or ['juices', 'components']
    out = []
    for k in keys:
        ids = (cp.get('answers') or {}).get(k) or cp.get('answer' + CAP(k)) or []
        for i in ids:
            if i == 'none':
                continue
            lab = next((o['label'] for o in b['choices'].get(k, []) if o['id'] == i), None)
            if lab: out.append(lab)
    return out

# Stops that have no juice or enzyme still show names over the animation.
EXTRA_LABELS = {'esophagus': ['Peristalsis (muscle waves)', 'Mucus only: no enzymes'], 'villi': ['Villi (finger-like folds)', 'Capillaries: glucose and amino acids', 'Lacteal: fatty acids and glycerol'], 'large_intestine': ['Water and salts absorbed', 'Solid waste (faeces)']}

def build(fname, quiz, final=None):
    path = os.path.join(DATA, fname + '.json')
    b = json.load(open(path))
    migrating = 'choices' in b
    for cp in b['checkpoints']:
        if migrating:
            cp['animLabels'] = labels_from_old(b, cp) or EXTRA_LABELS.get(cp['id'], [])
            cp['explanation'] = cp['revealExplanation']
        pool = quiz[cp['id']]
        cp['quiz'] = [
            {'id': f"{cp['id']}_q{i+1}", 'prompt': q, 'options': [{'id': 'a', 'label': ok}] + [{'id': c, 'label': w} for c, w in zip('bcd', wrong)], 'answer': 'a', 'explanation': why}
            for i, (q, ok, wrong, why) in enumerate(pool)
        ]
        for k in DROP_CP: cp.pop(k, None)
    for k in DROP_TOP: b.pop(k, None)
    if final and 'finalExplain' not in b: b['finalExplain'] = final
    b['config'] = {'isGuidedTour': True, 'requireAudioExplanation': True, 'minExplanationWords': b['config'].get('minExplanationWords', 8), 'quizSize': 3}
    if migrating and fname == 'biology-respiratory': b['revealTimerLabel'] = b.get('revealTimerLabel', 'Watch what happens inside the body')
    if migrating and fname == 'biology-101': b['revealTimerLabel'] = 'Watch the enzymes at work'
    json.dump(b, open(path, 'w'), indent=2, ensure_ascii=False); open(path, 'a').write('\n')

build('biology-101', DIG, DIG_FINAL)
build('biology-respiratory', RESP)

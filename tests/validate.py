#!/usr/bin/env python3
from pathlib import Path
import json, re, subprocess, tempfile
p=Path(__file__).resolve().parents[1]
html=(p/'index.html').read_text(encoding='utf-8')
bank=json.loads((p/'questions.json').read_text(encoding='utf-8'))
found=re.search(r'<script id="defaultQuestions" type="application/json">(.+?)</script>', html, re.S)
assert found, "No embedded bank"
embedded=json.loads(found.group(1))
assert len(bank)==len(embedded)==170
assert embedded==bank
assert sum(q['author']=='Θουκυδίδης' for q in bank)==95
assert sum(q['author']=='Ξενοφώντας' for q in bank)==75
assert all(2<=len(q['options'])<=8 and 0<=q['answer']<len(q['options']) for q in bank)
for k in ['Array.from({length:68}', 'STOP_SPACING=120', 'id="reviewToggle"', 'id="reviewWrong"', 'id="reviewAll"', 'id="finalDrivingTime"', 'selectedIndex:i','game.totalTime']:
    assert k in html, f"Missing {k}"
scripts=re.findall(r'<script>(.+?)</script>', html,re.S)
assert scripts
with tempfile.TemporaryDirectory() as d:
    js=Path(d)/'app.js';js.write_text(scripts[-1],encoding='utf-8')
    subprocess.run(['node','--check',str(js)],check=True)
print('Valid: JavaScript, 170 questions (95+75), 68 checkpoints and review UI.')

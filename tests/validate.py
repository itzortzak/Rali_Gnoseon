#!/usr/bin/env python3
from pathlib import Path
import json, re, subprocess, tempfile
p=Path(__file__).resolve().parents[1]
html=(p/'index.html').read_text(encoding='utf-8')
bank=json.loads((p/'questions.json').read_text(encoding='utf-8'))
found=re.search(r'<script id="defaultQuestions" type="application/json">(.+?)</script>',html,re.S)
assert found, "No embedded bank"
embedded=json.loads(found.group(1))
assert len(bank)==len(embedded)==170
assert embedded==bank
assert len({q['id'] for q in bank})==170
assert sum(q['author']=='Θουκυδίδης' for q in bank)==95
assert sum(q['author']=='Ξενοφώντας' for q in bank)==75
assert all(2<=len(q['options'])<=8 and 0<=q['answer']<len(q['options']) for q in bank)
for k in ['Array.from({length:68}', 'STOP_SPACING=120', 'id="reviewToggle"', 'id="reviewWrong"', 'id="reviewAll"', 'id="finalDrivingTime"', 'selectedIndex:i', 'function shuffledQuestions()', 'questions=shuffledQuestions()', 'questionTime', 'pauseTime', 'elapsedTime', 'id="finalQuestionTime"', 'id="finalPauseTime"', 'id="questionClock"', 'id="pauseClock"', 'data-mode="both"', 'data-mode="thucydides"', 'data-mode="xenophon"', 'function setQuestionMode(mode)', 'function questionPoolForMode(mode)', 'function rebuildFinishArch()', 'id="introStations"', 'id="introQuestions"']:
    assert k in html, f"Missing {k}"
scripts=re.findall(r'<script>(.+?)</script>',html,re.S)
assert scripts
with tempfile.TemporaryDirectory() as d:
    js=Path(d)/'app.js'
    js.write_text(scripts[-1],encoding='utf-8')
    subprocess.run(['node','--check',str(js)],check=True)
    match=re.search(r'function shuffledQuestions\(\)\{.+?\n\}',scripts[-1],re.S)
    assert match
    # Runtime smoke test of Fisher-Yates, including 170 unique IDs in each game.
    code='const originalQuestions='+json.dumps([{'id':q['id']} for q in bank],ensure_ascii=False)+'; let questions=originalQuestions.slice();\n'+match.group(0)+'\n'
    code+='const one=shuffledQuestions();questions=one;const two=shuffledQuestions();\n'
    code+="if(one.length!==170||two.length!==170||new Set(one.map(x=>x.id)).size!==170||new Set(two.map(x=>x.id)).size!==170||one.every((q,i)=>q.id===two[i].id))process.exit(1);\n"
    subprocess.run(['node','-e',code],check=True)
# Verify every selectable corpus without losing or inventing a question.
pure_func=re.search(r'function questionPoolForMode\(mode\)\{.*?\n\}',scripts[-1],re.S)
assert pure_func, "Question pool selector not found"
mode_code='const originalQuestions='+json.dumps([{'id':q['id'],'author':q['author']} for q in bank],ensure_ascii=False)+';\n'
mode_code+="const MODE_AUTHORS={thucydides:'Θουκυδίδης',xenophon:'Ξενοφώντας'};\n"
mode_code+=pure_func.group(0)+"\n"
mode_code+="const expected={thucydides:[95,38,4680],xenophon:[75,30,3720],both:[170,68,8400]};\n"
mode_code+="""
for(const [mode,[count,stops,distance]] of Object.entries(expected)){
 const pool=questionPoolForMode(mode);
 if(pool.length!==count||new Set(pool.map(q=>q.id)).size!==count)process.exit(2);
 const stationCount=pool.length/5*2;
 const track=150+(stationCount-1)*120+(mode==='both'?210:90);
 if(stationCount!==stops||track!==distance)process.exit(3);
}
"""
subprocess.run(['node','-e',mode_code],check=True)
print('Validated v3.4: syntax, 170 unique source IDs, 95/75/170 selectable questions, 38/30/68 checkpoints and shuffling.')

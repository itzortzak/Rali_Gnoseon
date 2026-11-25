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
for k in ['Array.from({length:68}', 'STOP_SPACING=360', 'id="reviewToggle"', 'id="reviewWrong"', 'id="reviewAll"', 'id="finalDrivingTime"', 'selectedIndex:i', 'function shuffledQuestions()', 'questions=shuffledQuestions()', 'questionTime', 'pauseTime', 'elapsedTime', 'id="finalQuestionTime"', 'id="finalPauseTime"', 'id="questionClock"', 'id="pauseClock"', 'data-mode="both"', 'data-mode="thucydides"', 'data-mode="xenophon"', 'function setQuestionMode(mode)', 'function questionPoolForMode(mode)', 'function rebuildFinishArch()', 'id="introStations"', 'id="introQuestions"', 'function roadAngle(s)', 'function roadElevation(s)', 'function roadCurvature(s)', 'function pathCenter(distance)', 'function trackPoint(s,offset=0,height=0)', 'function roadBox(mesh,s,offset,height,w,h,d,col)', 'function drawFinishArch(mesh,s)', 'const hazards=[]', 'const variants=[', 'id="roadAlert"', 'const outward=-curvature*game.speed*game.speed*(.12+.19*difficultyAt(game.z))', 'function scenerySurfaceHeight(distance,offset)', 'function clearOfOtherRoad(distance,lane,radius)', 'const sceneryRoots=[]', 'function difficultyAt(s)', 'function difficultyText(s)']:
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
mode_code+="const expected={thucydides:[95,38,13700],xenophon:[75,30,10820],both:[170,68,24680]};\n"
mode_code+="""
for(const [mode,[count,stops,distance]] of Object.entries(expected)){
 const pool=questionPoolForMode(mode);
 if(pool.length!==count||new Set(pool.map(q=>q.id)).size!==count)process.exit(2);
 const stationCount=pool.length/5*2;
 const track=240+(stationCount-1)*360+(mode==='both'?320:140);
 if(stationCount!==stops||track!==distance)process.exit(3);
}
"""
subprocess.run(['node','-e',mode_code],check=True)
# Execute the actual route algorithm (extracted from the HTML) in Node.
route = re.search(r'// ROUTE_GEOMETRY_BEGIN(.*?)// ROUTE_GEOMETRY_END',scripts[-1],re.S)
assert route, "Parametric route geometry not found"
route_js = "const FULL_CHECKPOINTS=Array.from({length:68},(_,i)=>240+i*360);\n"+route.group(1)+"\n"
route_js += """
for(const s of [0,100,2100,2800,6900,13000,24000,24680]){
 const p=pathCenter(s),q=trackPoint(s,0);
 if(![p.x,p.z,q[0],q[1],q[2],roadAngle(s),roadGrade(s),roadCurvature(s)].every(Number.isFinite))process.exit(11);
 if(Math.abs(p.x-q[0])>1e-8||Math.abs(p.z-q[2])>1e-8)process.exit(12);
}
for(const turn of TURN_EVENTS){
 const delta=roadAngle(turn.center+120)-roadAngle(turn.center-120);
 if(!(Math.abs(delta)>1.95&&Math.abs(delta)<4.2))process.exit(13);
}
let backward=0,up=false,down=false;
for(let s=150;s<24640;s+=16){
 if(roadZ(s+8)<roadZ(s-8))backward++;
 if(roadGrade(s)>.065)up=true;
 if(roadGrade(s)<-.065)down=true;
}
if(backward<150||!up||!down||TURN_EVENTS.length<8)process.exit(14);
if(PATH_POSITIONS.length<6100)process.exit(15);
// The introductory section must feel much gentler than the later mountain stages.
if(TURN_EVENTS[0].center<3200)process.exit(16);
let firstCurves=0,firstGrades=0;
for(let s=0;s<=1200;s+=10){
 firstCurves=Math.max(firstCurves,Math.abs(roadAngle(s)));
 firstGrades=Math.max(firstGrades,Math.abs(roadGrade(s)));
 if(Math.abs(roadAngle(s))>.22 || Math.abs(roadGrade(s))>.030)process.exit(17);
}
if(firstCurves<.12||firstGrades<.012)process.exit(19);
if(!(Math.abs(roadAngle(200))<Math.abs(roadAngle(7800))+
 .2))process.exit(18);

"""
subprocess.run(['node','-e',route_js],check=True)
subprocess.run(['node',str(p/'tests/smoke_game.cjs')],check=True)

# Visibility regression: winding branches must not intersect or obscure the road.
assert 'const GROUND_Y=-8' in html, "Valley ground should be raised close to the road"
assert 'terrain.quad(ledgePoint(s,BANK_LEDGE)' in html, "Terraced road shoulders missing"
assert 'GROUND_TILE=105' in html and 'const groundPaletteAt=' in html, "Terrain palettes not restored"
assert 'for(let distance=-25;distance<FULL_TRACK_END+90;distance+=34)' in html, "Forest density not restored"
assert 'const radius=35+rand()*27,peak=48+rand()*30;' in html, "Natural hill dimensions missing"
assert 'const depth=dot(rel,cameraForward)' in html, "Fallback projection must use real camera depth"
assert 'perspective(Math.PI/2.70' in html, "Wider follow camera missing"
visibility_js=route_js.split('for(const s of [0,100,2100')[0]
visibility_js+="""
const cell=26,bins=new Map(),step=8;
let closest=Infinity;
const key=(x,z)=>x+','+z;
for(let s=0;s<24680;s+=step){
 const p=pathCenter(s),cx=Math.floor(p.x/cell),cz=Math.floor(p.z/cell);
 for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
  for(const q of bins.get(key(cx+dx,cz+dz))||[]){
   if(s-q.s<250)continue;
   const separation=Math.hypot(p.x-q.x,p.z-q.z);
   closest=Math.min(closest,separation);
  }
 }
 const k=key(cx,cz);
 if(!bins.has(k))bins.set(k,[]);
 bins.get(k).push({x:p.x,z:p.z,s});
}
if(!(closest>22))throw Error('Road intersects itself: closest separate branches = '+closest);
const minRoad=Math.min(...Array.from({length:1200},(_,i)=>roadElevation(i*20)));
if(!(minRoad>-25))throw Error('Road dips below global terrain');
console.log('Road visibility: separate branches',closest.toFixed(1),'m apart; minimum altitude',minRoad.toFixed(1));
"""
subprocess.run(['node','-e',visibility_js],check=True)
print('Validated v3.8: stronger safe curves and grades, seasonal terrain carpets, planted scenery, 3 modes and 170 questions.')


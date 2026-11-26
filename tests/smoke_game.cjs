#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const begin='<script id="defaultQuestions" type="application/json">';
const bankText=html.split(begin)[1]?.split('</script>')[0];
assert(bankText,'Embedded question bank is missing');
const bank=JSON.parse(bankText);
let script=html.split('<script>').at(-1).split('</script>')[0];
assert(script.includes('updateHUD();requestAnimationFrame(frame);'));
script=script.replace('updateHUD();requestAnimationFrame(frame);',`
 globalThis.__test={game,questions:()=>questions,checkpoints:()=>CHECKPOINTS,
  setQuestionMode,startGame,beginQuiz,answerQuestion,advanceQuestion,endGame,
  trackLength:()=>TRACK_LENGTH,roadAngle,roadGrade,roadZ,roadElevation,render,
  sceneryRoots,scenerySurfaceHeight,GROUND_Y,hazards,TURN_EVENTS,difficultyAt,
  keys,update,nearestRoadPose,placeCarOnRoad,recoverCar,enforceSafetyRails,trackPoint,
  ROAD_HALF,MAX_SAFE_OFFSET,RAIL_OFFSET};
 updateHUD();requestAnimationFrame(frame);`);
function createElement(){
 const obj={children:[],textContent:'',innerHTML:'',style:{},dataset:{},hidden:false,disabled:false};
 const classes=new Set();
 obj.classList={add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),
  toggle:(x,b)=>b===undefined?(classes.has(x)?(classes.delete(x),false):(classes.add(x),true)):(b?classes.add(x):classes.delete(x))};
 obj.append=(...items)=>obj.children.push(...items);
 obj.appendChild=x=>obj.children.push(x);
 obj.replaceChildren=(...items)=>{obj.children=items;};
 obj.addEventListener=()=>{};obj.setAttribute=()=>{};obj.focus=()=>{};obj.scrollIntoView=()=>{};
 return obj;
}
const elements=new Map();
const get=id=>elements.get(id)||(elements.set(id,createElement()),elements.get(id));
get('defaultQuestions').textContent=bankText;
const ctx=new Proxy({createLinearGradient:()=>({addColorStop:()=>{}})},{
 get:(obj,k)=>k in obj?obj[k]:(...args)=>{
  if(['moveTo','lineTo','fillRect','clearRect','translate','rotate'].includes(k)){
   assert(args.every(Number.isFinite),'Invalid canvas coordinate in '+k+': '+args);
  }
 }
});
const canvas=get('world');canvas.clientWidth=1280;canvas.clientHeight=720;
canvas.getContext=kind=>kind==='2d'?ctx:null;
const document={getElementById:get,createElement,querySelectorAll:()=>[]};
// Capture real event-handler callbacks instead of bypassing keyboard input.
const windowEvents={};
const fakeWindow={addEventListener:(type,fn)=>{(windowEvents[type]??=[]).push(fn);}};
const emitKey=(type,code,key=code,repeat=false)=>{
 const e={code,key,repeat,defaultPrevented:false,
  preventDefault(){this.defaultPrevented=true;}};
 for(const listener of windowEvents[type]||[])listener(e);
 return e;
};
const context={document,window:fakeWindow,performance:{now:()=>0},
 requestAnimationFrame:()=>{},setTimeout:()=>0,clearTimeout:()=>{},alert:()=>{},devicePixelRatio:1};
vm.createContext(context);
vm.runInContext(script,context,{timeout:20000,filename:'rali-game.js'});
const api=context.__test;
const expected={
 thucydides:{questions:95,stops:38,distance:13700},
 xenophon:{questions:75,stops:30,distance:10820},
 both:{questions:170,stops:68,distance:24680}
};
const previousOrders={};
for(const [mode,config] of Object.entries(expected)){
 api.game.mode='intro';api.setQuestionMode(mode);api.startGame();
 assert.equal(api.questions().length,config.questions);
 assert.equal(api.checkpoints().length,config.stops);
 assert.equal(api.trackLength(),config.distance);
 const ids=api.questions().map(q=>q.id);
 assert.equal(new Set(ids).size,config.questions);
 previousOrders[mode]=ids;
 api.render();
 let right=0;
 for(let checkpoint=0;checkpoint<config.stops;checkpoint++){
  api.game.z=api.checkpoints()[checkpoint];
  api.beginQuiz();
  for(let index=0;index<(checkpoint%2?3:2);index++){
   const q=api.questions()[api.game.question];
   assert(q,'Question missing at checkpoint '+checkpoint);
   const answer=(api.game.question%13===0)?(q.answer+1)%q.options.length:q.answer;
   if(answer===q.answer)right++;
   api.answerQuestion(answer);
   api.advanceQuestion();
  }
 }
 assert.equal(api.game.history.length,config.questions);
 assert.equal(api.game.correct,right);
 api.endGame();
 assert.equal(api.game.mode,'finish');
 // The fallback renderer must work throughout the easy opening and all switchbacks.
 for(const sample of [0,200,900,1700,2800,3350,4250,7600,8500,11800,12700,16340,17260,20850,21750,config.distance-50]){
  if(sample>=config.distance)continue;
  api.placeCarOnRoad(sample);api.render();
 }
 console.log(mode+': '+config.questions+' questions / '+config.stops+' checkpoints / '+config.distance+' m / '+right+' correct');
}
// The trees, bushes, stones and peaks must be placed on the actual terrain.
assert(api.sceneryRoots.length>900,'Missing roadside scenery');
const types=new Set(api.sceneryRoots.map(obj=>obj.type));
assert(types.has('tree')&&types.has('rock')&&types.has('mountain')&&types.has('bush'),'Scenery varieties missing');
for(const obj of api.sceneryRoots){
 const surface=obj.type==='mountain'?api.GROUND_Y:api.scenerySurfaceHeight(obj.distance,obj.lane);
 assert(Number.isFinite(obj.height));
 assert(Math.abs(obj.height-surface)<1e-6,'Floating scenery: '+JSON.stringify(obj));
}
assert(api.TURN_EVENTS.length===10&&api.TURN_EVENTS[0].center>3000);
let bendPeak=0,gradePeak=0;
for(let s=0;s<=1200;s+=25){
 const bend=Math.abs(api.roadAngle(s)),grade=Math.abs(api.roadGrade(s));
 bendPeak=Math.max(bendPeak,bend);gradePeak=Math.max(gradePeak,grade);
 assert(bend<.22,'Opening bend too sharp');
 assert(grade<.030,'Opening grade too steep');
}
assert(bendPeak>.12&&gradePeak>.012,'Opening must feature gentle, visible bends and hills');
assert(api.difficultyAt(0)===0);
assert(api.difficultyAt(5000)<api.difficultyAt(9000));
const firstHazards=api.hazards.filter(obj=>obj.z<2400);
assert(firstHazards.length>=3&&firstHazards.every(obj=>['cone','puddle'].includes(obj.type)),'Beginner obstacles should be sparse cones and puddles');
const lateHazards=api.hazards.filter(obj=>obj.z>=17000&&obj.z<21000);
const mediumHazards=api.hazards.filter(obj=>obj.z>=4000&&obj.z<8000);
assert(lateHazards.length>mediumHazards.length,'Obstacle density should grow');
assert(new Set(lateHazards.map(obj=>obj.type)).size>=6,'Late rally must contain varied obstacles');
assert(new Set(api.hazards.map(obj=>obj.type)).size===8,'Eight hazards must occur across the course');
assert(api.hazards.length>=80,'Hazards should appear throughout the route');
assert(api.hazards.some(x=>x.z<700),'An early obstacle must be visible before 700m');
console.log('Terrain verified:',api.sceneryRoots.length,'grounded objects,',api.hazards.length,'obstacles. Early:',firstHazards.length,'Intermediate:',mediumHazards.length,'Late:',lateHazards.length);
// Manual driving regression: car position and compass heading are never slaved to roadAngle.
function driveWith(arrow){
 api.game.mode='intro';api.startGame();
 api.game.station=api.checkpoints().length; // Isolate vehicle dynamics from quiz stops.
 const initial={x:api.game.x,z:api.game.worldZ,heading:api.game.heading};
 if(arrow!=='idle')api.keys.ArrowUp=true;
 if(arrow==='right')api.keys.ArrowRight=true;
 if(arrow==='left')api.keys.ArrowLeft=true;
 for(let i=0;i<29;i++)api.update(.042);
 const outcome={dx:api.game.x-initial.x,dz:api.game.worldZ-initial.z,
  deltaHeading:api.game.heading-initial.heading,steer:api.game.steer,
  recoveries:api.game.recoveries,speed:api.game.speed};
 for(const key of Object.keys(api.keys))api.keys[key]=false;
 return outcome;
}
const stationary=driveWith('idle'),rightDrive=driveWith('right'),leftDrive=driveWith('left'),straightDrive=driveWith('straight');
assert.equal(stationary.dx,0,'No gas must not move the car');
assert.equal(stationary.dz,0,'No gas must not move the car forward');
assert.equal(stationary.deltaHeading,0,'Steering at a standstill cannot rotate the car');
assert(rightDrive.dx>2&&rightDrive.deltaHeading>.1&&rightDrive.steer>.5,
 'Right arrow/D must rotate and drive RIGHT in world coordinates');
assert(leftDrive.dx< -2&&leftDrive.deltaHeading<-.1&&leftDrive.steer<-.5,
 'Left arrow/A must rotate and drive LEFT in world coordinates');
assert(Math.abs(straightDrive.dx)<1.5&&Math.abs(straightDrive.deltaHeading)<.001,
 'No steering must preserve world heading rather than automatically turning with road');
console.log('Manual controls: idle',stationary,'right',rightDrive,'left',leftDrive,'straight',straightDrive);

// The rails must be solid on BOTH sides in straight sections and hairpins.
assert.equal(api.MAX_SAFE_OFFSET,api.ROAD_HALF-1.25-.35);
for(const station of [120,1200,3300,7620,12300,21500]){
 for(const side of [-1,1]){
  api.game.mode='intro';api.startGame();
  api.game.station=api.checkpoints().length; // isolate physics from quiz triggers
  api.placeCarOnRoad(station,side*(api.MAX_SAFE_OFFSET-.65));
  const headingBefore=api.roadAngle(station)+side*.92;
  api.game.heading=headingBefore;api.game.speed=24;api.keys.ArrowUp=true;
  let maxLane=0;
  for(let step=0;step<120;step++){
   api.update(.045);
   maxLane=Math.max(maxLane,Math.abs(api.game.lane));
   assert(Math.abs(api.game.lane)<=api.MAX_SAFE_OFFSET+1e-5,
    'Car left road past '+side+' rail at '+station+'m');
  }
  assert(api.game.railHits>0,'Rail collision not registered');
  assert.equal(api.game.recoveries,0,'Guardrail should protect without teleporting car');
  assert(maxLane>=api.MAX_SAFE_OFFSET-.01,'Car never reached visible rail');
  // The barrier must not steer on its own or follow the road like an autopilot.
  assert(Math.abs(api.game.heading-headingBefore)<1e-8,'Guardrail automatically steered the car');
  Object.keys(api.keys).forEach(k=>api.keys[k]=false);
 }
}
// The same protection must work at a hairpin without driver steering.
api.game.mode='intro';api.startGame();api.game.station=api.checkpoints().length;
api.placeCarOnRoad(3300);api.keys.ArrowUp=true;
for(let i=0;i<140;i++){
 api.update(.045);
 assert(Math.abs(api.game.lane)<=api.MAX_SAFE_OFFSET+1e-5,'Car escaped at hairpin');
}
assert(api.game.railHits>0,'Auto-following the hairpin instead of hitting the rail');
for(const key of Object.keys(api.keys))api.keys[key]=false;


// Regression: the old game set speed=0 at a wall, but turning required speed.
// Rotate at rest ONLY while the player actively presses a steering key, then
// accelerate inward without needing R. Check both edges of the road.
for(const side of [-1,1]){
 api.game.mode='intro';api.startGame();api.game.station=api.checkpoints().length;
 api.placeCarOnRoad(1100,side*(api.MAX_SAFE_OFFSET-.55));
 api.game.heading=api.roadAngle(1100)+side*.98;
 api.game.speed=22;api.keys.ArrowUp=true;
 for(let i=0;i<12&&api.game.railHits===0;i++)api.update(.045);
 assert(api.game.railHits>0,'Could not reach the barrier for unstick test');
 assert(Math.abs(api.game.lane)<api.MAX_SAFE_OFFSET,'Vehicle outside physical lane');
 assert.equal(api.game.speed,0,'Barrier must stop outward movement');
 const oldHeading=api.game.heading,oldPosition=api.game.z,oldRecoveries=api.game.recoveries;
 api.keys.ArrowUp=false;
 const inwardKey=side>0?'ArrowLeft':'ArrowRight';
 api.keys[inwardKey]=true;
 for(let i=0;i<18;i++)api.update(.045);
 assert(side*(api.game.heading-oldHeading)<-.70,'Steering while stationary against wall did not rotate car');
 assert.equal(api.game.speed,0,'Steering without throttle must not move vehicle');
 api.keys[inwardKey]=false;api.keys.ArrowUp=true;
 let freed=false;
 for(let i=0;i<90;i++){
  api.update(.045);
  if(Math.abs(api.game.lane)<api.MAX_SAFE_OFFSET-1.0){freed=true;break;}
 }
 assert(freed,'Unable to drive clear of the protective barrier');
 assert.equal(api.game.recoveries,oldRecoveries,'Barrier should not require automatic reset');
 assert(api.game.z>oldPosition,'Driving away from the wall must increase progress');
 for(const k of Object.keys(api.keys))api.keys[k]=false;
}

// Input handlers: test physical arrows, A/D/W and R with Greek-layout key values.
assert((windowEvents.keydown||[]).length>0,'Keyboard handler was not installed');
api.game.mode='intro';api.startGame();api.game.station=api.checkpoints().length;
let e=emitKey('keydown','ArrowRight','ArrowRight');
assert(e.defaultPrevented&&api.keys.ArrowRight,'ArrowRight keydown not handled');
e=emitKey('keydown','KeyW','ω');
assert(e.defaultPrevented&&api.keys.ArrowUp,'KeyW not handled for Greek keyboard layout');
for(let i=0;i<22;i++)api.update(.045);
assert(api.game.heading>0,'Right arrow did not steer right');
emitKey('keyup','ArrowRight','ArrowRight');emitKey('keyup','KeyW','ω');
assert(!api.keys.ArrowRight&&!api.keys.ArrowUp,'Keyup did not release steering');
api.game.mode='intro';api.startGame();api.game.station=api.checkpoints().length;
emitKey('keydown','KeyA','α');emitKey('keydown','KeyW','ω');
for(let i=0;i<22;i++)api.update(.045);
assert(api.game.heading<0,'KeyA / left did not steer left on Greek layout');
emitKey('keyup','KeyA','α');emitKey('keyup','KeyW','ω');
api.game.mode='intro';api.startGame();api.game.station=api.checkpoints().length;
emitKey('keydown','KeyD','δ');emitKey('keydown','KeyW','ω');
for(let i=0;i<22;i++)api.update(.045);
assert(api.game.heading>0,'KeyD / right did not steer right on Greek layout');
emitKey('keyup','KeyD','δ');emitKey('keyup','KeyW','ω');

// R recovers to the local road centre, not the beginning of the game.
api.game.mode='intro';api.startGame();api.game.station=api.checkpoints().length;
api.placeCarOnRoad(3500,api.MAX_SAFE_OFFSET-.13);
api.game.railContactSide=1;api.game.speed=0;
api.keys.ArrowUp=true;
const beforeR=api.game.z,previousRecoveries=api.game.recoveries;
e=emitKey('keydown','KeyR','ρ');
assert(e.defaultPrevented,'KeyR must prevent browser defaults');
assert.equal(api.game.recoveries,previousRecoveries+1,'KeyR did not call recoverCar()');
assert(Math.abs(api.game.lane)<1e-8,'R did not centre the car');
assert(beforeR-api.game.z>0&&beforeR-api.game.z<=30,'R teleported too far from player');
assert(api.game.railContactSide===0,'R failed to clear barrier state');
assert(!api.keys.ArrowUp,'R must release stale gas input');
emitKey('keydown','KeyR','ρ',true);
assert.equal(api.game.recoveries,previousRecoveries+1,'Held R caused repeated penalties');
api.placeCarOnRoad(2000,api.MAX_SAFE_OFFSET-.12);
api.game.mode='pause';
const beforePause=api.game.recoveries;
emitKey('keydown','KeyR','ρ');
assert.equal(api.game.recoveries,beforePause+1,'R failed in paused mode');
assert.equal(api.game.mode,'pause','R must not resume a paused race unexpectedly');
console.log('Barrier unsticking and physical keyboard controls (Greek/English + R): passed.');

// Collision damage must require spatial proximity, not merely route progress.
api.game.mode='intro';api.startGame();
api.game.station=api.checkpoints().length;
const obstacle=api.hazards[0];
api.placeCarOnRoad(obstacle.z-2.6,obstacle.offset);
api.game.speed=29;api.update(.07);
assert(api.game.hits.size>=1,'Physical obstacle contact not detected');
const farHitCount=api.game.hits.size;
api.placeCarOnRoad(obstacle.z+8,-obstacle.offset);
api.update(.08);
assert.equal(api.game.hits.size,farHitCount,'Obstacle hit across opposite lane');
console.log('Actual driving, hairpin failure and physical collisions: passed.');
// A new run in the same mode must reshuffle its questions.
api.game.mode='intro';api.setQuestionMode('both');api.startGame();
const current=api.questions().map(q=>q.id);
assert.notDeepEqual(current,previousOrders.both);
assert.equal(current.length,bank.length);
console.log('Browser logic smoke test: passed (all 3 modes, finish, obstacles drawing fallback).');

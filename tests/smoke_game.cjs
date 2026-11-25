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
  sceneryRoots,scenerySurfaceHeight,GROUND_Y,hazards,TURN_EVENTS,difficultyAt};
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
const context={document,window:{addEventListener:()=>{}},performance:{now:()=>0},
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
  api.game.z=sample;api.render();
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
assert(firstHazards.length>0&&firstHazards.every(obj=>obj.type==='cone'),'Beginner obstacles should be sparse cones');
const lateHazards=api.hazards.filter(obj=>obj.z>=17000&&obj.z<21000);
const mediumHazards=api.hazards.filter(obj=>obj.z>=4000&&obj.z<8000);
assert(lateHazards.length>mediumHazards.length,'Obstacle density should grow');
assert(new Set(lateHazards.map(obj=>obj.type)).size>=3,'Late rally must contain several obstacles');
console.log('Terrain verified:',api.sceneryRoots.length,'grounded objects,',api.hazards.length,'obstacles. Early:',firstHazards.length,'Intermediate:',mediumHazards.length,'Late:',lateHazards.length);
// A new run in the same mode must reshuffle its questions.
api.game.mode='intro';api.setQuestionMode('both');api.startGame();
const current=api.questions().map(q=>q.id);
assert.notDeepEqual(current,previousOrders.both);
assert.equal(current.length,bank.length);
console.log('Browser logic smoke test: passed (all 3 modes, finish, obstacles drawing fallback).');

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
  trackLength:()=>TRACK_LENGTH,roadAngle,roadGrade,roadZ,render};
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
 // The fallback renderer must also work at a real switchback.
 for(const sample of [0,1800,2000,2250,2890,6600,7510,11180,12200,16340,17260,20520,21440,config.distance-50]){
  if(sample>=config.distance)continue;
  api.game.z=sample;api.render();
 }
 console.log(mode+': '+config.questions+' questions / '+config.stops+' checkpoints / '+config.distance+' m / '+right+' correct');
}
// A new run in the same mode must reshuffle its questions.
api.game.mode='intro';api.setQuestionMode('both');api.startGame();
const current=api.questions().map(q=>q.id);
assert.notDeepEqual(current,previousOrders.both);
assert.equal(current.length,bank.length);
console.log('Browser logic smoke test: passed (all 3 modes, finish, obstacles drawing fallback).');

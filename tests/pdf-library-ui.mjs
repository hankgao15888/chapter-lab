import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const core=createRequire(import.meta.url)('../docs/pdf-library-core.js');
const html=fs.readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');
const ids=[...html.matchAll(/id="([^"]+)"/g)].map(match=>match[1]);
assert.equal(ids.length,new Set(ids).size,'Page element IDs must be unique');
for(const match of fs.readFileSync(new URL('../docs/pdf-library.js',import.meta.url),'utf8').matchAll(/\$\('#([^']+)'\)/g))assert(ids.includes(match[1]),'Missing PDF control '+match[1]);
const records=new Map(),messages=[],chapters=[{id:'physics-forces',subject:'physics',zh:'力与运动',code:'P1',keywords:['force','acceleration']},{id:'physics-waves',subject:'physics',zh:'波动',code:'P2',keywords:['wavelength']}];
const storage={async list(owner){return [...records.values()].filter(r=>r.owner===owner).map(({blob,...r})=>structuredClone(r));},async get(owner,id){const r=records.get(id);return r?.owner===owner?structuredClone(r):null;},async save(meta,blob){records.set(meta.id,structuredClone({...meta,blob}));},async update(owner,meta){assert.equal(records.get(meta.id)?.owner,owner);records.set(meta.id,structuredClone({...meta,blob:records.get(meta.id).blob}));},async remove(owner,id){assert.equal(records.get(id)?.owner,owner);records.delete(id);}};
let destroyed=0,imported=0,pendingText=null;
async function loadDocument(){return {numPages:2,async getPage(page){return {getViewport:()=>({width:600,height:800,convertToViewportPoint:(x,y)=>[x,800-y]}),async getTextContent(){if(pendingText)return pendingText;return {items:[{str:page===1?'1. Calculate the force and acceleration.':'2. Explain the wavelength.',transform:[1,0,0,12,60,600],height:12}]};},cleanup(){},render:()=>({promise:Promise.resolve(),cancel(){}})};},async destroy(){destroyed++;}};}
function setup(name='Student Alice'){
 const elements=new Map();
 function el(selector){
  if(!elements.has(selector)){
   const classes=new Set(['hidden']),events=new Map();
   const element={value:'',innerHTML:'',textContent:'',disabled:false,clientWidth:800,style:{},selectedOptions:[],open:false,
    classList:{toggle(name,value){value?classes.add(name):classes.delete(name);},contains:name=>classes.has(name)},
    addEventListener(type,handler){events.set(type,handler);},showModal(){this.open=true;},close(){this.open=false;return events.get('close')?.();},click(){},focus(){},getContext:()=>({drawImage(){}}),getBoundingClientRect:()=>({left:10,top:20,width:600,height:800}),setAttribute(name,value){this[name]=value;},setPointerCapture(id){this.captured=id;},hasPointerCapture(id){return this.captured===id;},releasePointerCapture(){this.captured=null;},dispatch(type,event){return events.get(type)?.(event);},scrollIntoView(){}};
   elements.set(selector,element);
  }
  return elements.get(selector);
 }
 const context=vm.createContext({document:{querySelector:el,baseURI:'http://localhost/'},ChapterLabPDFCore:core,crypto:crypto.webcrypto,Blob,File,URL,TextEncoder,TextDecoder,AbortSignal,setTimeout:()=>0,confirm:()=>true,devicePixelRatio:1,addEventListener(){}});
 vm.runInContext(fs.readFileSync(new URL('../docs/pdf-library.js',import.meta.url),'utf8'),context);
 const library=context.ChapterLabPDFLibrary.create({chapters,getOwner:()=>name,getSubject:()=> 'physics',toast:message=>messages.push(message),onImported:()=>imported++,storage,loadDocument});
 return {el,library};
}
const file=new File(['%PDF-1.7\nmock contents'],'physics-practice.pdf',{type:'application/pdf'});
let ui=setup();await ui.library.importFiles([file]);
assert.equal(records.size,1);assert.equal(imported,1);assert(destroyed>=1);
assert(ui.el('#pdfViewerDialog').open);assert.equal(ui.el('#pdfViewerTitle').textContent,'physics-practice');
assert(ui.el('#pdfQuestionList').innerHTML.includes('第 1 题'));assert(ui.el('#pdfHistoryList').innerHTML.includes('physics-practice'));
assert(ui.el('#pdfHistoryList').innerHTML.includes('2 页'));
ui.el('#pdfQuestionLabel').value='My force question';ui.el('#pdfFirstPage').value='1';ui.el('#pdfLastPage').value='1';ui.el('#pdfQuestionType').value='calculation';ui.el('#pdfQuestionText').value='force';ui.el('#pdfQuestionChapters').selectedOptions=[{value:'physics-forces'}];
ui.el('#pdfSaveToNotebook').checked=true;
await ui.el('#pdfSaveQuestion').onclick();
assert([...records.values()][0].questions[0].reviewed);assert.equal([...records.values()][0].questions[0].label,'My force question');
assert.equal(ui.library.entries().length,1);
assert.equal(ui.library.entries()[0].notebookStatus,'wrong');
assert(ui.el('#pdfSavedQuestionList').innerHTML.includes('My force question'));
await ui.library.importFiles([file]);assert.equal(records.size,1);assert.equal([...records.values()][0].questions[0].label,'My force question','Reimport must preserve manual classifications');
await ui.el('#pdfViewerDialog').close();
ui=setup();await ui.library.renderHistory();assert(ui.el('#pdfHistoryList').innerHTML.includes('physics-practice'));
const id=[...records.keys()][0];
assert.equal(ui.library.entries()[0].notebookStatus,'wrong','Saved notebook state survives reopening');
await ui.library.setNotebook(id,'q1','correct');assert.equal(ui.library.entries()[0].notebookStatus,'correct');
await ui.library.setNotebook(id,'q1',null);assert.equal(ui.library.entries()[0].notebookStatus,null);assert.equal(ui.library.entries().length,1,'Removing from notebook retains saved exercise');
await ui.library.setNotebook(id,'q1','wrong');
await ui.library.openRecord(id);assert(ui.el('#pdfQuestionList').innerHTML.includes('My force question'));
await ui.el('#pdfAddQuestion').onclick();assert.equal([...records.values()][0].questions.length,3);
await ui.el('#pdfDeleteQuestion').onclick();assert.equal([...records.values()][0].questions.length,2);
await ui.library.openRecord(id,'q1');
ui.el('#pdfSplitPercent').value='70';await ui.el('#pdfSplitQuestion').onclick();
const split=[...records.values()][0].questions;
assert.equal(split.length,3);assert.equal(split[0].parts.at(-1).bottom,.7);assert.equal(split[1].parts[0].top,.7);
assert.equal(ui.library.entries().length,0,'Split results are drafts until individually saved');
ui.el('#pdfQuestionType').value='calculation';ui.el('#pdfQuestionChapters').selectedOptions=[{value:'physics-forces'}];ui.el('#pdfSaveToNotebook').checked=false;
await ui.el('#pdfSaveQuestion').onclick();assert.equal(ui.library.entries().length,1);assert.equal(ui.library.entries()[0].notebookStatus,null);
await ui.library.openRecord(id,split[1].id);ui.el('#pdfQuestionType').value='explanation';ui.el('#pdfQuestionChapters').selectedOptions=[];ui.el('#pdfSaveToNotebook').checked=true;
await ui.el('#pdfSaveQuestion').onclick();assert.equal(ui.library.entries().length,2);assert.equal(ui.library.entries().filter(q=>q.notebookStatus==='wrong').length,1);
const oldUpdate=storage.update;storage.update=async()=>{throw Error('storage blocked');};
ui.el('#pdfQuestionLabel').value='Must not persist';await ui.el('#pdfSaveQuestion').onclick();
assert.notEqual([...records.values()][0].questions[1].label,'Must not persist','Save failure must retain prior persisted question');storage.update=oldUpdate;
const bob=setup('Student Bob');await bob.library.renderHistory();assert(!bob.el('#pdfHistoryList').innerHTML.includes('physics-practice'));assert.equal(bob.library.entries().length,0);await assert.rejects(()=>bob.library.setNotebook(id,'q1','wrong'));
await bob.library.openRecord(id);assert(messages.at(-1).includes('找不到'));
await ui.library.importFiles([new File(['not pdf'],'bad.pdf')]);assert.equal(records.size,1);assert(messages.some(message=>message.includes('有效的 PDF')));
await ui.library.importFiles([new File(['%PDF-1.7'],'second.pdf')]);assert.equal(records.size,2);
await ui.library.openRecord(id,'q1');
const countBeforeRegion=records.get(id).questions.length;
const pointer=(x,y)=>({clientX:10+x*600,clientY:20+y*800,pointerId:1,button:0,isPrimary:true,preventDefault(){}});
async function enableRegion(){if(ui.el('#pdfRegionMode')['aria-pressed']!=='true')await ui.el('#pdfRegionMode').onclick();}
async function drag(start={x:.05,y:.15},end={x:.8,y:.4}){
 ui.el('#pdfPageFrame').onpointerdown(pointer(start.x,start.y));ui.el('#pdfPageFrame').onpointermove(pointer(end.x,end.y));await ui.el('#pdfPageFrame').onpointerup(pointer(end.x,end.y));
}
await enableRegion();await drag();
assert.equal(ui.el('#pdfRegionReview').hidden,false);assert(ui.el('#pdfRegionText').value.includes('force'));assert.equal(ui.el('#pdfRegionType').value,'calculation');assert(ui.el('#pdfRegionChapters').innerHTML.includes('selected'));
ui.el('#pdfCancelRegion').onclick();assert.equal(ui.el('#pdfRegionReview').hidden,true);assert.equal(records.get(id).questions.length,countBeforeRegion,'Cancel leaves all original questions untouched');
await drag({x:.8,y:.4},{x:.05,y:.15});const handleEvent=(x,y,direction)=>({...pointer(x,y),target:{closest:selector=>selector==='[data-region-handle]'?{dataset:{regionHandle:direction}}:selector==='#pdfRegionBox'?{}:null}});
ui.el('#pdfPageFrame').onpointerdown(handleEvent(.8,.4,'se'));ui.el('#pdfPageFrame').onpointermove(handleEvent(.9,.5,'se'));await ui.el('#pdfPageFrame').onpointerup(handleEvent(.9,.5,'se'));
assert.equal(ui.el('#pdfRegionBox').style.width,'85%');
const moveEvent=(x,y)=>({...pointer(x,y),target:{closest:selector=>selector==='#pdfRegionBox'?{}:null}});
ui.el('#pdfPageFrame').onpointerdown(moveEvent(.5,.3));ui.el('#pdfPageFrame').onpointermove(moveEvent(.55,.35));await ui.el('#pdfPageFrame').onpointerup(moveEvent(.55,.35));
assert(Math.abs(parseFloat(ui.el('#pdfRegionBox').style.left)-10)<1e-8);
ui.el('#pdfRegionLabel').value='My selected region';ui.el('#pdfRegionChapters').selectedOptions=[{value:'physics-waves'}];ui.el('#pdfRegionType').value='explanation';
const normalUpdate=storage.update;storage.update=async()=>{throw Error('region save blocked');};
await ui.el('#pdfConfirmRegion').onclick();assert.equal(records.get(id).questions.length,countBeforeRegion);assert.equal(ui.el('#pdfRegionReview').hidden,false,'Failed confirmation retains editable preview');storage.update=normalUpdate;
await ui.el('#pdfConfirmRegion').onclick();
const regionId=records.get(id).questions.at(-1).id,region=records.get(id).questions.at(-1);
assert.equal(region.label,'My selected region');assert.equal(region.chapters[0],'physics-waves');assert.equal(region.type,'explanation');assert.equal(region.savedAt,null);assert(Math.abs(region.parts[0].left-.1)<1e-8);assert(Math.abs(region.parts[0].right-.95)<1e-8);
ui.el('#pdfQuestionType').value='explanation';ui.el('#pdfQuestionChapters').selectedOptions=[{value:'physics-waves'}];ui.el('#pdfSaveToNotebook').checked=true;
await ui.el('#pdfSaveQuestion').onclick();await ui.library.openRecord(id,regionId);
assert(Math.abs(parseFloat(ui.el('#pdfQuestionHighlight').style.left)-10)<1e-8);assert(Math.abs(parseFloat(ui.el('#pdfQuestionHighlight').style.right)-5)<1e-8);assert.equal(ui.el('#pdfCropView').hidden,false);assert.equal(ui.el('#pdfCanvasHost').hidden,true);assert(ui.el('#pdfCropCanvas').width>1);assert.equal(records.get(id).questions.at(-1).notebookStatus,'wrong');
const countBeforeEdit=records.get(id).questions.length;
await ui.el('#pdfEditCrop').onclick();assert.equal(ui.el('#pdfRegionLabel').value,'My selected region');
await ui.el('#pdfConfirmRegion').onclick();assert.equal(records.get(id).questions.length,countBeforeEdit);assert.equal(records.get(id).questions.find(q=>q.id===regionId).notebookStatus,'wrong');
await enableRegion();await drag();
await ui.el('#pdfViewerDialog').dispatch('keydown',{key:'Escape',preventDefault(){}});assert.equal(ui.el('#pdfRegionReview').hidden,true);assert.equal(ui.el('#pdfRegionMode')['aria-pressed'],'false');
await enableRegion();await drag();await ui.el('#pdfPageNext').onclick();assert.equal(ui.el('#pdfRegionReview').hidden,true,'Changing page cancels stale selection');
await ui.library.openRecord(id,regionId);await enableRegion();
let resolveText;pendingText=new Promise(resolve=>resolveText=resolve);
const pendingDrag=drag();await Promise.resolve();await Promise.resolve();ui.el('#pdfCancelRegion').onclick();resolveText({items:[]});await pendingDrag;pendingText=null;
assert.equal(ui.el('#pdfRegionReview').hidden,true,'Late text results must not revive cancelled selection');
await drag({x:.9,y:.6},{x:.99,y:.9});assert(ui.el('#pdfRegionReason').textContent.includes('没有可提取文字'));
ui.el('#pdfRegionText').value='Explain wavelength';ui.el('#pdfRegionSuggest').onclick();assert.equal(ui.el('#pdfRegionType').value,'explanation');assert(ui.el('#pdfRegionChapters').innerHTML.includes('physics-waves" selected'));
ui.el('#pdfCancelRegion').onclick();
ui.el('#pdfPageFrame').onpointerdown(pointer(.05,.15));ui.el('#pdfPageFrame').onpointermove(pointer(.3,.3));ui.el('#pdfPageFrame').onpointercancel();assert.equal(ui.el('#pdfRegionBox').hidden,true);
await drag({x:.1,y:.1},{x:.101,y:.101});assert.equal(ui.el('#pdfRegionReview').hidden,true);assert(ui.el('#pdfRegionStatus').textContent.includes('太小'));
console.log('PDF rectangle pointer events, inferred/editable categories, cancellation, stale work, exact region persistence and notebook saving passed.');
const first=[...records.values()][0];
const target={dataset:{removePdf:first.id},closest:selector=>selector==='[data-remove-pdf]'?target:null};
await ui.el('#pdfHistoryList').onclick({target});assert.equal(records.size,1);
console.log('PDF UI import, direct reading, classification edits, reimport/reopen persistence, owner isolation and deletion passed.');

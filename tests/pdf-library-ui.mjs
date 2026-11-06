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
let destroyed=0,imported=0;
async function loadDocument(){return {numPages:2,async getPage(page){return {getViewport:()=>({width:600,height:800,convertToViewportPoint:(x,y)=>[x,800-y]}),async getTextContent(){return {items:[{str:page===1?'1. Calculate the force and acceleration.':'2. Explain the wavelength.',transform:[1,0,0,12,60,600],height:12}]};},cleanup(){},render:()=>({promise:Promise.resolve(),cancel(){}})};},async destroy(){destroyed++;}};}
function setup(name='Student Alice'){
 const elements=new Map();
 function el(selector){
  if(!elements.has(selector)){
   const classes=new Set(['hidden']),events=new Map();
   const element={value:'',innerHTML:'',textContent:'',disabled:false,clientWidth:800,style:{},selectedOptions:[],open:false,
    classList:{toggle(name,value){value?classes.add(name):classes.delete(name);},contains:name=>classes.has(name)},
    addEventListener(type,handler){events.set(type,handler);},showModal(){this.open=true;},close(){this.open=false;return events.get('close')?.();},click(){},focus(){},getContext:()=>({}),scrollIntoView(){}};
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
await ui.el('#pdfSaveQuestion').onclick();
assert([...records.values()][0].questions[0].reviewed);assert.equal([...records.values()][0].questions[0].label,'My force question');
await ui.library.importFiles([file]);assert.equal(records.size,1);assert.equal([...records.values()][0].questions[0].label,'My force question','Reimport must preserve manual classifications');
await ui.el('#pdfViewerDialog').close();
ui=setup();await ui.library.renderHistory();assert(ui.el('#pdfHistoryList').innerHTML.includes('physics-practice'));
const id=[...records.keys()][0];await ui.library.openRecord(id);assert(ui.el('#pdfQuestionList').innerHTML.includes('My force question'));
await ui.el('#pdfAddQuestion').onclick();assert.equal([...records.values()][0].questions.length,3);
await ui.el('#pdfDeleteQuestion').onclick();assert.equal([...records.values()][0].questions.length,2);
const bob=setup('Student Bob');await bob.library.renderHistory();assert(!bob.el('#pdfHistoryList').innerHTML.includes('physics-practice'));
await bob.library.openRecord(id);assert(messages.at(-1).includes('找不到'));
await ui.library.importFiles([new File(['not pdf'],'bad.pdf')]);assert.equal(records.size,1);assert(messages.some(message=>message.includes('有效的 PDF')));
await ui.library.importFiles([new File(['%PDF-1.7'],'second.pdf')]);assert.equal(records.size,2);
const first=[...records.values()][0];
const target={dataset:{removePdf:first.id},closest:selector=>selector==='[data-remove-pdf]'?target:null};
await ui.el('#pdfHistoryList').onclick({target});assert.equal(records.size,1);
console.log('PDF UI import, direct reading, classification edits, reimport/reopen persistence, owner isolation and deletion passed.');

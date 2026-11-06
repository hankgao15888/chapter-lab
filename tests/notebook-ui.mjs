import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),model=require('../docs/notebook-state.js');
const catalog=JSON.parse(fs.readFileSync(new URL('../data/catalog.json',import.meta.url),'utf8'));
const physics=catalog.questions.filter(q=>q.subject==='physics').slice(0,3);
const chemistry=catalog.questions.find(q=>q.subject==='chemistry');
function app(storage){
 const elements=new Map(),clicks=[];
 function element(selector){
  if(!elements.has(selector)){
   const classes=new Set();
   const el={value:'',checked:false,innerHTML:'',textContent:'',dataset:{},style:{},attributes:{},disabled:false,open:false,
    classList:{toggle(name,enabled){if(enabled===undefined)enabled=!classes.has(name);enabled?classes.add(name):classes.delete(name);},add(...names){names.forEach(name=>classes.add(name));},remove(...names){names.forEach(name=>classes.delete(name));},contains:name=>classes.has(name)},
    setAttribute(name,value){this.attributes[name]=value;},querySelectorAll(){return [];},querySelector:element,scrollIntoView(){},showModal(){this.open=true;},close(){this.open=false;},addEventListener(){}};
   elements.set(selector,el);
  }
  return elements.get(selector);
 }
 const tabs=['wrong','correct'].map(status=>{const el=element('tab-'+status);el.dataset.notebookStatus=status;return el;});
 const document={body:element('body'),querySelector:element,querySelectorAll(selector){return selector==='[data-notebook-status]'?tabs:[];},addEventListener(type,handler){if(type==='click')clicks.push(handler);}};
 const db={...catalog,questions:[...physics,chemistry],subjectIndex:{}};
 const context=vm.createContext({document,DB:db,console,Map,Set,URL,Blob,
  localStorage:{getItem:key=>storage[key]||null,setItem:(key,value)=>storage[key]=value},
  ChapterLabNotebook:model,ChapterLabAuth:{isAuthenticated:()=>true},
  ChapterLabPDFLibrary:{create:()=>({renderHistory(){}})},
  ChapterLabCatalogLoader:{createCatalog:()=>({isLoaded:()=>true,loadMany:async subjects=>subjects.map(subject=>db.questions.filter(q=>q.subject===subject))})},
  ChapterLabCatalog:{availableYears:()=>[2026]},ChapterLabSelection:{selectPaper:()=>null},
  ChapterLabAnswers:{create:()=>({content:()=>'',state:()=>({}),load:async()=>{}})},
  ChapterLabQuestions:{subscribe(){},state:()=>({}),load:async()=>{}},
  setTimeout:()=>0,clearTimeout(){},addEventListener(){}});
 context.window=context;
 vm.runInContext(fs.readFileSync(new URL('../docs/app.js',import.meta.url),'utf8'),context);
 function click(dataset,selector){const target={dataset,closest:query=>query===selector?target:null};return {target};}
 return {element,async settle(){await Promise.resolve();await Promise.resolve();},home(){vm.runInContext("switchView('notebook')",context);},subject(subject){element('#notebookSubjects').onclick(click({notebookSubject:subject},'[data-notebook-subject]'));},tab(status){element('#notebookStatusTabs').onclick(click({notebookStatus:status},'[data-notebook-status]'));},result(id,status){const event=click({questionId:id,notebookResult:status},'[data-notebook-result]');clicks.forEach(handler=>handler(event));}};
}
const storage={'chapterlab-v1':JSON.stringify({practice:{[physics[0].id]:'wrong',[physics[1].id]:'wrong',[physics[2].id]:'correct',[chemistry.id]:'wrong'},overrides:{},papers:[]})};
let ui=app(storage);await ui.settle();ui.home();
assert.equal((ui.element('#notebookSubjects').innerHTML.match(/data-notebook-subject=/g)||[]).length,6);
assert.equal(ui.element('#notebookTotal').textContent,'4');
ui.subject('physics');await ui.settle();
assert.equal(ui.element('#notebookPendingCount').textContent,'2');
assert.equal(ui.element('#notebookMasteredCount').textContent,'1');
assert(ui.element('#notebookList').innerHTML.includes(physics[0].id));
assert(!ui.element('#notebookList').innerHTML.includes(chemistry.id));
ui.result(physics[0].id,'correct');
assert(!ui.element('#notebookList').innerHTML.includes(physics[0].id));
assert.equal(ui.element('#notebookPendingCount').textContent,'1');
ui.tab('correct');
assert.equal(ui.element('#notebookMasteredCount').textContent,'2');
assert(ui.element('#notebookList').innerHTML.includes(physics[0].id));
assert(ui.element('#notebookList').innerHTML.includes('仍需复习'));
assert.equal(ui.element('#notebookPractice').disabled,true);
ui=app(storage);await ui.settle();ui.home();ui.subject('physics');await ui.settle();ui.tab('correct');
assert(ui.element('#notebookList').innerHTML.includes(physics[0].id),'Mastered questions survive refresh');
ui.result(physics[0].id,'wrong');ui.tab('wrong');
assert.equal(ui.element('#notebookPendingCount').textContent,'2');
ui.element('#notebookBack').onclick();ui.subject('chemistry');await ui.settle();
assert.equal(ui.element('#notebookPendingCount').textContent,'1');
assert(ui.element('#notebookList').innerHTML.includes(chemistry.id));
assert(!ui.element('#notebookList').innerHTML.includes(physics[0].id));
ui.element('#notebookBack').onclick();ui.subject('biology');await ui.settle();
assert.equal(ui.element('#notebookPendingCount').textContent,'0');
assert(ui.element('#notebookList').innerHTML.includes('暂时没有待掌握'));
ui.home();assert.equal((ui.element('#notebookSubjects').innerHTML.match(/data-notebook-subject=/g)||[]).length,6);
console.log('Notebook app events: subject home, isolated lists, mark/revisit, refresh persistence and empty subjects passed.');

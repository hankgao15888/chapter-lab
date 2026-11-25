import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const assistant=createRequire(import.meta.url)('../docs/study-assistant.js');
const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
const catalog=JSON.parse(read('../data/catalog.json'));
const manifest=JSON.parse(read('../docs/data.js').trim().slice('window.DB='.length,-1));
const lookup=JSON.parse(read('../docs/'+manifest.questionLookup));
const total=Object.values(lookup).reduce((count,questions)=>count+questions.length,0);
assert.equal(total,catalog.questions.length);
const expected=new Map();
for(const question of catalog.questions){
 if(!expected.has(question.paperId))expected.set(question.paperId,[]);
 expected.get(question.paperId).push(question.number);
}
assert.deepEqual(lookup,Object.fromEntries(expected),'Every catalog question must be searchable with its original number');
const search=(input,subject='')=>assistant.searchPapers(manifest.papers,lookup,assistant.parseLookup(input),subject);
const broad=search('CIE 2024 Q3');
assert(broad.hits.length>20);
assert(broad.hits.every(({paper,number})=>paper.year===2024&&paper.board==='cie-international'&&number===3));
for(const [query,id] of [
 ['剑桥 2024年6月 9702/42 Q3(b)','cie-international-physics-2024_06_42'],
 ['CIE 9702/42/M/J/24 Q3','cie-international-physics-2024_06_42'],
 ['9702_qp_s24_42 Q3','cie-international-physics-2024_06_42'],
 ['Edexcel 2024年6月 WPH11/01 第3题','edexcel-ial-physics-2024-06-WPH11-01'],
 ['牛津AQA 2024-06-PH01 第３题','oxford-aqa-international-physics-2024-06-PH01']
])assert.deepEqual(search(query).hits.map(hit=>hit.paper.id),[id],query);
const alternatives=search('CIE 9231/13/O/N/19 Q11');
assert.deepEqual(alternatives.hits.map(hit=>hit.number).sort(),['11 EITHER','11 OR']);
assert.deepEqual(search('CIE 9231/13/O/N/19 Q11 OR').hits.map(hit=>hit.number),['11 OR']);
assert.equal(search('CIE 2024 Q999').hits.length,0);
assert(search('Edexcel 2024 3','chemistry').hits.every(hit=>hit.paper.subject==='chemistry'));
assert.equal(assistant.parseLookup('CIE 2024 42').number,42);
assert.equal(assistant.parseLookup('CIE 2024 Paper 42').number,null);
const uncropped=manifest.papers.find(paper=>!Object.hasOwn(lookup,paper.id));
if(uncropped)assert(assistant.searchPapers([uncropped],lookup,{board:uncropped.board,year:uncropped.year,number:3},uncropped.subject).unindexed.includes(uncropped));
assert.deepEqual(assistant.moveWithinViewport(-40,840,120,46,390,780),{x:8,y:726});
console.log(`Study Assistant lookup verified for ${total} questions, three boards, repeated question numbers, exact variants, optional questions and viewport bounds.`);

// Drive picture changes through the mounted controls and a browser-like image decoder.
const storage=new Map();
const pngUrl='data:image/png;base64,iVBORw0KGgo=';
const gifUrl='data:image/gif;base64,R0lGODlh';
const sized=[];
let decodeFails=false,storageFails=false;
function petUI(owner){
 const controls=new Map();
 function element(id){
  if(!controls.has(id))controls.set(id,{hidden:id==='assistantPetPicture'||id==='assistantResetPet',style:{},
   classList:{add(){},remove(){}},append(){},addEventListener(){},setAttribute(){},focus(){},removeAttribute(name){delete this[name];}});
  return controls.get(id);
 }
 const context=vm.createContext({
  document:{getElementById:element,createElement(tag){
   if(tag==='canvas')return {getContext:()=>({drawImage(...args){sized.push(args.slice(3));}}),toDataURL:()=>pngUrl};
   return {};
  }},
  Image:class{naturalWidth=800;naturalHeight=400;async decode(){if(decodeFails)throw Error('Invalid bitmap');}},
  FileReader:class{readAsDataURL(){this.result=gifUrl;this.onload();}},
  localStorage:{getItem:key=>storage.get(key),setItem(key,value){if(storageFails)throw Error('quota');storage.set(key,value);},removeItem:key=>storage.delete(key)},
  URL,Blob,addEventListener(){}
 });
 vm.runInContext(read('../docs/study-assistant.js'),context);
 context.ChapterLabAssistant.mount({owner,subjectNames:{},boardNames:{},papers:[]});
 const picker=element('assistantPetFile');
 return {element,async choose(file){picker.files=[file];await picker.onchange();}};
}
const png=new File([Buffer.from('iVBORw0KGgo=','base64')],'pet.png',{type:'image/png'});
const gif=new File(['GIF89a'],'pet.gif',{type:'image/gif'});
const alpha=petUI('alpha');
await alpha.choose(png);
assert.equal(alpha.element('assistantPetPicture').src,pngUrl);
assert.equal(alpha.element('assistantDefaultPet').hidden,true);
assert.deepEqual(sized.at(-1),[256,128]);
assert.equal(petUI('alpha').element('assistantPetPicture').src,pngUrl);
assert.equal(petUI('beta').element('assistantPetPicture').hidden,true);
await alpha.choose(new File(['<svg/>'],'not-a-pet.png',{type:'image/png'}));
assert.equal(alpha.element('assistantPetPicture').src,pngUrl);
assert.match(alpha.element('assistantPetStatus').textContent,/请选择/);
decodeFails=true;
await alpha.choose(gif);
assert.equal(alpha.element('assistantPetPicture').src,pngUrl);
assert.match(alpha.element('assistantPetStatus').textContent,/无法读取/);
decodeFails=false;
storageFails=true;
await alpha.choose(gif);
assert.equal(alpha.element('assistantPetPicture').src,pngUrl);
assert.match(alpha.element('assistantPetStatus').textContent,/无法保存/);
storageFails=false;
await alpha.choose(gif);
assert.equal(petUI('alpha').element('assistantPetPicture').src,gifUrl,'GIF bytes are kept for animation');
alpha.element('assistantResetPet').onclick();
assert.equal(alpha.element('assistantDefaultPet').hidden,false);
assert.equal(petUI('alpha').element('assistantPetPicture').hidden,true);
assert.equal(assistant.petImageType(Uint8Array.from([255,216,255,0])),'jpeg');
assert.equal(assistant.petImageType(Buffer.from('RIFF0000WEBP')),'webp');
console.log('Pet imports resize with the original proportions, preserve GIF animation, restore per account, and leave the prior appearance intact on failure.');

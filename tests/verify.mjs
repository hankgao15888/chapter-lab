import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {selectPaper}=require('../docs/selection.js');
const db=JSON.parse(fs.readFileSync(new URL('../data/catalog.json',import.meta.url),'utf8'));
const questions=db.questions,questionMap=new Map(questions.map(q=>[q.id,q]));
const chapters=new Map(db.chapters.map(c=>[c.id,c]));
assert.equal(questionMap.size,questions.length,'Question IDs must be unique');
assert.equal(chapters.size,db.chapters.length,'Chapter IDs must be unique');
const papers=new Map();
for(const q of questions){
 assert.equal(q.images.length,0,'Third-party question images must not be bundled publicly');
 assert(q.parts.length>0);
 assert(q.chapters.every(id=>chapters.get(id)?.subject===q.subject));
 assert(Number.isInteger(q.marks)&&q.marks>0);
 for(const p of q.parts)assert(p.page>0&&p.box[2]>p.box[0]&&p.box[3]>p.box[1]);
 if(!papers.has(q.paperId))papers.set(q.paperId,[]);
 papers.get(q.paperId).push(q);
}
for(const [id,rows] of papers){
 const q=rows[0];let expected;
 if(q.board==='oxford-aqa-international')expected=/Unit (P2|FP2)$/.test(q.sourceUnit)?120:80;
 else if(q.board==='cie-international'){
  const n=Number(q.sourceUnit.match(/\d+/)[0]);
  expected=q.subject==='physics'?{1:40,2:60,3:40,4:100,5:30}[n]:q.subject==='mathematics'?([1,3].includes(n)?75:50):([1,2].includes(n)?75:50);
 }else{
  const n=Number(q.sourceUnit.match(/\d+/)?.[0]);
  expected=q.subject==='physics'?{1:80,2:80,3:50,4:90,5:90,6:50}[n]:75;
 }
 assert.equal(rows.reduce((s,q)=>s+q.marks,0),expected,`${id}: split marks must equal the exam total`);
}
let selectionChecks=0;
for(const subject of ['physics','mathematics','furthermathematics'])
 for(const board of ['','oxford-aqa-international','cie-international','edexcel-ial'])
  for(const target of [30,60,100])
   for(const recipe of ['balanced','foundation','challenge']){
    const pool=questions.filter(q=>q.subject===subject&&q.chapters.length&&(!board||q.board===board));
    const result=selectPaper(pool,target,recipe,true);
    if(!result)continue;
    assert.equal(new Set(result.ids).size,result.ids.length,'No duplicate question');
    assert(result.ids.every(id=>pool.some(q=>q.id===id)),'Only select from the candidate pool');
    assert.equal(result.achieved,result.ids.reduce((s,id)=>s+questionMap.get(id).marks,0));
    assert(result.achieved<=target,'Do not exceed the requested score');
    if(recipe==='foundation')assert(result.ids.every(id=>questionMap.get(id).difficulty!=='challenge'));
    if(recipe==='challenge')assert(result.ids.every(id=>questionMap.get(id).difficulty!=='foundation'));
    selectionChecks++;
   }
assert.equal(selectPaper([],60,'balanced',false),null);
const constrained=questions.filter(q=>q.subject==='physics'&&q.chapters.includes('physics-3.2'));
const result=selectPaper(constrained,40,'balanced',true,{chapters:new Set(['physics-3.2'])});
assert(result&&result.achieved<=40&&result.ids.every(id=>questionMap.get(id).chapters.includes('physics-3.2')));
const html=fs.readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');
for(const src of [...html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css)(?:\?[^"#]*)?)"/g)].map(m=>m[1].split('?')[0])){
 assert(fs.existsSync(new URL('../docs/'+src,import.meta.url)),`Missing static asset ${src}`);
}
console.log(JSON.stringify({questions:questions.length,chapters:chapters.size,examTotalChecks:papers.size,selectionChecks,chapterConstrainedScore:result.achieved},null,2));

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
const coverage=JSON.parse(fs.readFileSync(new URL('../docs/coverage.json',import.meta.url),'utf8'));
const audits=new Map(coverage.papers.map(p=>[p.id,p]));
for(const q of questions){
 assert.equal(q.images.length,0,'Third-party question images must not be bundled publicly');
 assert(q.parts.length>0);
 assert(q.chapters.every(id=>chapters.get(id)?.subject===q.subject));
 assert(Number.isInteger(q.marks)&&q.marks>0);
 if(q.autoSelectable===false){assert.equal(q.materialStatus,'unavailable');assert(q.materialNote);}
 if(q.contextPartsCount){
  assert(q.contextKey&&q.contextPartsCount<q.parts.length);
  assert(q.parts.slice(0,q.contextPartsCount).every(part=>part.role==='source'));
  assert(q.parts.slice(q.contextPartsCount).every(part=>part.role!=='source'));
 }
 for(const p of q.parts)assert(p.page>0&&p.box[2]>p.box[0]&&p.box[3]>p.box[1]);
 if(!papers.has(q.paperId))papers.set(q.paperId,[]);
 papers.get(q.paperId).push(q);
}
for(const [id,rows] of papers){
 const audit=audits.get(id);
 assert(audit&&audit.issues.length===0,`${id}: requires a completed source audit`);
 assert.equal(rows.length,audit.questionCount);
 const marks=rows.reduce((s,q)=>s+q.marks,0);
 assert.equal(marks,audit.actualMarks);
 assert.equal(marks-(audit.choiceAdjustment||0),audit.expectedMarks,`${id}: split marks must equal the exam total after optional alternatives`);
 const groups=new Map();
 for(const q of rows.filter(q=>q.alternativeGroup)){
  if(!groups.has(q.alternativeGroup))groups.set(q.alternativeGroup,[]);
  groups.get(q.alternativeGroup).push(q);
 }
 for(const alternatives of groups.values()){
  assert.equal(alternatives.length,2);
  assert.equal(alternatives[0].marks,alternatives[1].marks);
  assert.notDeepEqual(alternatives[0].parts,alternatives[1].parts);
 }
 for(const rule of audit.choiceRules||[]){
  assert(rule.required>0&&rule.required<rule.options.length);
  assert(rule.options.every(id=>questionMap.get(id)?.choiceGroup===rule.id));
  assert(rule.options.every(id=>questionMap.get(id).marks===rule.marksPerOption));
 }
}
assert.equal(papers.size,db.importedPapers.length);
assert.equal(coverage.sourcePaperCount,db.papers.length);
assert.equal(coverage.importedPaperCount,papers.size);
assert.equal(coverage.questionCount,questions.length);
assert.equal(coverage.unavailable.length,0);
assert.equal(coverage.complete,true,'Only publish a complete source audit');
assert.equal(coverage.materialIncompleteQuestions,questions.filter(q=>q.autoSelectable===false).length);
let selectionChecks=0;
for(const subject of [...new Set(db.chapters.map(c=>c.subject))])
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
assert.equal(selectPaper([{id:'incomplete',marks:20,difficulty:'challenge',chapters:[],autoSelectable:false}],20,'challenge',false),null,'Missing reading materials must not enter a generated paper');
const constrained=questions.filter(q=>q.subject==='physics'&&q.chapters.includes('physics-3.2'));
const result=selectPaper(constrained,40,'balanced',true,{chapters:new Set(['physics-3.2'])});
assert(result&&result.achieved<=40&&result.ids.every(id=>questionMap.get(id).chapters.includes('physics-3.2')));
const html=fs.readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');
for(const src of [...html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css)(?:\?[^"#]*)?)"/g)].map(m=>m[1].split('?')[0])){
 assert(fs.existsSync(new URL('../docs/'+src,import.meta.url)),`Missing static asset ${src}`);
}
console.log(JSON.stringify({questions:questions.length,chapters:chapters.size,examTotalChecks:papers.size,selectionChecks,chapterConstrainedScore:result.achieved},null,2));

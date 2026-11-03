import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{create}=require('../docs/answers.js');
const q1={id:'p-Q1',paperId:'p',title:'sample',number:1},q2={...q1,id:'p-Q2',number:2};
const questions=new Map([[q1.id,q1],[q2.id,q2]]),box={page:2,box:[20,60,550,150]};
let reads=0,renders=0;
const api=create({getQuestion:id=>questions.get(id),fetcher:async()=>{reads++;return {ok:true,json:async()=>({paperId:'p',ms:'https://example.com/answers.pdf',questions:{[q1.id]:{parts:[box]},[q2.id]:{parts:[box],option:'B'}}})};},renderer:{async load(q){renders++;assert.equal(q.qp,'https://example.com/answers.pdf');assert(q.parts.every(p=>p.exact));q.images=['blob:test'];}}});
const first=api.load(q1);assert.equal(api.load(q1),first,'Coalesce duplicate answer requests');
await Promise.all([first,api.load(q2)]);
assert.equal(reads,1,'Questions in the same paper share the answer index');assert.equal(renders,2);
assert.equal(api.state(q1.id).status,'ready');assert.equal(api.state(q2.id).option,'B');
assert(api.content(q2).includes('正确选项'));await api.load(q1);assert.equal(renders,2,'Reuse rendered answers');
let attempts=0;
const retry=create({getQuestion:()=>q1,fetcher:async()=>({ok:++attempts>1,json:async()=>({paperId:'p',ms:'https://example.com/ms.pdf',questions:{[q1.id]:{unavailable:true,note:'官方原文件缺少本题答案。'}}})})});
await assert.rejects(retry.load(q1));assert.equal(retry.state(q1.id).status,'error');
await retry.load(q1);assert.equal(retry.state(q1.id).status,'unavailable');assert(retry.content(q1).includes('未公开'));
const invalid=create({getQuestion:()=>q1,fetcher:async()=>({ok:true,json:async()=>({paperId:'wrong',ms:'https://example.com/ms.pdf',questions:{}})})});
await assert.rejects(invalid.load(q1));
const key=create({getQuestion:()=>q1,fetcher:async()=>({ok:true,json:async()=>({paperId:'p',ms:'https://example.com/ms.pdf',questions:{[q1.id]:{parts:[box],keyPoints:['x=2 < 3'],note:'Official key points'}}})}),renderer:{load(){throw Error('Curated answer keys must not require cross-origin PDF fetching');}}});
await key.load(q1);assert.equal(key.state(q1.id).status,'ready');assert.deepEqual(key.state(q1.id).keyPoints,['x=2 < 3']);assert(key.content(q1).includes('x=2 &lt; 3'));
const db=JSON.parse(fs.readFileSync(new URL('../data/catalog.json',import.meta.url),'utf8'));
const answers=JSON.parse(fs.readFileSync(new URL('../data/answers.json',import.meta.url),'utf8'));
assert(answers.coverage.complete,'Answer coverage must have a completed source audit');
const indexed=new Map(answers.papers.map(p=>[p.paperId,p]));let regions=0;
for(const q of db.questions){
 const paper=indexed.get(q.paperId),answer=paper?.questions[q.id];assert(answer,q.id);
 if(answer.unavailable){assert(answer.note);continue;}
 assert(answer.parts.length>0,q.id);
 if(answer.option)assert(/^[ABCD]$/.test(answer.option));
 for(const part of answer.parts){
  assert(Number.isInteger(part.page)&&part.page>0);assert(part.box.every(Number.isFinite));
  assert(part.box[0]>=0&&part.box[1]>=0&&part.box[2]<=part.pageWidth+1&&part.box[3]<=part.pageHeight+1,q.id);
  assert(part.box[2]>part.box[0]&&part.box[3]>part.box[1],q.id);regions++;
 }
}
assert.equal(indexed.size,db.papers.length);
assert.equal(answers.coverage.questionCount,db.questions.length);
console.log(JSON.stringify({answerQuestions:db.questions.length,answerRegions:regions,sourceLimitations:answers.coverage.unavailable.length,cacheAndRetry:'passed'}));

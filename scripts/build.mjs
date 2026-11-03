import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const db=JSON.parse(fs.readFileSync(path.join(root,'data/catalog.json'),'utf8'));
assert.equal(db.distribution,'public-index');
assert(Array.isArray(db.questions)&&Array.isArray(db.chapters)&&Array.isArray(db.papers));
for(const q of db.questions){
 assert.equal(q.images.length,0,'Public catalog must not bundle exam images');
 assert(q.text.endsWith('原题将在查看或组卷时自动显示。'),'Public descriptions must be metadata summaries');
 for(const link of [q.qp,q.ms,q.source,q.renderQp].filter(Boolean))assert.equal(new URL(link).protocol,'https:');
 for(const part of q.parts)if(part.qp)assert.equal(new URL(part.qp).protocol,'https:');
}
const catalogDirectory=path.join(root,'docs/catalog');
fs.mkdirSync(catalogDirectory,{recursive:true});
const manifest={...db,questions:[],subjectIndex:{}};
const outputs=new Set();
for(const subject of new Set(db.chapters.map(c=>c.subject))){
 const rows=db.questions.filter(q=>q.subject===subject),json=JSON.stringify(rows);
 const hash=crypto.createHash('sha256').update(json).digest('hex').slice(0,12);
 const file=`${subject}-${hash}.json`;outputs.add(file);
 fs.writeFileSync(path.join(catalogDirectory,file),json);
 const chapterCounts={};for(const q of rows)for(const chapter of q.chapters)chapterCounts[chapter]=(chapterCounts[chapter]||0)+1;
 const byBoard={};
 for(const board of new Set(db.papers.map(p=>p.board))){
  const questions=rows.filter(q=>q.board===board);
  byBoard[board]={count:questions.length,paperCount:new Set(questions.map(q=>q.paperId)).size,years:[...new Set(questions.map(q=>q.year))].sort((a,b)=>b-a)};
 }
 manifest.subjectIndex[subject]={path:'catalog/'+file,count:rows.length,paperCount:new Set(rows.map(q=>q.paperId)).size,chapterCounts,byBoard};
}
for(const file of fs.readdirSync(catalogDirectory))if(/^[a-z]+-[a-f0-9]{12}\.json$/.test(file)&&!outputs.has(file))fs.unlinkSync(path.join(catalogDirectory,file));
manifest.coverage={...db.coverage,questionCount:db.questions.length,unmappedQuestionCount:db.questions.filter(q=>!q.chapters.length).length,chaptersCovered:new Set(db.questions.flatMap(q=>q.chapters)).size};
fs.writeFileSync(path.join(root,'docs/data.js'),'window.DB='+JSON.stringify(manifest)+';');
console.log(`Built public index: ${db.questions.length} questions, ${db.chapters.length} classifications.`);

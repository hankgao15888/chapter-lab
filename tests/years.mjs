import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {availableYears}=require('../docs/catalog-utils.js');
const {selectPaper,balancedCandidates}=require('../docs/selection.js');
const db=JSON.parse(fs.readFileSync(new URL('../data/catalog.json',import.meta.url),'utf8'));
for(const [board,start] of [['oxford-aqa-international',2018],['cie-international',2015],['edexcel-ial',2019]]){
 const rows=db.questions.filter(q=>q.board===board);
 assert.equal(Math.min(...rows.map(q=>q.year)),start);
 assert.equal(Math.max(...rows.map(q=>q.year)),2026);
 for(const subject of ['physics','mathematics','furthermathematics']){
  const years=availableYears(db.questions,subject,[board]);
  assert.deepEqual(years,[...new Set(rows.filter(q=>q.subject===subject).map(q=>q.year))].sort((a,b)=>b-a));
  for(const year of years){
   const pool=rows.filter(q=>q.subject===subject&&q.year===year&&q.chapters.length);
   const result=selectPaper(pool,30,'balanced',true,{trials:1});
   assert(result,`${board} ${subject} ${year} should support paper generation`);
   assert(result.ids.every(id=>pool.some(q=>q.id===id)));
  }
 }
}
assert.deepEqual(availableYears(db.questions,'physics',[]),[]);
// A large bank must retain every board/year bucket in its bounded candidate pool.
const sampled=balancedCandidates(db.questions,1200,q=>q.chapters);
assert.equal(sampled.length,1200);
for(const q of db.questions)assert(sampled.some(item=>item.board===q.board&&item.year===q.year));
// Even when the sample is too small to contain a valid recipe, retry the full pool.
const fallback=selectPaper([
 {id:'short',marks:4,difficulty:'foundation',board:'a',year:2020,chapters:[]},
 {id:'needed',marks:12,difficulty:'challenge',board:'b',year:2021,chapters:[]}
],12,'challenge',false,{candidateLimit:1,trials:1});
assert.equal(fallback.achieved,12);
const started=performance.now();
for(const subject of ['physics','mathematics','furthermathematics']){
 const result=selectPaper(db.questions.filter(q=>q.subject===subject&&q.chapters.length),300,'balanced',true);
 assert.equal(result.achieved,300);
}
console.log(JSON.stringify({yearRange:[2015,2026],largePoolQuestions:db.questions.length,largePoolSelectionMs:Math.round(performance.now()-started)}));

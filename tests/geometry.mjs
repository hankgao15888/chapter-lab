import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {cropGeometry,expandPageStart}=require('../docs/question-geometry.js');
const db=JSON.parse(fs.readFileSync(new URL('../data/catalog.json',import.meta.url),'utf8'));
assert.deepEqual(cropGeometry([35,50,544,250],595.3,841.9,2),{width:1018,height:400,transform:[1,0,0,1,-70,-100]});
assert.deepEqual(cropGeometry([-5,-10,650,900],595,842,1),{width:595,height:842,transform:[1,0,0,1,-0,-0]});
for(const box of [[10,10,10,20],[30,20,10,40],[0,0,NaN,10],[0,0,1]])assert.throws(()=>cropGeometry(box,595,842));
assert.deepEqual(expandPageStart([35,70.4,544,786]),[35,45,544,786],'Keep a matrix row that sits above its question number');
assert.deepEqual(expandPageStart([63,86,572,815]),[63,73,572,815],'Keep the extra margin of padded Edexcel pages');
assert.deepEqual(expandPageStart([35,320,544,500]),[35,320,544,500],'Do not include the previous question in a mid-page crop');
let checked=0;
for(const q of db.questions)for(const part of q.parts){
 const geometry=cropGeometry(part.box,700,950);
 assert(geometry.width>0&&geometry.height>0&&geometry.width<=1225&&geometry.height<=1663,q.id);
 assert.equal(geometry.transform[4],-Math.max(0,part.box[0])*1.75);
 assert.equal(geometry.transform[5],-Math.max(0,part.box[1])*1.75);
 checked++;
}
for(const q of db.questions.filter(q=>q.sharedContext)){
 const related=db.questions.filter(other=>other.paperId===q.paperId&&other.sharedContext===q.sharedContext);
 assert(related.length>=2);
 assert(related.every(other=>JSON.stringify(other.parts[0])===JSON.stringify(q.parts[0])),'Dependent questions must receive the same shared introduction');
}
for(const file of ['pdf.min.mjs','pdf.worker.min.mjs','LICENSE','VERSION'])assert(fs.existsSync(new URL('../docs/vendor/pdfjs/'+file,import.meta.url)),file);
console.log(JSON.stringify({cropRegions:checked,sharedContextQuestions:db.questions.filter(q=>q.sharedContext).length,pdfjs:fs.readFileSync(new URL('../docs/vendor/pdfjs/VERSION',import.meta.url),'utf8').trim()},null,2));

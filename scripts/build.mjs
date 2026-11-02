import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const db=JSON.parse(fs.readFileSync(path.join(root,'data/catalog.json'),'utf8'));
assert.equal(db.distribution,'public-index');
assert(Array.isArray(db.questions)&&Array.isArray(db.chapters)&&Array.isArray(db.papers));
for(const q of db.questions){
 assert.equal(q.images.length,0,'Public catalog must not bundle exam images');
 assert(q.text.endsWith('原题将在查看或组卷时自动显示。'),'Public descriptions must be metadata summaries');
 for(const link of [q.qp,q.ms,q.source].filter(Boolean))assert.equal(new URL(link).protocol,'https:');
}
fs.writeFileSync(path.join(root,'docs/data.js'),'window.DB='+JSON.stringify(db)+';');
console.log(`Built public index: ${db.questions.length} questions, ${db.chapters.length} classifications.`);

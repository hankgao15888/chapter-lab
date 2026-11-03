import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createCatalog}=require('../docs/catalog-loader.js');
const context={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../docs/data.js',import.meta.url),'utf8'),context);
const db=context.window.DB;
assert.equal(db.questions.length,0,'Bootstrap must not load every subject');
let calls=0;
const catalog=createCatalog(db,async path=>{calls++;return {ok:true,json:async()=>JSON.parse(fs.readFileSync(new URL('../docs/'+path,import.meta.url),'utf8'))};});
const [first,second]=await Promise.all([catalog.load('physics'),catalog.load('physics')]);
assert.equal(first,second);assert.equal(calls,1,'Concurrent requests share one download');
assert(db.questions.every(q=>q.subject==='physics'));
assert.equal(db.questions.length,db.subjectIndex.physics.count);
await catalog.load('physics');assert.equal(calls,1,'Loaded subjects are reused');
await assert.rejects(catalog.load('invalid-subject'));
let attempts=0;
const retryDb={questions:[],subjectIndex:{chemistry:{count:1,path:'chemistry.json'}}};
const retry=createCatalog(retryDb,async()=>({ok:true,json:async()=>++attempts===1?[{id:'wrong',subject:'biology'}]:[{id:'right',subject:'chemistry'}]}));
await assert.rejects(retry.load('chemistry'));
assert.equal(retryDb.questions.length,0,'Reject wrong-subject data before changing the bank');
assert.equal((await retry.load('chemistry'))[0].id,'right');
assert.equal(attempts,2,'Failed downloads can be retried');
for(const [subject,entry] of Object.entries(db.subjectIndex)){
 const rows=JSON.parse(fs.readFileSync(new URL('../docs/'+entry.path,import.meta.url),'utf8'));
 assert.equal(rows.length,entry.count);assert(rows.every(q=>q.subject===subject));
}
console.log(JSON.stringify({subjectShards:Object.keys(db.subjectIndex).length,bootstrapBytes:fs.statSync(new URL('../docs/data.js',import.meta.url)).size,cachedPhysicsQuestions:first.length}));

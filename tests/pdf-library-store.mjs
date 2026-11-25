import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {create}=createRequire(import.meta.url)('../docs/pdf-library-store.js');
// Transactional IndexedDB test double: requests are asynchronous, and aborted writes never commit.
function memoryIDB(){
 const databases=new Map();let failStore=null;
 return {failNextWrite(store){failStore=store;},open(name){
  const request={};queueMicrotask(()=>{
   const fresh=!databases.has(name),state=databases.get(name)||new Map();databases.set(name,state);
   const db={close(){},createObjectStore(name){state.set(name,new Map());return {createIndex(){}};},transaction(names,mode){
    const staged=new Map(names.map(name=>[name,new Map(state.get(name))]));let pending=0,aborted=false,finished=false;
    const tx={error:null,abort(){if(aborted||finished)return;aborted=true;queueMicrotask(()=>tx.onabort?.());},objectStore(name){
     const data=staged.get(name);
     function action(work,write=false){const req={};pending++;queueMicrotask(()=>{
      if(!aborted)try{if(write&&failStore===name){failStore=null;throw Object.assign(new Error('quota'),{name:'QuotaExceededError'});}req.result=work();req.onsuccess?.();}
      catch(error){tx.error=error;tx.abort();}
      pending--;setImmediate(finish);
     });return req;}
     return {get:key=>action(()=>structuredClone(data.get(key))),put:value=>action(()=>{data.set(value.id,structuredClone(value));return value.id;},true),delete:key=>action(()=>data.delete(key),true),index:()=>({getAll:owner=>action(()=>[...data.values()].filter(item=>item.owner===owner).map(value=>structuredClone(value)))})};
    }};
    function finish(){if(pending||aborted||finished)return;finished=true;if(mode==='readwrite')for(const [key,value] of staged)state.set(key,value);tx.oncomplete?.();}
    setImmediate(finish);return tx;
   }};
   request.result=db;if(fresh)request.onupgradeneeded?.();request.onsuccess?.();
  });return request;
 }};
}
const idb=memoryIDB(),alice=create(idb),blob=new Blob(['%PDF example'],{type:'application/pdf'});
const a={id:'alice:file',owner:'alice',createdAt:'2026-11-06T01:00:00Z',title:'One',questions:[]};
const b={id:'bob:file',owner:'bob',createdAt:'2026-11-06T02:00:00Z',title:'Two',questions:[]};
await alice.save(a,blob);await alice.save(b,blob);
assert.equal((await alice.list('alice')).length,1);
assert.equal((await alice.list('alice'))[0].blob,undefined,'Lists must not load every PDF blob');
assert.equal(await alice.get('bob',a.id),null);
assert.equal(await (await alice.get('alice',a.id)).blob.text(),'%PDF example');
await alice.update('alice',{...a,title:'Updated',questions:[{id:'q1'}]});
assert.equal((await alice.get('alice',a.id)).title,'Updated');
assert.equal(await (await alice.get('alice',a.id)).blob.text(),'%PDF example','Metadata edits preserve the original bytes');
await assert.rejects(alice.update('bob',{...a,title:'Wrong owner'}));
await assert.rejects(alice.remove('bob',a.id));
assert.equal((await create(idb).list('alice'))[0].title,'Updated','A fresh store instance can reopen persisted records');
idb.failNextWrite('files');await assert.rejects(alice.save({...a,id:'alice:quota'},blob),/空间不足/);
assert.equal(await alice.get('alice','alice:quota'),null,'Failed blob writes cannot leave a partial document');
const attachment={filename:'worked-answer.pdf',type:'application/pdf',blob:new Blob(['%PDF answer'])};
await alice.setAnswer('alice',a.id,'q1',attachment);
assert.equal(await (await create(idb).getAnswer('alice',a.id,'q1')).blob.text(),'%PDF answer');
assert.equal(await alice.getAnswer('bob',a.id,'q1'),null);
await assert.rejects(alice.setAnswer('bob',a.id,'q1',attachment));
await assert.rejects(alice.setAnswer('alice',a.id,'missing',attachment));
const replacement={...attachment,filename:'replacement.pdf'};
idb.failNextWrite('files');await assert.rejects(alice.setAnswer('alice',a.id,'q1',replacement),/空间不足/);
assert.equal((await alice.getAnswer('alice',a.id,'q1')).filename,attachment.filename);
const edited={...a,questions:[{id:'q1',label:'Changed question name'},{id:'q2'}]};
await alice.update('alice',edited);
assert.equal((await alice.getAnswer('alice',a.id,'q1')).filename,attachment.filename,'Metadata edits do not replace attachments');
await alice.setAnswer('alice',a.id,'q2',attachment);
await alice.update('alice',{...edited,questions:[{id:'q1'}]},{discardAnswers:['q1']});
await alice.update('alice',edited);
assert.equal(await alice.getAnswer('alice',a.id,'q1'),null,'Splitting drops the old attachment');
assert.equal(await alice.getAnswer('alice',a.id,'q2'),null,'Deleting a question removes its attachment bytes');
await alice.setAnswer('alice',a.id,'q1',attachment);
await alice.setAnswer('alice',a.id,'q1',null);
assert.equal(await alice.getAnswer('alice',a.id,'q1'),null);
await alice.setAnswer('alice',a.id,'q1',attachment);
await alice.remove('alice',a.id);
await alice.save(edited,blob);
assert.equal(await alice.getAnswer('alice',a.id,'q1'),null,'Deleting the PDF removes any attached answer');
await alice.setSyncDirectory('alice',{name:'我的坚果云',kind:'directory'});
assert.equal((await create(idb).getSyncDirectory('alice')).name,'我的坚果云');
assert.equal(await alice.getSyncDirectory('bob'),null);
await alice.setAnswer('alice',a.id,'q1',attachment);
const syncRecord=await alice.snapshot('alice',a.id);
assert.equal(await alice.snapshot('bob',a.id),null);
assert.equal(syncRecord.answers[0].filename,attachment.filename);
const copied={...syncRecord,metadata:{...syncRecord.metadata,id:'alice:copy'}};
idb.failNextWrite('files');await assert.rejects(alice.restore('alice',copied),/空间不足/);
assert.equal(await alice.get('alice','alice:copy'),null);
assert.equal(await alice.restore('alice',copied),true);
assert.equal(await alice.restore('alice',copied),false);
assert.equal(await (await alice.getAnswer('alice','alice:copy','q1')).blob.text(),'%PDF answer');
await alice.remove('alice','alice:copy');
await alice.remove('alice',a.id);assert.equal(await alice.get('alice',a.id),null);assert.equal((await alice.list('bob')).length,1);
console.log('PDF IndexedDB transaction contract: atomic bytes/metadata, durable reopen, owner checks, metadata edits and quota failure passed.');

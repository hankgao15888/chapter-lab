import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import worker, {SyncVault} from '../file-sync-service/worker.mjs';
const require=createRequire(import.meta.url),core=require('../docs/file-sync-core.js'),folderAPI=require('../docs/file-sync-folder.js');
const practiceModel=require('../docs/practice-sync.js');
const owner='b'.repeat(64),other='c'.repeat(64);
const code=core.newCode(),keys=await core.keys(code,owner);
assert(core.validCode(code));assert.notEqual(keys.vault,(await core.keys(code,other)).vault);
const pdf=new Blob(['%PDF-1.7 private original']);
const hash=Buffer.from(await crypto.subtle.digest('SHA-256',await pdf.arrayBuffer())).toString('hex');
const id=`${owner}:${hash}`;
const png=new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'});
const record={metadata:{id,owner,fingerprint:hash,title:'My private worksheet',filename:'my-paper.pdf',subject:'physics',pageCount:4,size:pdf.size,createdAt:'2026-11-25T10:00:00Z',questions:[{id:'q1',label:'Stitched question',text:'Worked example',type:'calculation',chapters:['physics-3.2'],savedAt:'2026-11-25T10:00:00Z',notebookStatus:'wrong',parts:[{page:1,left:.1,right:.9,top:.3,bottom:.6},{page:2,left:.2,right:.8,top:.1,bottom:.3}]}]},blob:pdf,answers:[{questionId:'q1',filename:'answer.png',type:'image/png',blob:png}]};
const packageBlob=await core.pack([record],owner,keys.key);
assert(!(await packageBlob.text()).includes('private original'));
assert(!(await packageBlob.text()).includes('My private worksheet'));
assert.notDeepEqual(await (await core.pack([record],owner,keys.key)).arrayBuffer(),await packageBlob.arrayBuffer(),'Encryption must use a new nonce');
const [ready]=await core.unpack(packageBlob,owner,keys.key);
assert.deepEqual(ready.metadata.questions,record.metadata.questions);
assert.deepEqual(await ready.answers[0].blob.arrayBuffer(),await png.arrayBuffer());
assert.equal(await ready.blob.text(),await pdf.text());
await assert.rejects(core.unpack(packageBlob,other,(await core.keys(code,other)).key),/无法解锁/);
await assert.rejects(core.unpack(packageBlob,owner,(await core.keys(core.newCode(),owner)).key),/无法解锁/);
const tampered=new Uint8Array(await packageBlob.arrayBuffer());tampered[tampered.length-1]^=1;
await assert.rejects(core.unpack(new Blob([tampered]),owner,keys.key),/无法解锁/);
const destination=new Map();
const store={async restore(owner,item){if(destination.has(item.metadata.id))return false;destination.set(item.metadata.id,structuredClone(item));return true;},async snapshot(owner,id){return destination.get(id)||null;}};
assert.deepEqual(await core.merge(store,owner,[ready]),{added:1,same:0,conflicts:0});
assert.deepEqual(await core.merge(store,owner,[ready]),{added:0,same:1,conflicts:0});
destination.get(id).metadata.questions[0].notebookStatus='correct';
const conflicting=await core.merge(store,owner,[ready]);assert.deepEqual(conflicting,{added:1,same:0,conflicts:1});
assert.equal(destination.get(id).metadata.questions[0].notebookStatus,'correct');
assert.equal([...destination.values()].find(item=>item.metadata.id!==id).metadata.questions[0].notebookStatus,'wrong');
assert.deepEqual(await core.merge(store,owner,[ready]),{added:0,same:1,conflicts:0});
const vaults=new Map();
const namespace={getByName(name){
 if(!vaults.has(name)){
  const records=new Map();
  const storage={get:async key=>structuredClone(records.get(key)),put:async(key,value)=>{records.set(key,structuredClone(value));},delete:async key=>{for(const item of [].concat(key))records.delete(item);}};
  vaults.set(name,{records,storage,vault:new SyncVault({storage})});
 }
 return vaults.get(name).vault;
}};
const origin='https://hankgao15888.github.io';
const otherKeys=await core.keys(code,other);
const env={SYNC_ORIGINS:origin,SYNC_VAULTS:keys.vault,PRIVATE_VAULTS:namespace};
const request=(method,options={})=>worker.fetch(new Request('https://example.invalid/v1/files',{
 method,body:options.body,headers:{Origin:options.origin||origin,...(options.token===null?{}:{Authorization:`Bearer ${options.token||keys.token}`}),...options.headers}
}),env);
assert.equal((await request('OPTIONS')).status,204);
assert.equal((await request('GET',{token:null})).status,401);
assert.equal((await request('GET',{token:otherKeys.token})).status,403);
assert.equal(vaults.size,0);
assert.equal((await request('GET',{origin:'https://example.org'})).status,403);
assert.equal((await request('GET')).status,404);
const uploadHeaders={'Content-Type':'application/octet-stream','Content-Length':String(packageBlob.size)};
assert.equal((await request('PUT',{body:packageBlob,headers:uploadHeaders})).status,428);
const uploaded=await request('PUT',{body:packageBlob,headers:{...uploadHeaders,'If-None-Match':'*'}});
assert.equal(uploaded.status,204);
assert.equal((await request('PUT',{body:packageBlob,headers:{...uploadHeaders,'If-None-Match':'*'}})).status,412);
const response=await request('GET');
assert.equal(response.headers.get('Access-Control-Expose-Headers'),'ETag');
assert.equal(response.headers.get('Cache-Control'),'no-store');
assert.equal((await core.unpack(await response.blob(),owner,keys.key))[0].answers[0].filename,'answer.png');
assert.equal((await request('PUT',{body:packageBlob,headers:{...uploadHeaders,'If-Match':response.headers.get('etag')}})).status,204);
assert.equal((await request('PUT',{body:packageBlob,headers:{...uploadHeaders,'If-Match':response.headers.get('etag')}})).status,412);
const vaultState=vaults.get(keys.vault);
const previous=await request('GET');
await previous.arrayBuffer();
const previousETag=previous.headers.get('etag');
const bigAnswer=new Blob([new Uint8Array(1_100_000).fill(187)]);
const largerPackage=await core.pack([{...record,answers:[{...record.answers[0],blob:bigAnswer}]}],owner,keys.key);
const largeHeaders={...uploadHeaders,'Content-Length':String(largerPackage.size),'If-Match':previousETag};
assert.equal((await request('PUT',{body:largerPackage.slice(0,600_000),headers:largeHeaders})).status,400);
assert(vaultState.records.has('staged'));
vaultState.vault=new SyncVault({storage:vaultState.storage});
const afterRestart=await request('GET');
assert.equal(afterRestart.headers.get('etag'),previousETag);
assert.deepEqual(await afterRestart.arrayBuffer(),await packageBlob.arrayBuffer());

const replacements=await Promise.all([request('PUT',{body:largerPackage,headers:largeHeaders}),request('PUT',{body:largerPackage,headers:largeHeaders})]);
assert.equal(replacements.filter(item=>item.status===204).length,1);
assert(replacements.some(item=>item.status===409||item.status===412));
assert(!vaultState.records.has('staged'));
assert.equal([...vaultState.records.keys()].filter(key=>key.startsWith('chunk:')).length,3);
const inProgress=await request('GET');
assert.equal((await request('PUT',{body:largerPackage,headers:{...largeHeaders,'If-Match':inProgress.headers.get('etag')}})).status,409);
await inProgress.body.cancel();
const restored=await request('GET');
const [restoredPdf]=await core.unpack(await restored.blob(),owner,keys.key);
assert.deepEqual(restoredPdf.metadata.questions,record.metadata.questions);
assert.deepEqual(await restoredPdf.answers[0].blob.arrayBuffer(),await bigAnswer.arrayBuffer());
env.SYNC_VAULTS+=`,${otherKeys.vault}`;
assert.equal((await request('GET',{token:otherKeys.token})).status,404);
assert.equal(vaults.size,2);
const html=fs.readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');
for(const match of fs.readFileSync(new URL('../docs/file-sync.js',import.meta.url),'utf8').matchAll(/\$\('(fileSync\w+)'\)/g))assert(html.includes(`id="${match[1]}"`));
console.log('File sync: complete encrypted round trips, changed snapshots, wrong students/keys, tamper detection, private storage authentication and conditional updates passed.');

// Two independent browser profiles: export on device one and recover using device two.
function device(initial,folder=null,{syncCode,cloud=false,practiceSync,savedSettings}={}){
 const data=new Map(initial.map(item=>[item.metadata.id,structuredClone(item)]));
 const storage=new Map(),controls=new Map(),downloads=[];
 const timers=new Map(),events=new Map();let sequence=0,rendered=0,offline=false;
 if(syncCode)storage.set('chapterlab-file-sync-v1:'+owner,JSON.stringify({code:syncCode,...savedSettings}));
 let remembered=null;
 function control(id){
  if(!controls.has(id))controls.set(id,{value:'',options:[],append(option){this.options.push(option);},replaceChildren(){this.options=[];},addEventListener(){},showModal(){this.open=true;}});
  return controls.get(id);
 }
 const context=vm.createContext({ChapterLabFileSyncCore:core,ChapterLabPracticeSync:practiceModel,ChapterLabSyncFolder:folderAPI,showDirectoryPicker:folder?async()=>folder:undefined,document:{getElementById:control,createElement:()=>({}),addEventListener:(name,fn)=>events.set(name,fn)},
  setTimeout(fn){const id=++sequence;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},addEventListener:(name,fn)=>events.set(name,fn),
  AbortSignal,URL,location:{hostname:'example.test'},fetch:async(url,{method,headers,body}={})=>{
   if(offline)throw Error('Offline');
   if(url==='file-sync-config.json')return {ok:true,json:async()=>({endpoint:cloud?'https://example.invalid':''})};
   return worker.fetch(new Request(url,{method,headers:{...headers,Origin:origin,...(body?{'Content-Length':String(body.size)}:{})},body}),env);
  },
  localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},confirm:()=>true});
 vm.runInContext(fs.readFileSync(new URL('../docs/file-sync.js',import.meta.url),'utf8'),context);
 const sync=context.ChapterLabFileSync.create({owner:async()=>owner,practiceSync,store:{
  async list(){return [...data.values()].map(item=>item.metadata);},
  async snapshot(owner,id){return data.get(id);},
  async setSyncDirectory(owner,handle){remembered=handle;},
  async getSyncDirectory(){return remembered;},
  async restore(owner,item,replace){const original=data.get(item.metadata.id);if(original&&(!replace||original.metadata.syncRevision!==replace.revision||!replace.allowed()))return false;data.set(item.metadata.id,structuredClone(item));return true;}
 },download:(blob,name)=>downloads.push({blob,name}),onRestored(){rendered++;}});
 return {control,downloads,data,sync,rendered:()=>rendered,storage,setOffline(value){offline=value;},event(name){events.get(name)?.();},async flush(){
  let count=0;while(timers.size){assert(count++<8,'Scheduled sync must settle');const [id,fn]=timers.entries().next().value;timers.delete(id);await fn();}
 }};
}
const source=device([record]),target=device([]);
await source.control('fileSyncOpen').onclick();
await source.control('fileSyncNew').onclick();
const pairing=source.control('fileSyncCode').value;
assert(core.validCode(pairing));
assert(source.control('fileSyncPush').disabled,'Site without private provider stays local');
await source.control('fileSyncExport').onclick();
assert.match(source.downloads[0].name,/\.clsync$/);
await target.control('fileSyncOpen').onclick();
assert(target.control('fileSyncImport').disabled);
target.control('fileSyncCode').value=pairing;
await target.control('fileSyncUse').onclick();
assert.equal(target.control('fileSyncImport').disabled,false);
target.control('fileSyncImport').files=[source.downloads[0].blob];
await target.control('fileSyncImport').onchange();
assert.match(target.control('fileSyncStatus').textContent,/已导入 1 份/);
assert.deepEqual(target.data.get(id).metadata.questions,record.metadata.questions);
assert.equal(target.data.get(id).answers[0].filename,'answer.png');
console.log('Two browser profiles can move an encrypted file bundle without a cloud endpoint.');

function virtualDirectory(name){
 const children=new Map();
 const missing=()=>Object.assign(Error('Not found'),{name:'NotFoundError'});
 return {name,kind:'directory',children,async queryPermission(){return 'granted';},async requestPermission(){return 'granted';},
  async *entries(){yield* children;},
  async getDirectoryHandle(child,{create=false}={}){
   if(!children.has(child)&&!create)throw missing();
   if(!children.has(child))children.set(child,virtualDirectory(child));
   return children.get(child);
  },
  async getFileHandle(child,{create=false}={}){
   if(!children.has(child)&&!create)throw missing();
   if(!children.has(child)){
    let contents=new Blob([]);
    children.set(child,{kind:'file',async getFile(){return contents;},async createWritable(){
     let pending;
     return {async write(blob){pending=blob;},async close(){contents=pending;},async abort(){pending=null;}};
    }});
   }
   return children.get(child);
  },async removeEntry(child){children.delete(child);}
 };
}
const synced=virtualDirectory('我的坚果云'),one=device([record],synced),two=device([],synced);
await one.control('fileSyncOpen').onclick();
await one.control('fileSyncFolderPick').onclick();
assert.match(one.control('fileSyncFolderState').textContent,/我的坚果云/);
one.control('fileSyncCode').value=code;
await one.control('fileSyncUse').onclick();
await one.control('fileSyncFolderSave').onclick();
assert.match(one.control('fileSyncStatus').textContent,/已写入/);
await one.control('fileSyncFolderSave').onclick();
assert.equal((await folderAPI.list(synced,keys.vault)).length,2,'Each save produces a distinct encrypted snapshot');
assert.equal((await folderAPI.list(synced,(await core.keys(code,other)).vault)).length,0);
assert.equal(synced.children.size,1,'Only the Chapter Lab subfolder is written');
one.control('fileSyncDialog').open=false;
await one.control('fileSyncOpen').onclick();
assert.match(one.control('fileSyncFolderState').textContent,/我的坚果云/);
await two.control('fileSyncOpen').onclick();
two.control('fileSyncCode').value=code;
await two.control('fileSyncUse').onclick();
await two.control('fileSyncFolderPick').onclick();
assert.equal(two.control('fileSyncFolderPackage').options.length,3);
await two.control('fileSyncFolderRestore').onclick();
assert.match(two.control('fileSyncStatus').textContent,/已导入 1 份/);
assert.equal(two.data.get(id).answers[0].filename,'answer.png');
assert.deepEqual(two.data.get(id).metadata.questions,record.metadata.questions);
await two.control('fileSyncFolderRestore').onclick();
assert.match(two.control('fileSyncStatus').textContent,/跳过 1 份/);
assert.match(target.control('fileSyncFolderState').textContent,/下载/);
console.log('Nutstore folder workflow: independent browser profiles save and restore encrypted screenshots and answers; remembered folder and mobile fallback passed.');

vaults.clear();
const main=device([record],null,{cloud:true,syncCode:code}),fresh=device([],null,{cloud:true});
main.sync.start();await main.flush();
assert.match(main.control('fileSyncActivity').textContent,/云端备份完成/,'Opening the source automatically creates the first Cloudflare backup');
fresh.sync.start();await fresh.flush();
assert.equal(fresh.data.size,0,'A new device needs the original key');
await fresh.control('fileSyncOpen').onclick();
fresh.control('fileSyncCode').value=code;
await fresh.control('fileSyncUse').onclick();await fresh.flush();
assert.deepEqual(fresh.data.get(id).metadata.questions,record.metadata.questions);
assert.equal(fresh.data.get(id).answers[0].filename,'answer.png');
assert.equal(fresh.rendered(),1,'The questions and practice view refresh automatically');

main.data.get(id).metadata.questions[0].notebookStatus='correct';
main.sync.changed();await main.flush();
fresh.event('online');await fresh.flush();
assert.equal(fresh.data.get(id).metadata.questions[0].notebookStatus,'correct');
assert.equal(fresh.data.size,1,'A clean device updates the existing PDF without duplicating it');

main.setOffline(true);
main.data.get(id).answers[0].filename='new-answer.png';
main.sync.changed();await main.flush();
assert.equal(JSON.parse([...main.storage.values()][0]).pending,true,'Failed backup keeps unsynced edits queued');
fresh.data.get(id).metadata.questions[0].notebookStatus='wrong';
fresh.sync.changed();await fresh.flush();
main.setOffline(false);main.event('online');await main.flush();
assert.equal(main.data.get(id).answers[0].filename,'new-answer.png');
assert.equal(main.data.size,2,'Concurrent edits retain both versions');
const recovered=device([],null,{cloud:true,syncCode:code});
recovered.sync.start();await recovered.flush();
assert.equal(recovered.data.size,2,'A returning device restores both versions without opening the sync dialog');
assert.equal(recovered.data.get(id).answers[0].filename,'new-answer.png');
console.log('Automatic cloud sync: initial backup, one-time key setup, startup restore, revision updates, offline retry, and conflict preservation passed.');

function practiceFor(student='alice',seed={}){
 const disk=new Map(Object.entries(seed));
 const model=practiceModel.open({getItem:key=>disk.get(key),setItem:(key,value)=>disk.set(key,value)},student);
 let saved=model.initial();
 return {snapshot:model.snapshot,receive(remote){const result=model.receive(remote);if(result.saved)saved=result.saved;return result.needsUpload;},get state(){return saved;},edit(produce){produce(saved);saved=model.commit(saved);},disk};
}
const q1='oxford-aqa-international-physics-2026-q1',q2='cie-international-mathematics-2025-q2';
const paper={id:'paper-1',title:'复习卷',minutes:60,subject:'physics',date:'2026-11-27T09:00:00Z',ids:[q1]};
const legacy={practice:{[q1]:'wrong'},notebook:{[q1]:{subject:'physics'}},papers:[paper],overrides:{[q1]:['physics-3.2']}};
const shared=practiceFor('alice',{'chapterlab-v1':JSON.stringify(legacy)});
assert(!practiceModel.size(shared.snapshot()),'Legacy browser-wide data is not claimed automatically on shared browsers');
const sharedStorage={getItem:key=>shared.disk.get(key),setItem:(key,value)=>shared.disk.set(key,value)};
const aliceClaim=practiceModel.open(sharedStorage,'alice');
assert(aliceClaim.pendingLegacy());assert.deepEqual(aliceClaim.claim(),legacy);
const bobClaim=practiceModel.open(sharedStorage,'bob',{mayClaim:true});
assert(!bobClaim.pendingLegacy());assert(!practiceModel.size(bobClaim.snapshot()),'Claimed records cannot leak to another student');

// Upgrade a vault that already contains a v1 PDF-only snapshot, including the old remembered ETag.
vaults.clear();
const old=device([record],null,{cloud:true,syncCode:code});old.sync.start();await old.flush();
const oldSettings=JSON.parse([...old.storage.values()][0]);delete oldSettings.practiceEtag;
const alice=practiceFor('alice');alice.edit(state=>Object.assign(state,structuredClone(legacy)));
const upgraded=device([record],null,{cloud:true,syncCode:code,savedSettings:oldSettings,practiceSync:alice});
upgraded.sync.start();await upgraded.flush();
assert.match(upgraded.control('fileSyncActivity').textContent,/备份完成/);
const remote=practiceFor('alice');const next=device([],null,{cloud:true,syncCode:code,practiceSync:remote});
next.sync.start();await next.flush();
assert.deepEqual(remote.state,legacy);
assert.equal(next.data.get(id).answers[0].filename,'answer.png');

upgraded.setOffline(true);
alice.edit(state=>{state.practice[q1]='correct';state.papers=[];});upgraded.sync.changed();await upgraded.flush();
remote.edit(state=>{state.practice[q2]='wrong';state.notebook[q2]={subject:'mathematics'};});next.sync.changed();await next.flush();
upgraded.setOffline(false);upgraded.event('online');await upgraded.flush();
next.event('online');await next.flush();
assert.equal(remote.state.practice[q1],'correct');assert.equal(remote.state.notebook[q1].subject,'physics');
assert.equal(remote.state.practice[q2],'wrong');assert.equal(remote.state.papers.length,0,'A saved paper deletion is not resurrected by an older device');
assert.deepEqual(remote.state,alice.state);

vaults.clear();
const noPdf=device([],null,{cloud:true,syncCode:code,practiceSync:alice});noPdf.sync.start();await noPdf.flush();
const practiceOnly=practiceFor();const practiceDevice=device([],null,{cloud:true,syncCode:code,practiceSync:practiceOnly});
practiceDevice.sync.start();await practiceDevice.flush();
assert.deepEqual(practiceOnly.state,alice.state,'Practice history synchronizes even without a PDF');
assert.equal(practiceDevice.data.size,0);
console.log('Practice sync: safe legacy migration, v1 upgrade, PDFs plus notebook and paper restore, offline merge, deletion, and practice-only vaults passed.');

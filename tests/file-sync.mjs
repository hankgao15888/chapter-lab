import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import worker from '../file-sync-service/worker.mjs';
const require=createRequire(import.meta.url),core=require('../docs/file-sync-core.js'),folderAPI=require('../docs/file-sync-folder.js');
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
const files=new Map();let serial=0;
const bucket={get:async key=>files.get(key)||null,put:async(key,body,{onlyIf})=>{
 const old=files.get(key);
 if(onlyIf.get('If-None-Match')==='*'&&old||onlyIf.get('If-Match')&&onlyIf.get('If-Match')!==old?.httpEtag)return null;
 const bytes=await new Response(body).arrayBuffer();
 const value={body:bytes,size:bytes.byteLength,httpEtag:'"'+(++serial).toString(16).padStart(32,'0')+'"'};
 files.set(key,value);return value;
}};
const origin='https://hankgao15888.github.io';
const env={SYNC_ORIGINS:origin,SYNC_VAULTS:keys.vault,PRIVATE_FILES:bucket};
const request=(method,options={})=>worker.fetch(new Request('https://example.invalid/v1/files',{
 method,body:options.body,headers:{Origin:options.origin||origin,...(options.token===null?{}:{Authorization:`Bearer ${options.token||keys.token}`}),...options.headers}
}),env);
assert.equal((await request('OPTIONS')).status,204);
assert.equal((await request('GET',{token:null})).status,401);
assert.equal((await request('GET',{token:(await core.keys(code,other)).token})).status,403);
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
const html=fs.readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');
for(const match of fs.readFileSync(new URL('../docs/file-sync.js',import.meta.url),'utf8').matchAll(/\$\('(fileSync\w+)'\)/g))assert(html.includes(`id="${match[1]}"`));
console.log('File sync: complete encrypted round trips, changed snapshots, wrong students/keys, tamper detection, private storage authentication and conditional updates passed.');

// Two independent browser profiles: export on device one and recover using device two.
function device(initial,folder=null){
 const data=new Map(initial.map(item=>[item.metadata.id,structuredClone(item)]));
 const storage=new Map(),controls=new Map(),downloads=[];
 let remembered=null;
 function control(id){
  if(!controls.has(id))controls.set(id,{value:'',options:[],append(option){this.options.push(option);},replaceChildren(){this.options=[];},addEventListener(){},showModal(){this.open=true;}});
  return controls.get(id);
 }
 const context=vm.createContext({ChapterLabFileSyncCore:core,ChapterLabSyncFolder:folderAPI,showDirectoryPicker:folder?async()=>folder:undefined,document:{getElementById:control,createElement:()=>({})},
  AbortSignal,location:{hostname:'example.test'},fetch:async()=>({ok:true,json:async()=>({endpoint:''})}),
  localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},confirm:()=>true});
 vm.runInContext(fs.readFileSync(new URL('../docs/file-sync.js',import.meta.url),'utf8'),context);
 context.ChapterLabFileSync.create({owner:async()=>owner,store:{
  async list(){return [...data.values()].map(item=>item.metadata);},
  async snapshot(owner,id){return data.get(id);},
  async setSyncDirectory(owner,handle){remembered=handle;},
  async getSyncDirectory(){return remembered;},
  async restore(owner,item){if(data.has(item.metadata.id))return false;data.set(item.metadata.id,item);return true;}
 },download:(blob,name)=>downloads.push({blob,name}),onRestored(){}});
 return {control,downloads,data};
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

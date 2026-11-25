/* Copy encrypted Chapter Lab snapshots into a user-selected desktop sync folder. */
(function(root){
 'use strict';
 const folderName='Chapter Lab Sync';
 function prefix(vault){
  if(!/^[a-f0-9]{64}$/.test(vault))throw Error('请先设置同步密钥。');
  return 'chapterlab-'+vault.slice(0,24)+'-';
 }
 async function list(rootFolder,vault){
  const start=prefix(vault),files=[];
  let folder;
  try{folder=await rootFolder.getDirectoryHandle(folderName);}
  catch(error){if(error.name==='NotFoundError')return files;throw error;}
  for await(const [name,handle] of folder.entries()){
   if(handle.kind!=='file'||!name.startsWith(start))continue;
   const match=name.slice(start.length).match(/^(\d{13})-[a-f0-9]{12}\.clsync$/);
   if(match)files.push({name,handle,createdAt:Number(match[1])});
  }
  return files.sort((a,b)=>b.createdAt-a.createdAt||b.name.localeCompare(a.name));
 }
 async function write(rootFolder,vault,encrypted){
  const folder=await rootFolder.getDirectoryHandle(folderName,{create:true});
  const tail=Array.from(root.crypto.getRandomValues(new Uint8Array(6)),byte=>byte.toString(16).padStart(2,'0')).join('');
  const name=prefix(vault)+Date.now()+'-'+tail+'.clsync';
  let writer,created=false;
  try{
   const file=await folder.getFileHandle(name,{create:true});
   created=true;
   writer=await file.createWritable();
   await writer.write(encrypted);
   await writer.close();
  }catch(error){
   if(writer)await writer.abort().catch(()=>{});
   if(created&&folder.removeEntry)await folder.removeEntry(name).catch(()=>{});
   throw error;
  }
  return name;
 }
 const api={folderName,list,write};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.ChapterLabSyncFolder=api;
})(globalThis);

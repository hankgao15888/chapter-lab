/* MIT License · Portable authenticated snapshots for Chapter Lab's local file library. */
(function(root){
 'use strict';
 const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
 const magic=encoder.encode('CLSYNC1\0');
 const maxBytes=80*1024*1024;
 const maxHeader=12*1024*1024;
 const subjects=new Set(['physics','mathematics','furthermathematics','chemistry','biology','economics']);
 const answerTypes=new Set(['application/pdf','image/png','image/jpeg','image/gif','image/webp']);
 const idPattern=/^[a-z0-9_-]{1,100}$/i;
 const hexBytes=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 const shortText=(value,max)=>typeof value==='string'&&value.length<=max;
 const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
 const digest=async bytes=>hexBytes(new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes)));
 const newCode=()=>hexBytes(root.crypto.getRandomValues(new Uint8Array(32)));
 const validCode=code=>/^[a-f0-9]{64}$/i.test(code);
 async function keys(code,owner){
  if(!validCode(code))throw new Error('请填写完整的 64 位同步密钥。');
  const secret=Uint8Array.from(code.match(/../g),value=>parseInt(value,16));
  const base=await root.crypto.subtle.importKey('raw',secret,'HKDF',false,['deriveKey','deriveBits']);
  const options={name:'HKDF',hash:'SHA-256',salt:encoder.encode(owner)};
  const key=await root.crypto.subtle.deriveKey({...options,info:encoder.encode('chapterlab-file-sync/encryption/v1')},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const token=hexBytes(new Uint8Array(await root.crypto.subtle.deriveBits({...options,info:encoder.encode('chapterlab-file-sync/authorization/v1')},base,256)));
  return {key,token,vault:await digest(encoder.encode(token))};
 }
 function safeQuestion(question,pageCount){
  if(!question||typeof question.id!=='string'||!idPattern.test(question.id)||!shortText(question.label,100)||!shortText(question.text,20000))throw Error('同步包中的题目记录不完整。');
  const {parts,chapters,matchedKeywords,notebookStatus}=question;
  if(!Array.isArray(chapters)||chapters.length>80||!chapters.every(item=>shortText(item,128)))throw Error('同步包中的章节无效。');
  if(matchedKeywords!==undefined&&(!Array.isArray(matchedKeywords)||!matchedKeywords.every(item=>shortText(item,250))))throw Error('同步包中的识别关键词无效。');
  if(notebookStatus!==undefined&&![null,'wrong','correct'].includes(notebookStatus))throw Error('同步包中的错题状态无效。');
  if(!Array.isArray(parts)||!parts.length||parts.length>300)throw Error('同步包中的截图范围无效。');
  for(const part of parts){
   if(!part||!integer(part.page,1,pageCount)||!Number.isFinite(part.top)||!Number.isFinite(part.bottom)||part.top<0||part.bottom>1||part.top>=part.bottom)throw Error('同步包中的截图范围无效。');
   if((part.left!==undefined||part.right!==undefined)&&(!Number.isFinite(part.left)||!Number.isFinite(part.right)||part.left<0||part.right>1||part.left>=part.right))throw Error('同步包中的截图范围无效。');
  }
 }
 function validateDocument(record,owner){
  if(!record||typeof record.id!=='string'||!record.id.startsWith(owner+':')||!/^[a-f0-9]{64}(?::sync-[a-f0-9]{64})?$/.test(record.id.slice(owner.length+1))||!/^[a-f0-9]{64}$/.test(record.fingerprint))throw Error('同步包与你当前的学员账号或文件不匹配。');
  if(record.id.split(':')[1]!==record.fingerprint||!subjects.has(record.subject)||!shortText(record.title,255)||!shortText(record.filename,255)||!integer(record.pageCount,1,300)||!Number.isFinite(Date.parse(record.createdAt)))throw Error('同步包中的 PDF 记录无效。');
  if(!Array.isArray(record.questions)||record.questions.length>2500)throw Error('同步包中的题目数量无效。');
  const ids=new Set();
  for(const question of record.questions){safeQuestion(question,record.pageCount);if(ids.has(question.id))throw Error('同步包含有重复题目。');ids.add(question.id);}
  return ids;
 }
 async function describe(snapshot,owner){
  const {owner:ignored,syncRevision:localRevision,...metadata}=snapshot.metadata;
  const ids=validateDocument(metadata,owner);
  if(!integer(snapshot.blob.size,1,50*1024*1024))throw Error('原 PDF 超出可同步的大小。');
  const seen=new Set();
  const attachments=[];
  for(const answer of snapshot.answers){
   if(!ids.has(answer.questionId)||seen.has(answer.questionId)||!shortText(answer.filename,255)||!answerTypes.has(answer.type)||!integer(answer.blob.size,1,25*1024*1024))throw Error('同步包中有无效的单题答案。');
   seen.add(answer.questionId);
   attachments.push({questionId:answer.questionId,filename:answer.filename,type:answer.type,bytes:answer.blob.size,sha256:await digest(await answer.blob.arrayBuffer())});
  }
  return {metadata,pdfBytes:snapshot.blob.size,attachments};
 }
 async function pack(snapshots,owner,key){
  if(!snapshots.length||snapshots.length>300)throw Error('请至少选择一份 PDF，每个同步包最多包含 300 份。');
  const total=snapshots.reduce((sum,item)=>sum+item.blob.size+item.answers.reduce((n,a)=>n+a.blob.size,0),0);
  if(total>maxBytes)throw Error('单个同步包最多 80 MB。可分批导出 PDF。');
  const items=[];
  for(const snapshot of snapshots)items.push(await describe(snapshot,owner));
  const header=encoder.encode(JSON.stringify(items));
  if(header.length>maxHeader||header.length+total+40>maxBytes)throw Error('同步包超过 80 MB。可分批导出 PDF。');
  const length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,header.length);
  const payload=new Blob([length,header,...snapshots.flatMap(item=>[item.blob,...item.answers.map(answer=>answer.blob)])]);
  const iv=root.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await root.crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:magic},key,await payload.arrayBuffer());
  return new Blob([magic,iv,ciphertext],{type:'application/octet-stream'});
 }
 async function unpack(blob,owner,key){
  if(blob.size>maxBytes||blob.size<magic.length+12+20)throw Error('文件太小或超过 80 MB，请选择有效同步包。');
  const input=new Uint8Array(await blob.arrayBuffer());
  if(!magic.every((value,i)=>input[i]===value))throw Error('请选择 Chapter Lab 的 .clsync 同步包。');
  let bytes;
  try{
   bytes=await root.crypto.subtle.decrypt({name:'AES-GCM',iv:input.subarray(magic.length,magic.length+12),additionalData:magic},key,input.subarray(magic.length+12));
  }catch{throw Error('无法解锁同步包。请确认是同一学员账号、同一同步密钥，且文件没有损坏。');}
  const headerLength=new DataView(bytes).getUint32(0);
  if(!integer(headerLength,1,maxHeader)||headerLength+4>bytes.byteLength)throw Error('同步包目录无效。');
  const items=JSON.parse(decoder.decode(new Uint8Array(bytes,4,headerLength)));
  if(!Array.isArray(items)||!items.length||items.length>300)throw Error('同步包中没有有效 PDF。');
  const result=[],recordIds=new Set();let offset=4+headerLength;
  function take(size,max,type){
   if(!integer(size,1,max)||offset+size>bytes.byteLength)throw Error('同步包文件大小无效。');
   const content=new Uint8Array(bytes,offset,size);offset+=size;
   return {content,blob:new Blob([content],{type})};
  }
  for(const item of items){
   const {metadata,pdfBytes,attachments}=item;
   const questionIds=validateDocument(metadata,owner);
   if(recordIds.has(metadata.id)||!Array.isArray(attachments)||attachments.length>questionIds.size)throw Error('同步包有重复记录或无效答案。');
   recordIds.add(metadata.id);
   const pdf=take(pdfBytes,50*1024*1024,'application/pdf');
   if(await digest(pdf.content)!==metadata.fingerprint)throw Error('同步包里的 PDF 校验失败。');
   const answers=[],seen=new Set();
   for(const attachment of attachments){
    const {questionId,filename,type,bytes:size,sha256}=attachment;
    if(!questionIds.has(questionId)||seen.has(questionId)||!answerTypes.has(type)||!shortText(filename,255))throw Error('同步包中的答案记录无效。');
    seen.add(questionId);
    const answer=take(size,25*1024*1024,type);
    if(await digest(answer.content)!==sha256)throw Error('答案附件校验失败。');
    answers.push({questionId,filename,type,blob:answer.blob});
   }
   result.push({metadata:{...metadata,owner,size:pdfBytes},blob:pdf.blob,answers});
  }
  if(offset!==bytes.byteLength)throw Error('同步包中有额外的文件数据。');
  return result;
 }
 async function identity(snapshot,owner){
  const item=await describe(snapshot,owner);
  delete item.metadata.id;
  item.attachments.sort((a,b)=>a.questionId.localeCompare(b.questionId));
  return digest(encoder.encode(JSON.stringify(item)));
 }
 async function merge(store,owner,snapshots){
  const result={added:0,same:0,conflicts:0};
  for(const item of snapshots){
   if(await store.restore(owner,item)){result.added++;continue;}
   const contentId=await identity(item,owner);
   const existing=await store.snapshot(owner,item.metadata.id);
   if(existing&&await identity(existing,owner)===contentId){result.same++;continue;}
   const id=`${owner}:${item.metadata.fingerprint}:sync-${contentId}`;
   const copy={...item,metadata:{...item.metadata,id}};
   if(await store.restore(owner,copy)){result.added++;result.conflicts++;}
   else result.same++;
  }
  return result;
 }
 async function signatures(snapshots,owner){
  const map={};for(const item of snapshots)map[item.metadata.id]=await identity(item,owner);return map;
 }
 async function mergeCloud(store,owner,snapshots,baseline={},canReplace=()=>true){
  const result={added:0,same:0,conflicts:0,updated:0,baseline:await signatures(snapshots,owner)};
  for(const item of snapshots){
   const id=item.metadata.id,remote=result.baseline[id];
   if(await store.restore(owner,item)){result.added++;continue;}
   const local=await store.snapshot(owner,id);
   const localContent=local&&await identity(local,owner);
   if(localContent===remote||baseline[id]===remote){result.same++;continue;}
   if(local&&localContent===baseline[id]&&await store.restore(owner,item,{revision:local.metadata.syncRevision,allowed:()=>canReplace(id)}))result.updated++;
   else {
    const alternate=`${owner}:${item.metadata.fingerprint}:sync-${remote}`;
    const copy={...item,metadata:{...item.metadata,id:alternate}};
    if(await store.restore(owner,copy)){result.added++;result.conflicts++;}
    else result.same++;
   }
  }
  return result;
 }
 const api={newCode,validCode,keys,pack,unpack,merge,mergeCloud,signatures,maxBytes};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.ChapterLabFileSyncCore=api;
})(globalThis);

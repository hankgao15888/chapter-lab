(function(root){
 'use strict';
 const fields=['questions','papers','overrides'];
 const subjects=new Set(['physics','mathematics','furthermathematics','chemistry','biology','economics']);
 const empty=()=>Object.fromEntries(fields.map(field=>[field,{}]));
 const entries=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.entries(value):[];
 const id=value=>typeof value==='string'&&/^[a-z0-9_.:-]{1,200}$/i.test(value)&&!['__proto__','constructor','prototype'].includes(value);
 function cleanValue(field,value){
  if(value===null)return null;
  if(field==='questions'&&value&&['wrong','correct'].includes(value.status)&&(value.subject===null||subjects.has(value.subject)))return {status:value.status,subject:value.subject};
  if(field==='overrides'&&Array.isArray(value)&&value.length<=100&&value.every(id))return [...new Set(value)];
  if(field==='papers'&&value&&typeof value.title==='string'&&value.title.length<=300&&Number.isFinite(value.minutes)&&value.minutes>0&&value.minutes<=1440&&subjects.has(value.subject)&&typeof value.date==='string'&&Number.isFinite(Date.parse(value.date))&&Array.isArray(value.ids)&&value.ids.length<=500&&value.ids.every(id))return {title:value.title,minutes:value.minutes,subject:value.subject,date:value.date,ids:[...value.ids]};
 }
 function sanitize(input){
  const output=empty();
  for(const field of fields)for(const [key,row] of entries(input?.[field])){
   if(!id(key)||!Array.isArray(row)||row.length!==2||!Number.isSafeInteger(row[0])||row[0]<0||row[0]>8.64e15)continue;
   const value=cleanValue(field,row[1]);if(value!==undefined)output[field][key]=[row[0],value];
  }
  return output;
 }
 function project(saved){
  const out=empty();
  for(const [key,status] of entries(saved.practice))if(id(key)&&['wrong','correct'].includes(status)){
   const subject=saved.notebook?.[key]?.subject;
   out.questions[key]={status,subject:subjects.has(subject)?subject:null};
  }
  if(Array.isArray(saved.papers))for(const paper of saved.papers)if(id(paper?.id)){
   const value=cleanValue('papers',paper);if(value)out.papers[paper.id]=value;
  }
  for(const [key,chapters] of entries(saved.overrides))if(id(key)){
   const value=cleanValue('overrides',chapters);if(value)out.overrides[key]=value;
  }
  return out;
 }
 function materialize(log){
  const saved={practice:{},notebook:{},papers:[],overrides:{}};
  for(const [key,[,record]] of Object.entries(log.questions))if(record){
   saved.practice[key]=record.status;if(record.subject)saved.notebook[key]={subject:record.subject};
  }
  for(const [key,[,record]] of Object.entries(log.papers))if(record)saved.papers.push({id:key,...record,ids:[...record.ids]});
  saved.papers.sort((a,b)=>b.date.localeCompare(a.date));
  for(const [key,[,record]] of Object.entries(log.overrides))if(record)saved.overrides[key]=[...record];
  return saved;
 }
 function size(log){return fields.reduce((sum,field)=>sum+Object.keys(log[field]).length,0);}
 const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 function merge(local,remote){
  const out=empty();let changed=false,needsUpload=false;
  for(const field of fields)for(const key of new Set([...Object.keys(local[field]),...Object.keys(remote[field])])){
   const a=local[field][key],b=remote[field][key];
   let selected=a||b;
   if(a&&b){
    // Any clocked edit beats a legacy record. A stable tie-breaker converges across devices.
    if(b[0]>a[0]||(b[0]===a[0]&&JSON.stringify(b[1])>JSON.stringify(a[1])))selected=b;
   }
   out[field][key]=selected;if(!equal(a,selected))changed=true;if(!equal(b,selected))needsUpload=true;
  }
  return {log:out,changed,needsUpload};
 }
 const migrate=saved=>{
  const out=project(saved);
  for(const field of fields)for(const key of Object.keys(out[field]))out[field][key]=[0,out[field][key]];
  return out;
 };
 function open(storage,student,{mayClaim=false,migrateNotebook=()=>{}}={}){
  const key='chapterlab-practice-v2:'+student;
  const legacyOwner='chapterlab-practice-legacy-owner-v2';
  const read=name=>{try{return storage.getItem(name);}catch{return null;}};
  const parse=raw=>{try{return JSON.parse(raw||'null');}catch{return null;}};
  const latest=()=>sanitize(parse(read(key)));
  let log=latest();
  function legacy(){
   const previous=read(legacyOwner);
   if(previous&&previous!==student)return empty();
   const old=parse(read('chapterlab-v1'));
   if(!old||typeof old!=='object')return empty();
   migrateNotebook(old);
   return migrate(old);
  }
  const pendingLegacy=()=>!read(legacyOwner)&&size(legacy())>0;
  function claim(){
   const owner=read(legacyOwner);
   if(owner&&owner!==student)return materialize(log);
   const moved=legacy();if(!size(moved))return materialize(log);
   const combined=merge(latest(),moved).log;
   storage.setItem(legacyOwner,student);
   storage.setItem(key,JSON.stringify(combined));log=combined;
   return materialize(log);
  }
  if(mayClaim||read(legacyOwner)===student&&!read(key))try{if(!read(legacyOwner)||!read(key))claim();}catch{}
  return {
   initial:()=>materialize(log),pendingLegacy,claim,
   snapshot:()=>latest(),
   commit(saved){
    const disk=latest(),projected=project(saved),delta=empty();
    let clock=Date.now();
    for(const f of fields)for(const row of Object.values(disk[f]))clock=Math.max(clock,row[0]+1);
    for(const f of fields)for(const key of new Set([...Object.keys(log[f]),...Object.keys(projected[f])])){
     const old=log[f][key]?.[1]??null,next=projected[f][key]??null;
     if(!equal(old,next))delta[f][key]=[clock,next];
    }
    const combined=merge(disk,delta).log;
    storage.setItem(key,JSON.stringify(combined));log=combined;
    return materialize(log);
   },
   receive(remote){
    const result=merge(latest(),sanitize(remote));
    if(result.changed)storage.setItem(key,JSON.stringify(result.log));
    const redraw=fields.some(f=>!equal(log[f],result.log[f]));log=result.log;
    return {saved:redraw?materialize(log):null,needsUpload:result.needsUpload};
   }
  };
 }
 const api={open,sanitize,size,empty};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.ChapterLabPracticeSync=api;
})(globalThis);

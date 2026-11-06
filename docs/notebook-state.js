(function(root){
 'use strict';
 const subjects=['physics','mathematics','furthermathematics','chemistry','biology','economics'];
 function subjectFromId(id){return subjects.find(subject=>String(id).includes('-'+subject+'-'))||null;}
 function migrate(saved,getSubject=subjectFromId){
  const entries={};
  for(const [id,status] of Object.entries(saved.practice||{})){
   if(!['wrong','correct'].includes(status))continue;
   const existing=saved.notebook?.[id];
   const subject=getSubject(id)||existing?.subject;
   // Older versions kept only practice status, including mastered questions.
   if(subjects.includes(subject)&&(existing||status==='wrong'||!saved.notebook))entries[id]={subject};
  }
  return entries;
 }
 function update(saved,id,result,subject){
  if(!subjects.includes(subject)||!['wrong','correct','clear'].includes(result))return;
  if(result==='clear'){delete saved.practice[id];delete saved.notebook[id];return;}
  saved.practice[id]=result;
  if(result==='wrong'||saved.notebook[id])saved.notebook[id]={subject};
 }
 function summary(saved){
  const result=Object.fromEntries(subjects.map(subject=>[subject,{wrong:0,correct:0,total:0}]));
  for(const [id,entry] of Object.entries(saved.notebook||{})){
   const status=saved.practice[id];
   if(!result[entry.subject]||!['wrong','correct'].includes(status))continue;
   result[entry.subject][status]++;result[entry.subject].total++;
  }
  return result;
 }
 function includes(saved,id,status){return Boolean(saved.notebook?.[id]&&saved.practice[id]===status);}
 function restore(saved,backup,getSubject=subjectFromId){
  for(const [id,status] of Object.entries(backup.practice||{})){
   const subject=getSubject(id);
   if(!subjects.includes(subject)||!['wrong','correct'].includes(status))continue;
   if(status==='wrong'||backup.notebook?.[id]||!backup.notebook)saved.notebook[id]={subject};
   else delete saved.notebook[id];
  }
 }
 const api={subjects,subjectFromId,migrate,update,summary,includes,restore};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.ChapterLabNotebook=api;
})(globalThis);

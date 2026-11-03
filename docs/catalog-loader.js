/* MIT License · Chapter Lab contributors. Fetch metadata only for selected subjects. */
(function(root){
 'use strict';
 function createCatalog(db,fetcher){
  fetcher=fetcher||root.fetch.bind(root);
  const loaded=new Map(),pending=new Map(),ids=new Set(db.questions.map(q=>q.id));
  for(const subject of Object.keys(db.subjectIndex||{})){
   const rows=db.questions.filter(q=>q.subject===subject);
   if(rows.length===db.subjectIndex[subject].count)loaded.set(subject,rows);
  }
  function load(subject){
   if(loaded.has(subject))return Promise.resolve(loaded.get(subject));
   if(pending.has(subject))return pending.get(subject);
   const entry=db.subjectIndex?.[subject];
   if(!entry)return Promise.reject(new Error('Unknown subject'));
   const request=Promise.resolve().then(()=>fetcher(entry.path)).then(async response=>{
    if(!response.ok)throw new Error('Subject metadata is unavailable');
    const rows=await response.json();
    if(!Array.isArray(rows)||rows.length!==entry.count)throw new Error('Incomplete subject metadata');
    const unique=new Set();
    for(const q of rows){
     if(q.subject!==subject||typeof q.id!=='string'||unique.has(q.id))throw new Error('Invalid subject metadata');
     unique.add(q.id);
    }
    for(const q of rows)if(!ids.has(q.id)){db.questions.push(q);ids.add(q.id);}
    loaded.set(subject,rows);return rows;
   }).finally(()=>pending.delete(subject));
   pending.set(subject,request);return request;
  }
  return {load,isLoaded:subject=>loaded.has(subject),loadMany:subjects=>Promise.all([...new Set(subjects)].map(load))};
 }
 const api={createCatalog};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ChapterLabCatalogLoader=api;
})(typeof globalThis!=='undefined'?globalThis:this);

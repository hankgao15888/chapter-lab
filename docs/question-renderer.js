/* MIT License · Chapter Lab contributors. Load and render source PDFs in the visitor's browser. */
(function(root){
 'use strict';
 const documents=new Map(),pending=new Map(),images=new Map(),loadStates=new Map();
 const listeners=new Set(),queue=[];
 let running=0,libraryPromise;
 function notify(q,status,error=''){
  loadStates.set(q.id,{status,error});
  for(const listener of listeners)listener(q.id,{status,error});
 }
 function schedule(work){
  return new Promise((resolve,reject)=>{queue.push({work,resolve,reject});drain();});
 }
 function drain(){
  while(running<2&&queue.length){
   const task=queue.shift();running++;
   Promise.resolve().then(task.work).then(task.resolve,task.reject).finally(()=>{running--;drain();});
  }
 }
 function library(){
  if(!libraryPromise){
   libraryPromise=import(new URL('vendor/pdfjs/pdf.min.mjs',document.baseURI).href).then(pdfjs=>{
    pdfjs.GlobalWorkerOptions.workerSrc=new URL('vendor/pdfjs/pdf.worker.min.mjs',document.baseURI).href;
    return pdfjs;
   }).catch(error=>{libraryPromise=null;throw error;});
  }
  return libraryPromise;
 }
 async function acquire(url){
  if(new URL(url).protocol!=='https:')throw new Error('Invalid source PDF address');
  let entry=documents.get(url);
  if(!entry){
   entry={uses:0,lastUsed:Date.now(),promise:null};
   entry.promise=library().then(async pdfjs=>{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),45000);
    let bytes;
    try{
     const response=await fetch(url,{mode:'cors',credentials:'omit',signal:controller.signal});
     if(!response.ok)throw new Error(`Source PDF returned HTTP ${response.status}`);
     bytes=new Uint8Array(await response.arrayBuffer());
    }finally{clearTimeout(timeout);}
    return pdfjs.getDocument({data:bytes,cMapUrl:new URL('vendor/pdfjs/cmaps/',document.baseURI).href,cMapPacked:true,standardFontDataUrl:new URL('vendor/pdfjs/standard_fonts/',document.baseURI).href,wasmUrl:new URL('vendor/pdfjs/wasm/',document.baseURI).href,isEvalSupported:false}).promise;
   }).catch(error=>{if(documents.get(url)===entry)documents.delete(url);throw error;});
   documents.set(url,entry);
  }
  entry.uses++;entry.lastUsed=Date.now();
  try{return {entry,pdf:await entry.promise};}
  catch(error){entry.uses--;throw error;}
 }
 function release(entry){
  entry.uses--;entry.lastUsed=Date.now();
  const unused=[...documents.entries()].filter(([,item])=>!item.uses).sort((a,b)=>a[1].lastUsed-b[1].lastUsed);
  while(documents.size>6&&unused.length){
   const [url,item]=unused.shift();documents.delete(url);
   item.promise.then(pdf=>pdf.destroy()).catch(()=>{});
  }
 }
 function toBlob(canvas){
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not render question image')),'image/webp',.92));
 }
 async function renderPart(pdf,q,part){
  const key=(q.renderQp||q.qp)+'#'+part.page+':'+part.box.join(',');
  if(images.has(key))return images.get(key);
  const page=await pdf.getPage(part.page),scale=1.75;
  const base=page.getViewport({scale:1});
  const geometry=root.ChapterLabGeometry.cropGeometry(root.ChapterLabGeometry.expandPageStart(part.box),base.width,base.height,scale);
  const canvas=document.createElement('canvas');
  canvas.width=geometry.width;canvas.height=geometry.height;
  try{
   await page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport:page.getViewport({scale}),transform:geometry.transform,background:'rgb(255,255,255)'}).promise;
   const url=URL.createObjectURL(await toBlob(canvas));images.set(key,url);return url;
  }finally{canvas.width=1;canvas.height=1;page.cleanup();}
 }
 async function render(q){
  notify(q,'loading');
  const {entry,pdf}=await acquire(q.renderQp||q.qp);
  try{
   const rendered=[];
   for(const part of q.parts)rendered.push(await renderPart(pdf,q,part));
   if(!q.images.length)q.images=rendered;
   notify(q,'ready');return q.images;
  }finally{release(entry);}
 }
 function load(q){
  if(q.images.length){notify(q,'ready');return Promise.resolve(q.images);}
  if(pending.has(q.id))return pending.get(q.id);
  notify(q,'loading');
  const request=schedule(()=>render(q)).catch(error=>{
   console.warn('Question source PDF could not be rendered',q.id,error);
   notify(q,'error',error.name==='AbortError'?'原卷下载超时，请重试。':'暂时无法读取原卷，请重试或打开原卷检查。');
   throw error;
  }).finally(()=>pending.delete(q.id));
  pending.set(q.id,request);return request;
 }
 root.ChapterLabQuestions={load,state:id=>loadStates.get(id)||{status:'idle',error:''},subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);}};
})(typeof globalThis!=='undefined'?globalThis:this);

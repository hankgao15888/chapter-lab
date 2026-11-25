(function(root){
 'use strict';
 function create(indexedDB){
  if(arguments.length===0){try{indexedDB=root.indexedDB;}catch{indexedDB=null;}}
  let opening;
  function open(){
   if(!indexedDB)return Promise.reject(new Error('浏览器不支持本地 PDF 存储。请使用常规浏览器并允许站点存储。'));
   if(!opening)opening=new Promise((resolve,reject)=>{
    const request=indexedDB.open('chapterlab-pdf-library-v1',1);
    request.onupgradeneeded=()=>{
     const db=request.result;
     const metadata=db.createObjectStore('documents',{keyPath:'id'});metadata.createIndex('owner','owner');
     db.createObjectStore('files',{keyPath:'id'});
    };
    request.onerror=()=>reject(new Error('无法打开本地 PDF 存储，请检查浏览器隐私设置。'));
    request.onblocked=()=>reject(new Error('请关闭本站其他标签页后重试导入 PDF。'));
    request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();opening=null;};resolve(request.result);};
   }).catch(error=>{opening=null;throw error;});
   return opening;
  }
  async function transaction(stores,mode,work){
   const db=await open();
   return new Promise((resolve,reject)=>{
    const tx=db.transaction(stores,mode);let result;
    tx.oncomplete=()=>resolve(typeof result==='function'?result():result);
    tx.onabort=tx.onerror=()=>reject(new Error(tx.error?.name==='QuotaExceededError'?'浏览器存储空间不足，请删除不需要的 PDF 后再导入。':'PDF 保存失败，请检查浏览器存储权限。'));
    try{result=work(tx);}catch(error){tx.abort();reject(error);}
   });
  }
  async function list(owner){return transaction(['documents'],'readonly',tx=>{const req=tx.objectStore('documents').index('owner').getAll(owner);return ()=>req.result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));});}
  async function get(owner,id){
   return transaction(['documents','files'],'readonly',tx=>{
    const meta=tx.objectStore('documents').get(id),file=tx.objectStore('files').get(id);
    return ()=>meta.result?.owner===owner?{...meta.result,blob:file.result?.blob}:null;
   });
  }
  async function save(meta,blob){
   return transaction(['documents','files'],'readwrite',tx=>{tx.objectStore('documents').put(meta);tx.objectStore('files').put({id:meta.id,blob});});
  }
  // Attachments share the existing binary store; document lists never load their bytes.
  const answerKey=(documentId,questionId)=>'question-answer:'+JSON.stringify([documentId,questionId]);
  async function getAnswer(owner,documentId,questionId){
   return transaction(['documents','files'],'readonly',tx=>{
    const document=tx.objectStore('documents').get(documentId);
    let answer;
    document.onsuccess=()=>{
     const meta=document.result;
     if(meta?.owner===owner&&meta.questions.some(question=>question.id===questionId)){
      answer=tx.objectStore('files').get(answerKey(documentId,questionId));
     }
    };
    return ()=>answer?.result?.attachment??null;
   });
  }
  async function setAnswer(owner,documentId,questionId,attachment){
   return transaction(['documents','files'],'readwrite',tx=>{
    const document=tx.objectStore('documents').get(documentId);
    document.onsuccess=()=>{
     const meta=document.result;
     if(meta?.owner!==owner||!meta.questions.some(question=>question.id===questionId)){tx.abort();return;}
     const files=tx.objectStore('files'),id=answerKey(documentId,questionId);
     if(attachment)files.put({id,attachment});
     else files.delete(id);
    };
   });
  }
  async function snapshot(owner,documentId){
   return transaction(['documents','files'],'readonly',tx=>{
    const files=tx.objectStore('files');
    const document=tx.objectStore('documents').get(documentId);
    let file,answers;
    document.onsuccess=()=>{
     const meta=document.result;
     if(meta?.owner!==owner)return;
     file=files.get(documentId);
     answers=meta.questions.map(question=>[question.id,files.get(answerKey(documentId,question.id))]);
    };
    return ()=>file?.result?.blob?{
     metadata:document.result,blob:file.result.blob,
     answers:answers.flatMap(([questionId,request])=>request.result?.attachment?[{questionId,...request.result.attachment}]:[])
    }:null;
   });
  }
  async function restore(owner,{metadata,blob,answers}){
   return transaction(['documents','files'],'readwrite',tx=>{
    const documents=tx.objectStore('documents'),files=tx.objectStore('files');
    const existing=documents.get(metadata.id);let added=false;
    existing.onsuccess=()=>{
     if(existing.result)return;
     documents.put({...metadata,owner});
     files.put({id:metadata.id,blob});
     for(const {questionId,...attachment} of answers)files.put({id:answerKey(metadata.id,questionId),attachment});
     added=true;
    };
    return ()=>added;
   });
  }
  async function update(owner,meta,{discardAnswers=[]}={}){
   return transaction(['documents','files'],'readwrite',tx=>{
    const store=tx.objectStore('documents'),request=store.get(meta.id);
    request.onsuccess=()=>{
     const previous=request.result;
     if(previous?.owner!==owner){tx.abort();return;}
     const retained=new Set(meta.questions.map(question=>question.id));
     const discard=new Set(discardAnswers);
     const files=tx.objectStore('files');
     for(const question of previous.questions){
      if(!retained.has(question.id)||discard.has(question.id))files.delete(answerKey(meta.id,question.id));
     }
     store.put({...meta,owner});
    };
   });
  }
  async function remove(owner,id){
   return transaction(['documents','files'],'readwrite',tx=>{
    const request=tx.objectStore('documents').get(id);
    request.onsuccess=()=>{
     const meta=request.result;
     if(meta?.owner!==owner){tx.abort();return;}
     const files=tx.objectStore('files');
     for(const question of meta.questions)files.delete(answerKey(id,question.id));
     files.delete(id);
     tx.objectStore('documents').delete(id);
    };
   });
  }
  return {list,get,save,update,remove,getAnswer,setAnswer,snapshot,restore};
 }
 const api={create};if(typeof module==='object'&&module.exports)module.exports=api;else root.ChapterLabPDFStore=api;
})(globalThis);

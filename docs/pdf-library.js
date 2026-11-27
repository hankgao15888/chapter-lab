(function(root){
 'use strict';
 function create({chapters,getOwner,getSubject,toast,onImported=()=>{},onChange=()=>{},practiceSync,storage,loadDocument}){
  const $=selector=>document.querySelector(selector),core=root.ChapterLabPDFCore,baseStore=storage||root.ChapterLabPDFStore.create();
  let fileSync;
  const store={...baseStore};
  for(const method of ['save','update','setAnswer'])store[method]=async(...args)=>{
   const result=await baseStore[method](...args);fileSync?.changed();return result;
  };
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const chapterMap=new Map(chapters.map(ch=>[ch.id,ch]));
  let recordsCache=[];
  let regionMode=false,regionDrag=null,regionDraft=null,regionBounds=null,regionEditingId=null,regionVersion=0;
  let stitchParts=[],regionSegment=null,editingPartIndex=0,committingRegion=false,pageReady=false;
  const maxStitchParts=30;
  let viewingOriginal=false,cropDetailsOpen=false;
  let libraryPromise,ownerPromise,current=null,pdf=null,selectedId=null,renderTask=null,renderVersion=0,pageNumber=1,historyVersion=0,opening=0,busy=false;
  const hash=async bytes=>Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  function owner(){if(!ownerPromise)ownerPromise=hash(new TextEncoder().encode('chapterlab-pdf-owner-v1\0'+core.normalize(getOwner())));return ownerPromise;}
  function library(){
   if(!libraryPromise)libraryPromise=import(new URL('vendor/pdfjs/pdf.min.mjs',document.baseURI).href).then(module=>{
    module.GlobalWorkerOptions.workerSrc=new URL('vendor/pdfjs/pdf.worker.min.mjs',document.baseURI).href;return module;
   }).catch(error=>{libraryPromise=null;throw error;});
   return libraryPromise;
  }
  async function loadPDF(bytes){
   const pdfjs=await library();let protectedFile=false;
   const task=pdfjs.getDocument({data:new Uint8Array(bytes),cMapUrl:new URL('vendor/pdfjs/cmaps/',document.baseURI).href,cMapPacked:true,standardFontDataUrl:new URL('vendor/pdfjs/standard_fonts/',document.baseURI).href,wasmUrl:new URL('vendor/pdfjs/wasm/',document.baseURI).href,isEvalSupported:false,enableXfa:false});
   task.onPassword=()=>{protectedFile=true;task.destroy().catch(()=>{});};
   try{const document=await task.promise;return {numPages:document.numPages,getPage:page=>document.getPage(page),destroy:()=>task.destroy()};}catch(error){await task.destroy().catch(()=>{});throw new Error(protectedFile?'PDF 有密码保护，请先解密后导入。':'无法读取这个 PDF，请检查文件是否完整。');}
  }
  const acquirePDF=loadDocument||loadPDF;
  const questionAnswers=root.ChapterLabPDFQuestionAnswers.create({store,owner,loadPDF:acquirePDF,download});
  fileSync=root.ChapterLabFileSync.create({store:baseStore,owner,download,onRestored:renderHistory,canReplace:id=>current?.id!==id,practiceSync});
  function metadata(record){const {blob,...meta}=record;return meta;}
  async function refresh(){recordsCache=await store.list(await owner());onChange();}
  function entries(){return core.questionEntries(recordsCache);}
  function cacheRecord(record){recordsCache=recordsCache.filter(item=>item.id!==record.id).concat(metadata(record));onChange();}
  async function saveCurrent(options){await store.update(await owner(),metadata(current),options);cacheRecord(current);}
  async function setNotebook(documentId,questionId,status){
   if(![null,'wrong','correct'].includes(status))return;
   const record=await store.get(await owner(),documentId),question=record?.questions.find(q=>q.id===questionId);
   if(!question?.savedAt)throw new Error('请先保存这道题。');
   question.notebookStatus=status;await store.update(await owner(),metadata(record));
   if(current?.id===documentId){current.questions=record.questions;fillEditor(current.questions.find(q=>q.id===selectedId));renderQuestions();}
   cacheRecord(record);await renderHistory();
  }
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
  function chapterOptions(subject,selected=[]){return chapters.filter(ch=>ch.subject===subject).map(ch=>`<option value="${esc(ch.id)}" ${selected.includes(ch.id)?'selected':''}>${esc(ch.code)} · ${esc(ch.zh)}</option>`).join('');}
  async function importFiles(files){
   if(busy)return;
   if(!files.length)return;
   if(files.length>10||files.reduce((sum,file)=>sum+file.size,0)>150*1024*1024){toast('每次最多导入 10 个 PDF，总大小不超过 150 MB。');return;}
   busy=true;$('#pdfImportSubject').disabled=true;$('#pdfUploadInput').disabled=true;
   let lastId=null,success=0,failures=0;
   try{
    const account=await owner();
    for(const [index,file] of files.entries()){
     let doc;
     try{
      if(file.size>50*1024*1024)throw new Error('单个 PDF 不能超过 50 MB。');
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(!new TextDecoder('latin1').decode(bytes.slice(0,1024)).includes('%PDF-'))throw new Error('请选择有效的 PDF 文件。');
      const fingerprint=await hash(bytes),id=account+':'+fingerprint;
      const existing=await store.get(account,id);
      if(existing){lastId=id;success++;continue;}
      $('#pdfImportStatus').textContent=`正在读取 ${index+1}/${files.length}：${file.name}`;
      doc=await acquirePDF(bytes.slice());
      if(doc.numPages>300)throw new Error('单份 PDF 最多 300 页，请先拆分后导入。');
      const pages=[];let chars=0,truncated=false;
      for(let page=1;page<=doc.numPages;page++){
       $('#pdfImportStatus').textContent=`${file.name} · 正在识别第 ${page}/${doc.numPages} 页`;
       const source=await doc.getPage(page),viewport=source.getViewport({scale:1});
       let content;
       try{content=await source.getTextContent();}catch{pages.push({page,lines:[]});source.cleanup();continue;}
       const transformed=content.items.map(item=>{
        if(!item.transform)return item;
        const [x,y]=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);
        return {...item,transform:[1,0,0,item.height||10,x,viewport.height-y]};
       });
       let lines=core.linesFromItems(transformed,viewport.width,viewport.height);
       const size=lines.reduce((sum,line)=>sum+line.text.length,0);
       if(chars+size>2000000){lines=[];truncated=true;}else chars+=size;
       pages.push({page,lines});source.cleanup();
      }
      const selected=$('#pdfImportSubject').value;
      const text=pages.map(page=>page.lines.map(line=>line.text).join('\n')).join('\n');
      const subject=core.subjects[selected]?selected:core.inferSubject(file.name,text.slice(0,100000),chapters,getSubject());
      const questions=core.extractQuestions(pages,subject,chapters);
      const scannedPages=pages.filter(page=>page.lines.reduce((sum,line)=>sum+line.text.length,0)<30).length;
      const meta={id,owner:account,fingerprint,title:file.name.replace(/\.pdf$/i,''),filename:file.name,subject,pageCount:doc.numPages,size:file.size,createdAt:new Date().toISOString(),questions,scannedPages,truncated};
      await store.save(meta,new Blob([bytes],{type:'application/pdf'}));
      success++;lastId=id;
     }catch(error){failures++;toast(file.name+'：'+(error.message||'导入失败。'));}
     finally{if(doc)await doc.destroy().catch(()=>{});}
    }
    if(success){$('#pdfImportStatus').textContent=`已保存 ${success} 份 PDF 到「我的练习」${failures?'，另有 '+failures+' 份未导入':''}。`;$('#importDialog').close();onImported();await renderHistory();if(lastId)await openRecord(lastId);}
    else $('#pdfImportStatus').textContent='没有成功保存 PDF，请检查文件后重试。';
   }catch(error){$('#pdfImportStatus').textContent=error.message;toast(error.message);}
   finally{busy=false;$('#pdfImportSubject').disabled=false;$('#pdfUploadInput').disabled=false;$('#pdfUploadInput').value='';}
  }
  async function renderHistory(){
   const version=++historyVersion;
   try{
    const records=await store.list(await owner());
    if(version!==historyVersion)return;
    recordsCache=records;onChange();
    const subject=$('#pdfHistorySubject').value;
    const visible=records.filter(record=>!subject||record.subject===subject);
    $('#pdfHistoryCount').textContent=`${records.length} 份已导入 PDF · 当前显示 ${visible.length} 份`;
    const saved=core.questionEntries(visible);
    $('#pdfSavedQuestionCount').textContent=`${saved.length} 道 · 保存在当前浏览器`;
    $('#pdfSavedQuestionList').innerHTML=saved.map(q=>questionCard(q)).join('')||'<p class="pdf-local-note">拆题后点击「保存这道题」，就会出现在这里；可同时选择收录错题。</p>';
    $('#pdfHistoryList').innerHTML=visible.map(record=>{
     const classified=record.questions.filter(q=>q.chapters.length).length;
     return `<article class="pdf-history-row"><div class="pdf-file-icon" aria-hidden="true">PDF</div><div><button class="pdf-title-button" data-open-pdf="${esc(record.id)}">${esc(record.title)}${record.id.includes(':sync-')?'（同步副本）':''}</button><p>${esc(core.subjects[record.subject])} · ${record.pageCount} 页 · ${record.questions.length} 个题目 / 页面条目 · ${classified} 个有章节</p><small>${record.scannedPages?'含 '+record.scannedPages+' 页扫描或少文字内容，需手动核对':'文字识别与章节为自动建议，可在阅读器调整'}</small></div><div class="pdf-row-actions"><button class="primary" data-open-pdf="${esc(record.id)}">直接查看 →</button><button class="text-button" data-remove-pdf="${esc(record.id)}">删除</button></div></article>`;
    }).join('')||'<div class="empty-state"><strong>还没有导入的 PDF</strong>点击「导入 PDF」，导入后可直接阅读并按章节整理。</div>';
   }catch(error){$('#pdfHistoryCount').textContent='';$('#pdfHistoryList').innerHTML=`<div class="info-box">${esc(error.message)}</div>`;}
  }
  const isCrop=question=>Boolean(question?.parts.every(part=>part.left!==undefined&&part.right!==undefined));
  function pageRange(parts){
   const pages=parts.map(part=>part.page);
   return [Math.min(...pages),Math.max(...pages)];
  }
  function pageLabel(parts){
   const [first,last]=pageRange(parts);
   return '第 '+first+(first===last?'':'–'+last)+' 页';
  }
  function renderQuestions(){
   if(!current)return;
   const chapter=$('#pdfChapterFilter').value,type=$('#pdfTypeFilter').value,term=core.normalize($('#pdfQuestionSearch').value);
   const questions=current.questions.filter(q=>(!chapter||(chapter==='unmapped'?!q.chapters.length:q.chapters.includes(chapter)))&&(!type||q.type===type)&&(!term||core.normalize(q.label+' '+q.text+' '+q.chapters.map(id=>chapterMap.get(id)?.zh||'').join(' ')).includes(term)));
   $('#pdfQuestionCount').textContent=`共 ${current.questions.length} 个条目 · 当前 ${questions.length} 个`;
   $('#pdfQuestionList').innerHTML=questions.map(q=>`<button type="button" class="pdf-question-item ${q.id===selectedId?'selected':''}" data-select-pdf-question="${esc(q.id)}"><strong>${esc(q.label)}</strong><small>${pageLabel(q.parts)} · ${esc(core.types[q.type])}</small><span>${q.chapters.length?q.chapters.map(id=>esc(chapterMap.get(id)?.zh||id)).join(' / '):'待归类'}</span><em>${q.savedAt?'已保存单题'+(q.notebookStatus==='wrong'?' · 待掌握':q.notebookStatus==='correct'?' · 已掌握':''):q.reviewed?'已人工核对':q.manual?'待手动拆题':'自动建议，待核对'}</em></button>`).join('')||'<p class="pdf-empty">当前筛选没有题目，可清除筛选或手动新增题目。</p>';
  }
  function fillEditor(question){
   $('#pdfQuestionEditor').classList.toggle('hidden',!question||Boolean(stitchParts.length));if(!question)return;
   const cropped=isCrop(question);
   $('#pdfQuestionPages').hidden=cropped;
   $('#pdfQuestionBounds').hidden=cropped;
   $('#pdfSplitTools').hidden=cropped;
   $('#pdfQuestionLabel').value=question.label;
   $('#pdfStartPercent').value=Number((question.parts[0].top*100).toFixed(1));$('#pdfEndPercent').value=Number((question.parts.at(-1).bottom*100).toFixed(1));
   $('#pdfSaveToNotebook').checked=Boolean(question.notebookStatus);
   $('#pdfQuestionSaveStatus').textContent=question.savedAt?'已保存到「我的练习」'+(question.notebookStatus==='wrong'?' · 已收录，待掌握':question.notebookStatus==='correct'?' · 错题本中已掌握':' · 未收录错题'):'尚未保存为单题，核对后点击下方保存。';
   const [first,last]=pageRange(question.parts);
   $('#pdfFirstPage').value=first;
   $('#pdfLastPage').value=last;
   $('#pdfQuestionType').value=question.type;$('#pdfQuestionText').value=question.text;
   $('#pdfQuestionChapters').innerHTML=chapterOptions(current.subject,question.chapters);
   $('#pdfClassificationReason').textContent=question.reviewed?'已人工核对，可继续调整。':question.matchedKeywords?.length?'建议依据：'+question.matchedKeywords.join('、'):'没有足够的文字线索，请手动选择章节。';
  }
  async function selectQuestion(id){
   resetStitch();
   const question=current?.questions.find(q=>q.id===id);if(!question)return;
   viewingOriginal=false;
   cropDetailsOpen=false;
   selectedId=id;pageNumber=question.parts[0].page;setRegionMode(!isCrop(question));fillEditor(question);fillCropPicker(question);renderQuestions();await renderPage();
  }
  function fillCropPicker(question){
   const stitched=isCrop(question)&&question.parts.length>1;
   $('#pdfCropTitle').textContent=stitched?`本题截图 · 已拼接 ${question.parts.length} 段`:'本题截图';
   $('#pdfCropPartPicker').hidden=!stitched;
   $('#pdfCropPart').innerHTML=stitched?question.parts.map((part,index)=>`<option value="${index}">第 ${index+1} 段 · 第 ${part.page} 页</option>`).join(''):'';
   $('#pdfCropPart').value='0';
  }
  function copyCanvas(source,target){
   target.width=source.width;
   target.height=source.height;
   target.getContext('2d').drawImage(source,0,0);
  }
  async function stitchCanvas(pdfDocument,parts,maxWidth,isCurrent){
   const regions=[];
   for(const part of parts){
    if(!isCurrent())return null;
    const page=await pdfDocument.getPage(part.page);
    const viewport=page.getViewport({scale:1});
    regions.push({part,page,width:(part.right-part.left)*viewport.width,height:(part.bottom-part.top)*viewport.height});
   }
   // Keep a common PDF scale so different crop widths retain their relative sizes.
   const gap=10;
   const maxHeight=8192;
   const width=Math.max(...regions.map(region=>region.width));
   const height=regions.reduce((total,region)=>total+region.height,0);
   const scale=Math.min(maxWidth/width,(maxHeight-(regions.length-1)*gap-regions.length)/height,3);
   const result=document.createElement('canvas');
   result.width=Math.ceil(width*scale);
   result.height=regions.reduce((total,region)=>total+Math.ceil(region.height*scale),0)+(regions.length-1)*gap;
   const context=result.getContext('2d',{alpha:false});
   context.fillStyle='#fff';
   context.fillRect(0,0,result.width,result.height);
   const scratch=document.createElement('canvas');
   let offset=0;
   try{
    for(const {part,page,width,height} of regions){
     if(!isCurrent())return null;
     const viewport=page.getViewport({scale});
     scratch.width=Math.ceil(width*scale);
     scratch.height=Math.ceil(height*scale);
     const transform=[1,0,0,1,-part.left*viewport.width,-part.top*viewport.height];
     try{
      await page.render({canvasContext:scratch.getContext('2d',{alpha:false}),viewport,transform,background:'#fff'}).promise;
     }finally{page.cleanup();}
     if(!isCurrent())return null;
     context.drawImage(scratch,0,offset);
     offset+=scratch.height+gap;
    }
    return result;
   }finally{scratch.width=1;scratch.height=1;}
  }
  async function renderPage(){
   cancelRegion();pageReady=false;$('#pdfDownloadCrop').disabled=true;
   updateReaderView();
   const version=++renderVersion;
   if(renderTask){renderTask.cancel();await renderTask.promise.catch(()=>{});}
   if(version!==renderVersion||!pdf||!current)return;
   const documentToRender=pdf;
   $('#pdfPageStatus').textContent='正在显示第 '+pageNumber+' 页…';
   try{
    const page=await documentToRender.getPage(pageNumber);
    if(version!==renderVersion){page.cleanup();return;}
    const base=page.getViewport({scale:1}),host=$('#pdfCanvasHost');
    const width=Math.max(260,Math.min(1200,host.clientWidth||$('.pdf-reader-main').clientWidth||800)-24);
    const zoom=Number($('#pdfZoom').value)||1;
    const scale=Math.min(width/base.width*zoom*Math.min(root.devicePixelRatio||1,2),3000/base.width,4000/base.height);
    const viewport=page.getViewport({scale}),canvas=$('#pdfCanvas');
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.style.width=Math.round(width*zoom)+'px';canvas.style.maxWidth='none';
    $('#pdfPageFrame').style.width=canvas.style.width;
    const task=page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport,background:'rgb(255,255,255)'});renderTask=task;
    try{await task.promise;}finally{if(renderTask===task)renderTask=null;page.cleanup();}
    if(version!==renderVersion)return;
    $('#pdfPageNumber').value=pageNumber;$('#pdfPageTotal').textContent='/ '+current.pageCount;
    $('#pdfPagePrevious').disabled=pageNumber<=1;$('#pdfPageNext').disabled=pageNumber>=current.pageCount;
    const question=current.questions.find(q=>q.id===selectedId),part=question?.parts.find(part=>part.page===pageNumber);
    const highlight=$('#pdfQuestionHighlight');highlight.hidden=!part;
    if(part){highlight.style.left=((part.left||0)*100)+'%';highlight.style.right=((1-(part.right??1))*100)+'%';highlight.style.top=(part.top*100)+'%';highlight.style.height=((part.bottom-part.top)*100)+'%';}
    pageReady=true;
    const showCrop=showingCrop(question);
    const crop=$('#pdfCropCanvas');
    if(showCrop&&question.parts.length>1){
     const stitched=await stitchCanvas(documentToRender,question.parts,1440,()=>version===renderVersion&&showingCrop(question));
     if(!stitched)return;
     copyCanvas(stitched,crop);
     crop.style.width=Math.min(stitched.width,1100)+'px';
    }else if(showCrop){
     const left=part.left*canvas.width,top=part.top*canvas.height,width=(part.right-part.left)*canvas.width,height=(part.bottom-part.top)*canvas.height;
     crop.width=Math.max(1,Math.round(width));crop.height=Math.max(1,Math.round(height));crop.getContext('2d').drawImage(canvas,left,top,width,height,0,0,crop.width,crop.height);
     crop.style.width=Math.min(width,1100)+'px';crop.style.maxWidth='100%';
    }
    $('#pdfDownloadCrop').disabled=!showCrop;
    updateReaderView();
    const pageStatus='第 '+pageNumber+' / '+current.pageCount+' 页';
    $('#pdfPageStatus').textContent=(viewingOriginal?'原试卷 · ':'')+pageStatus+(part?' · '+question.label:'');
   }catch(error){if(version===renderVersion&&error.name!=='RenderingCancelledException')$('#pdfPageStatus').textContent='页面读取失败，请重试切换页码。';}
  }
  async function cleanup(){
   viewingOriginal=false;
   cropDetailsOpen=false;
   resetStitch();setRegionMode(false);pageReady=false;
   ++opening;++renderVersion;
   if(renderTask){renderTask.cancel();await renderTask.promise.catch(()=>{});renderTask=null;}
   const old=pdf;pdf=null;current=null;selectedId=null;if(old)await old.destroy().catch(()=>{});
   const canvas=$('#pdfCanvas');canvas.width=1;canvas.height=1;
  }
  async function openRecord(id,questionId){
   await cleanup();const version=++opening;
   try{
    const record=await store.get(await owner(),id);if(version!==opening)return;
    if(!record?.blob)throw new Error('找不到已保存的 PDF，请重新导入。');
    const documentToOpen=await acquirePDF(await record.blob.arrayBuffer());
    if(version!==opening){await documentToOpen.destroy();return;}
    current=record;pdf=documentToOpen;pageNumber=1;
    $('#pdfViewerTitle').textContent=record.title;$('#pdfDocumentSubject').value=record.subject;
    $('#pdfChapterFilter').innerHTML='<option value="">全部章节</option><option value="unmapped">待归类</option>'+chapterOptions(record.subject);
    $('#pdfTypeFilter').value='';$('#pdfQuestionSearch').value='';$('#pdfZoom').value='1';
    $('#pdfAnalysisNote').textContent=(record.scannedPages?'含扫描或少文字页面，可直接阅读并手动拆题。':'自动拆题和章节匹配仅为建议，请对照原 PDF 核对。')+(record.truncated?'部分文字过长未参与识别。':'');
    $('#pdfSplitLine').hidden=true;
    if(!$('#pdfViewerDialog').open)$('#pdfViewerDialog').showModal();
    if(record.questions[0])await selectQuestion(record.questions.some(q=>q.id===questionId)?questionId:record.questions[0].id);else{setRegionMode(true);fillEditor(null);renderQuestions();await renderPage();}
   }catch(error){toast(error.message||'PDF 打开失败。');}
  }
  $('#pdfUploadInput').onchange=event=>importFiles([...event.target.files]);
  $('#pdfUploadHistory').onclick=()=>$('#importDialog').showModal();
  $('#importFolderChoice').onclick=()=>{$('#importDialog').close();$('#localBankInput').click();};
  $('#pdfHistorySubject').onchange=renderHistory;
  $('#pdfHistoryList').onclick=async event=>{
   const open=event.target.closest('[data-open-pdf]');if(open){await openRecord(open.dataset.openPdf);return;}
   const remove=event.target.closest('[data-remove-pdf]');if(remove&&root.confirm('删除这份 PDF 及其本地分类记录？')){
    try{await store.remove(await owner(),remove.dataset.removePdf);await refresh();await renderHistory();toast('已删除本地 PDF。');}catch(error){toast(error.message);}
   }
  };
  $('#pdfQuestionList').onclick=event=>{
   const button=event.target.closest('[data-select-pdf-question]');
   if(!button||committingRegion)return;
   if(stitchParts.length){toast('请先完成拼接，或点击「清空拼接」。');return;}
   selectQuestion(button.dataset.selectPdfQuestion);
  };
  ['pdfChapterFilter','pdfTypeFilter'].forEach(id=>$('#'+id).onchange=renderQuestions);$('#pdfQuestionSearch').oninput=renderQuestions;
  function goToPage(requestedPage){
   if(!current)return;
   const nextPage=Math.max(1,Math.min(current.pageCount,Math.floor(Number(requestedPage))||1));
   if(viewingOriginal&&pageNumber!==nextPage)$('#pdfCanvasHost').scrollTop=0;
   pageNumber=nextPage;
   return renderPage();
  }
  $('#pdfPagePrevious').onclick=()=>goToPage(pageNumber-1);
  $('#pdfPageNext').onclick=()=>goToPage(pageNumber+1);
  $('#pdfPageNumber').onchange=()=>goToPage($('#pdfPageNumber').value);
  $('#pdfZoom').onchange=renderPage;
  $('#pdfCropDetails').onclick=()=>{
   const question=current?.questions.find(q=>q.id===selectedId);
   if(!showingCrop(question))return;
   cropDetailsOpen=!cropDetailsOpen;
   updateReaderView();
   if(cropDetailsOpen)$('#pdfQuestionLabel').focus();
  };
  $('#pdfViewOriginal').onclick=async()=>{
   const question=current?.questions.find(q=>q.id===selectedId);
   if(!isCrop(question)||viewingOriginal)return;
   viewingOriginal=true;
   cropDetailsOpen=false;
   pageNumber=question.parts[0].page;
   $('#pdfCanvasHost').scrollTop=0;
   await renderPage();
   if(viewingOriginal&&selectedId===question.id)$('#pdfBackToCrop').focus({preventScroll:true});
  };
  $('#pdfBackToCrop').onclick=async()=>{
   const question=current?.questions.find(q=>q.id===selectedId);
   if(!viewingOriginal||!isCrop(question))return;
   if(stitchParts.length){toast('请先完成拼接，或点击「清空拼接」。');return;}
   viewingOriginal=false;
   pageNumber=question.parts[0].page;
   setRegionMode(false);
   await renderPage();
   if(!viewingOriginal&&selectedId===question.id)$('#pdfViewOriginal').focus({preventScroll:true});
  };
  $('#pdfDocumentSubject').onchange=async()=>{
   if(!current)return;
   if(committingRegion){$('#pdfDocumentSubject').value=current.subject;return;}cancelRegion();const subject=$('#pdfDocumentSubject').value;if(!core.subjects[subject])return;
   const previous=current.subject,questions=current.questions;
   current.subject=subject;current.questions=current.questions.map(q=>({...q,...core.classify(q.text,subject,chapters),reviewed:false}));
   try{await saveCurrent();$('#pdfChapterFilter').innerHTML='<option value="">全部章节</option><option value="unmapped">待归类</option>'+chapterOptions(subject);fillEditor(current.questions.find(q=>q.id===selectedId));renderQuestions();await renderHistory();toast('科目已更新，章节已重新建议。');}
   catch(error){current.subject=previous;current.questions=questions;$('#pdfDocumentSubject').value=previous;toast(error.message);}
  };
  $('#pdfSaveQuestion').onclick=async()=>{
   if(!current||committingRegion)return;
   const old=current.questions.find(q=>q.id===selectedId);if(!old)return;
   try{
    const edit=core.validateEdit({number:$('#pdfQuestionLabel').value,firstPage:$('#pdfFirstPage').value,lastPage:$('#pdfLastPage').value,type:$('#pdfQuestionType').value,text:$('#pdfQuestionText').value,chapters:[...$('#pdfQuestionChapters').selectedOptions].map(option=>option.value)},current.subject,chapters,current.pageCount);
    if(isCrop(old))edit.parts=old.parts;
    else{
     const samePages=edit.parts[0].page===old.parts[0].page&&edit.parts.at(-1).page===old.parts.at(-1).page;
     edit.parts=core.editBounds(samePages?old.parts:edit.parts,$('#pdfStartPercent').value,$('#pdfEndPercent').value);
    }
    edit.savedAt=old.savedAt||new Date().toISOString();
    edit.notebookStatus=$('#pdfSaveToNotebook').checked?(old.notebookStatus||'wrong'):null;
    const updated={...old,...edit};const previous=current.questions;
    current.questions=current.questions.map(q=>q.id===selectedId?updated:q);
    try{await saveCurrent();}catch(error){current.questions=previous;throw error;}
    const returnToCrop=showingCrop(updated)&&cropDetailsOpen;
    cropDetailsOpen=false;
    renderQuestions();fillEditor(updated);await renderHistory();await renderPage();
    if(returnToCrop&&selectedId===updated.id&&showingCrop(updated))$('#pdfCropDetails').focus({preventScroll:true});
    toast(updated.notebookStatus?'单题已保存，并已收录到错题本。':'单题已保存到「我的练习」。');
   }catch(error){toast(error.message);}
  };
  $('#pdfSuggestQuestion').onclick=()=>{
   if(!current)return;
   const text=$('#pdfQuestionText').value,suggestion=core.classify(text,current.subject,chapters);
   $('#pdfQuestionChapters').innerHTML=chapterOptions(current.subject,suggestion.chapters);
   $('#pdfQuestionType').value=core.questionType(text);
   $('#pdfClassificationReason').textContent=suggestion.matchedKeywords.length?'建议依据：'+suggestion.matchedKeywords.join('、')+'。核对后请点击保存。':'没有足够的匹配线索，请手动选择章节后保存。';
  };
  $('#pdfAddQuestion').onclick=async()=>{
   if(!current||committingRegion)return;
   if(stitchParts.length){toast('请先完成拼接，或点击「清空拼接」。');return;}
   const previous=current.questions;
   const question={id:'manual-'+root.crypto.randomUUID(),label:'新题目',number:null,parts:[{page:pageNumber,top:0,bottom:1}],text:'',chapters:[],type:'other',reviewed:false,manual:true};
   current.questions=[...current.questions,question];
   try{await saveCurrent();$('#pdfChapterFilter').value='';$('#pdfTypeFilter').value='';$('#pdfQuestionSearch').value='';await selectQuestion(question.id);await renderHistory();$('#pdfQuestionLabel').focus();toast('已新增题目，请填写页码和章节后保存。');}
   catch(error){current.questions=previous;toast(error.message);}
  };
  $('#pdfDeleteQuestion').onclick=async()=>{
   if(!current||!selectedId||committingRegion||!root.confirm('删除这道题及其错题记录？PDF 原文件会保留。'))return;
   const previous=current.questions;current.questions=current.questions.filter(q=>q.id!==selectedId);
   try{await saveCurrent();selectedId=null;fillEditor(null);renderQuestions();await renderHistory();await renderPage();}
   catch(error){current.questions=previous;toast(error.message);}
  };
  function questionCard(q,notebook=false){
   const status=q.notebookStatus;
   return `<article class="pdf-saved-question"><div><span class="badge">本地 PDF · ${esc(core.subjects[q.subject])}</span><h3>${esc(q.label)}</h3><small>${esc(q.title)}${q.documentId.includes(':sync-')?'（同步副本）':''} · ${pageLabel(q.parts)} · ${esc(core.types[q.type])}</small><p>${q.chapters.map(id=>esc(chapterMap.get(id)?.zh||id)).join(' / ')||'待归类'}</p><pre>${esc(q.text.slice(0,500)||'扫描题目，请打开原题查看。')}</pre></div><div class="pdf-row-actions"><button class="primary" data-pdf-open-question="${esc(q.questionId)}" data-pdf-document="${esc(q.documentId)}">查看这道题 →</button><button data-pdf-status="${status?'remove':'wrong'}" data-pdf-question="${esc(q.questionId)}" data-pdf-document="${esc(q.documentId)}">${status?'移出错题本':'＋ 收录错题'}</button>${status?`<button data-pdf-status="${status==='correct'?'wrong':'correct'}" data-pdf-question="${esc(q.questionId)}" data-pdf-document="${esc(q.documentId)}">${status==='correct'?'↺ 仍需复习':'✓ 我已掌握'}</button>`:''}</div></article>`;
  }
  async function handleAction(event){
   const button=event.target.closest('[data-pdf-open-question], [data-pdf-status]');if(!button)return;
   if(button.dataset.pdfOpenQuestion){await openRecord(button.dataset.pdfDocument,button.dataset.pdfOpenQuestion);return;}
   button.disabled=true;
   try{await setNotebook(button.dataset.pdfDocument,button.dataset.pdfQuestion,button.dataset.pdfStatus==='remove'?null:button.dataset.pdfStatus);toast(button.dataset.pdfStatus==='correct'?'已移至已掌握。':button.dataset.pdfStatus==='remove'?'已移出错题本，单题仍保留。':'已收录到待掌握。');}catch(error){toast(error.message);}finally{button.disabled=false;}
  }
  $('#pdfSavedQuestionList').onclick=handleAction;
  $('#pdfSplitPercent').oninput=()=>{const value=Number($('#pdfSplitPercent').value);$('#pdfSplitLine').hidden=!Number.isFinite(value)||value<0||value>100;$('#pdfSplitLine').style.top=value+'%';};
  // Screenshot selection owns pointer interaction; full-width splitting is confined to advanced controls.
  function setRegionMode(enabled){
   regionMode=enabled;$('#pdfRegionMode').setAttribute('aria-pressed',String(enabled));$('#pdfPageFrame').classList.toggle('pdf-region-mode',enabled);
   $('#pdfRegionStatus').textContent=enabled?'拖动鼠标画截图框；拉边角调整大小，拖动框内移动；按 Esc 取消。':'点击「截图框选」在原页画方框。';
   if(enabled)$('#pdfSplitLine').hidden=true;
   updateReaderView();
  }
  function showingCrop(question){
   return !viewingOriginal&&!regionMode&&isCrop(question)&&(question.parts[0].page===pageNumber||question.parts.length>1);
  }
  function updateReaderView(){
   const question=current?.questions.find(q=>q.id===selectedId);
   const showCrop=showingCrop(question);
   const showDetails=showCrop&&cropDetailsOpen;
   $('#pdfReaderGrid').classList.toggle('pdf-crop-only',showCrop);
   $('#pdfReaderSidebar').hidden=showCrop&&!showDetails;
   $('#pdfQuestionDirectory').hidden=showCrop;
   $('#pdfViewerHeading').hidden=showCrop;
   $('#pdfRegionToolbar').hidden=showCrop;
   $('#pdfCropDetails').setAttribute('aria-expanded',String(showDetails));
   $('#pdfCropDetails').textContent=showDetails?'收起编辑':question?.savedAt?'编辑题目':'保存 / 编辑题目';
   $('#pdfCropView').hidden=!showCrop;
   $('#pdfCanvasHost').hidden=showCrop;
   $('#pdfPageToolbar').hidden=showCrop;
   $('#pdfBackToCrop').hidden=!viewingOriginal||!isCrop(question);
   $('#pdfQuestionAnswer').hidden=!question;
  }
  function cancelRegion(){
   ++regionVersion;
   const pointer=regionDrag?.pointerId;regionDrag=null;regionDraft=null;regionSegment=null;regionBounds=null;regionEditingId=null;
   if(pointer!==undefined&&$('#pdfPageFrame').hasPointerCapture?.(pointer))$('#pdfPageFrame').releasePointerCapture(pointer);
   $('#pdfRegionBox').hidden=true;$('#pdfRegionReview').hidden=true;$('#pdfQuestionEditor').classList.toggle('hidden',Boolean(stitchParts.length)||!current?.questions.some(q=>q.id===selectedId));$('#pdfCancelRegion').disabled=true;$('#pdfConfirmRegion').disabled=false;$('#pdfConfirmRegion').textContent='确认框选，建立题目';
   const preview=$('#pdfRegionPreview');preview.width=1;preview.height=1;
   updateStitchControls();
  }
  function point(event){
   const bounds=$('#pdfCanvas').getBoundingClientRect();
   return {x:Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width)),y:Math.max(0,Math.min(1,(event.clientY-bounds.top)/bounds.height))};
  }
  function drawRegion(region){
   regionBounds={...region};const box=$('#pdfRegionBox');box.hidden=false;box.style.left=region.left*100+'%';box.style.top=region.top*100+'%';box.style.width=(region.right-region.left)*100+'%';box.style.height=(region.bottom-region.top)*100+'%';
  }
  function updateStitchControls(){
   const count=stitchParts.length;
   $('#pdfStitchQueue').hidden=!count;
   $('#pdfStitchCount').textContent=`已加入 ${count} 段 · 按加入顺序从上到下拼接`;
   $('#pdfStitchParts').innerHTML=stitchParts.map(({part},index)=>`<li>第 ${part.page} 页 <button class="text-button" type="button" data-remove-stitch="${index}" aria-label="移除片段 ${index+1}">移除</button></li>`).join('');
   $('#pdfAddStitchPart').hidden=!regionSegment||Boolean(regionEditingId);
   $('#pdfAddStitchPart').disabled=committingRegion||count>=maxStitchParts;
   $('#pdfReviewStitch').disabled=committingRegion||Boolean(regionBounds);
   $('#pdfClearStitch').disabled=committingRegion;
  }
  function resetStitch(){
   stitchParts=[];
   cancelRegion();
  }
  function fillRegionReview(draft,buttonLabel,reason){
   regionDraft=draft;
   $('#pdfConfirmRegion').textContent=buttonLabel;
   $('#pdfRegionLabel').value=draft.label;
   $('#pdfRegionChapters').innerHTML=chapterOptions(current.subject,draft.chapters);
   $('#pdfRegionType').value=draft.type;
   $('#pdfRegionText').value=draft.text;
   $('#pdfRegionReason').textContent=reason;
   $('#pdfRegionReview').hidden=false;
   $('#pdfQuestionEditor').classList.toggle('hidden',true);
  }
  function classificationReason(draft){
   if(!draft.text)return '没有可提取文字，可按截图手动分类。';
   return draft.matchedKeywords?.length?'建议依据：'+draft.matchedKeywords.join('、')+'。章节和题型均可修改。':'暂未匹配到章节，可手动选择。';
  }
  async function recognizeRegion(region,page){
   const version=++regionVersion,record=current,documentToRead=pdf;
   $('#pdfRegionStatus').textContent='正在读取框内文字并建议章节…';
   try{
    const source=await documentToRead.getPage(page),viewport=source.getViewport({scale:1});
    let text='';
    try{const content=await source.getTextContent();text=core.regionText(content.items,viewport,region);}catch{}finally{source.cleanup();}
    if(version!==regionVersion||current!==record||pageNumber!==page)return;
    const editing=current.questions.find(q=>q.id===regionEditingId);
    let draft=core.regionQuestion(region,page,text,current.subject,chapters,editing?.id||'manual-'+root.crypto.randomUUID());
    if(editing){
     const parts=editing.parts.map((part,index)=>index===editingPartIndex?draft.parts[0]:part);
     draft={...editing,parts};
     if(parts.length===1)draft={...draft,text};
    }
    const canvas=$('#pdfCanvas'),preview=$('#pdfRegionPreview'),width=(region.right-region.left)*canvas.width,height=(region.bottom-region.top)*canvas.height,scale=Math.min(1,600/width);
    preview.width=Math.max(1,Math.round(width*scale));preview.height=Math.max(1,Math.round(height*scale));
    preview.getContext('2d').drawImage(canvas,region.left*canvas.width,region.top*canvas.height,width,height,0,0,preview.width,preview.height);
    regionSegment={part:{page,...region},text};
    if(!stitchParts.length)fillRegionReview(draft,editing?'确认调整，更新截图':'确认框选，建立题目',classificationReason(draft));
    updateStitchControls();
    $('#pdfRegionStatus').textContent=stitchParts.length?'点击「加入拼接」收录当前框选，然后继续截图或预览拼接。':'可调整方框。跨页题请点击「加入拼接」，单段题可直接确认。';
   }catch(error){if(version===regionVersion){$('#pdfRegionStatus').textContent='框选识别失败，请取消后重试。';toast(error.message||'框选识别失败。');}}
  }
  $('#pdfAddStitchPart').onclick=()=>{
   if(!regionSegment||regionEditingId||committingRegion||stitchParts.length>=maxStitchParts)return;
   const text=regionDraft?$('#pdfRegionText').value:regionSegment.text;
   stitchParts.push({...regionSegment,text});
   cancelRegion();
   $('#pdfRegionStatus').textContent=stitchParts.length===maxStitchParts?'已达到 30 段，请预览拼接。':'已加入。继续框选下一段，或点击「预览拼接」。';
  };
  $('#pdfStitchParts').onclick=event=>{
   const button=event.target.closest('[data-remove-stitch]');
   if(!button||committingRegion)return;
   stitchParts.splice(Number(button.dataset.removeStitch),1);
   cancelRegion();
   $('#pdfRegionStatus').textContent='已移除片段，可继续框选。';
  };
  $('#pdfClearStitch').onclick=()=>{
   if(committingRegion)return;
   resetStitch();
   $('#pdfRegionStatus').textContent='已清空拼接，可重新框选。';
  };
  $('#pdfReviewStitch').onclick=async()=>{
   if(!current||!stitchParts.length||regionBounds||committingRegion)return;
   cancelRegion();
   const version=regionVersion;
   const reviewIsCurrent=()=>version===regionVersion;
   const parts=stitchParts.map(segment=>segment.part);
   const text=stitchParts.map(segment=>segment.text.trim()).filter(Boolean).join('\n\n').slice(0,20000);
   const draft=core.regionQuestion(parts[0],parts[0].page,text,current.subject,chapters,'manual-'+root.crypto.randomUUID());
   draft.parts=parts;
   draft.label=parts.length>1?'拼接题目':'框选题目';
   $('#pdfRegionStatus').textContent='正在生成拼接预览…';
   try{
    const preview=await stitchCanvas(pdf,parts,600,reviewIsCurrent);
    if(!preview)return;
    copyCanvas(preview,$('#pdfRegionPreview'));
    fillRegionReview(draft,'确认拼接，建立题目',classificationReason(draft));
    $('#pdfRegionStatus').textContent=`已拼接 ${parts.length} 段。请核对预览、章节和题型。`;
    $('#pdfRegionReview').scrollIntoView({block:'nearest'});
   }catch(error){if(reviewIsCurrent()){toast(error.message||'拼接预览失败，请重试。');$('#pdfRegionStatus').textContent='拼接预览失败，请重试。';}}
  };
  async function editCrop(){
   const question=current?.questions.find(q=>q.id===selectedId);
   const index=Number($('#pdfCropPart').value)||0;
   const part=question?.parts[index];
   if(part?.left===undefined)return;
   cropDetailsOpen=false;
   setRegionMode(true);
   pageNumber=part.page;
   await renderPage();
   if(current?.questions.find(q=>q.id===selectedId)!==question||!pageReady||pageNumber!==part.page||!regionMode)return;
   regionEditingId=question.id;
   editingPartIndex=index;
   const {left,right,top,bottom}=part;
   drawRegion({left,right,top,bottom});
   $('#pdfCancelRegion').disabled=false;
   await recognizeRegion({left,right,top,bottom},pageNumber);
  }
  $('#pdfEditCrop').onclick=editCrop;
  $('#pdfRegionMode').onclick=()=>{
   if(stitchParts.length){toast('请先完成拼接，或点击「清空拼接」。');return;}
   cancelRegion();
   setRegionMode(!regionMode);
   if(!regionMode)return renderPage();
  };
  $('#pdfDownloadCrop').onclick=()=>{
   if($('#pdfCropView').hidden||$('#pdfDownloadCrop').disabled)return;
   const name=(current?.questions.find(q=>q.id===selectedId)?.label||'题目截图')+'.png';
   $('#pdfCropCanvas').toBlob(blob=>{if(blob)download(blob,name);else toast('截图导出失败，请重试。');},'image/png');
  };
  $('#pdfCancelRegion').onclick=()=>{cancelRegion();$('#pdfRegionStatus').textContent='已取消框选，未修改原有题目。可以重新拖动框选。';};
  $('#pdfPageFrame').onpointerdown=event=>{
   if(!regionMode||!current||!pdf||!pageReady||committingRegion||renderTask||(event.button!==undefined&&event.button!==0)||event.isPrimary===false)return;
   event.preventDefault();const start=point(event);if(!Number.isFinite(start.x)||!Number.isFinite(start.y))return;
   const handle=event.target?.closest?.('[data-region-handle]')?.dataset.regionHandle;
   const inside=event.target?.closest?.('#pdfRegionBox');
   const previous=regionBounds?{...regionBounds}:null,kind=previous&&(handle||inside)?handle||'move':'draw';
   if(kind==='draw'){const editing=regionEditingId;cancelRegion();regionEditingId=editing;}else{++regionVersion;regionDraft=null;regionSegment=null;updateStitchControls();$('#pdfRegionReview').hidden=true;$('#pdfConfirmRegion').disabled=true;}
   regionDrag={kind,original:previous,start,end:start,page:pageNumber,pointerId:event.pointerId};$('#pdfPageFrame').setPointerCapture?.(event.pointerId);$('#pdfCancelRegion').disabled=false;
  };
  function draggedRegion(drag,end){
   return drag.kind==='draw'?core.rectangle(drag.start,end):core.adjustRectangle(drag.original,drag.kind,drag.start,end);
  }
  $('#pdfPageFrame').onpointermove=event=>{
   if(!regionDrag||event.pointerId!==regionDrag.pointerId)return;event.preventDefault();regionDrag.end=point(event);
   if(regionDrag.kind==='draw'){const {start,end}=regionDrag;drawRegion({left:Math.min(start.x,end.x),right:Math.max(start.x,end.x),top:Math.min(start.y,end.y),bottom:Math.max(start.y,end.y)});}
   else drawRegion(draggedRegion(regionDrag,regionDrag.end));
  };
  $('#pdfPageFrame').onpointerup=async event=>{
   if(!regionDrag||event.pointerId!==regionDrag.pointerId)return;event.preventDefault();
   const drag=regionDrag;regionDrag=null;if($('#pdfPageFrame').hasPointerCapture?.(event.pointerId))$('#pdfPageFrame').releasePointerCapture(event.pointerId);
   try{const region=draggedRegion(drag,point(event));drawRegion(region);await recognizeRegion(region,drag.page);$('#pdfConfirmRegion').disabled=false;}catch(error){cancelRegion();$('#pdfRegionStatus').textContent=error.message;}
  };
  $('#pdfPageFrame').onpointercancel=()=>cancelRegion();
  $('#pdfPageFrame').onlostpointercapture=()=>{if(regionDrag)cancelRegion();};
  $('#pdfViewerDialog').addEventListener('cancel',event=>{if(regionMode||regionDraft||regionDrag){event.preventDefault();cancelRegion();if(!stitchParts.length){setRegionMode(false);renderPage();}}});
  $('#pdfViewerDialog').addEventListener('keydown',event=>{if(event.key==='Escape'&&(regionMode||regionDraft||regionDrag)){event.preventDefault();cancelRegion();if(!stitchParts.length){setRegionMode(false);renderPage();}}});
  $('#pdfRegionSuggest').onclick=()=>{
   if(!current||!regionDraft)return;const text=$('#pdfRegionText').value,suggestion=core.classify(text,current.subject,chapters);
   $('#pdfRegionChapters').innerHTML=chapterOptions(current.subject,suggestion.chapters);$('#pdfRegionType').value=core.questionType(text);$('#pdfRegionReason').textContent=suggestion.matchedKeywords.length?'建议依据：'+suggestion.matchedKeywords.join('、'):'没有足够线索，请手动选择章节。';
  };
  $('#pdfConfirmRegion').onclick=async()=>{
   if(!current||!regionDraft||committingRegion)return;const record=current,previous=current.questions,draft=regionDraft,editing=regionEditingId;
   const label=$('#pdfRegionLabel').value.trim();if(!label){toast('请填写题目名称。');return;}
   const allowed=new Set(chapters.filter(ch=>ch.subject===record.subject).map(ch=>ch.id));
   const question={...draft,label:label.slice(0,30),text:$('#pdfRegionText').value.slice(0,20000),chapters:[...$('#pdfRegionChapters').selectedOptions].map(option=>option.value).filter(id=>allowed.has(id)),type:core.types[$('#pdfRegionType').value]?$('#pdfRegionType').value:'other'};
   committingRegion=true;
   $('#pdfConfirmRegion').disabled=true;
   updateStitchControls();
   const questions=editing?previous.map(q=>q.id===editing?question:q):[...previous,question];
   try{
    await store.update(await owner(),metadata({...record,questions}));
    record.questions=questions;
    cacheRecord(record);
    if(current===record){cancelRegion();setRegionMode(false);$('#pdfChapterFilter').value='';$('#pdfTypeFilter').value='';$('#pdfQuestionSearch').value='';await selectQuestion(question.id);}
    await renderHistory();toast(editing?'题目截图已更新，原错题状态已保留。':(question.parts.length>1?'已拼成一道完整题目，可保存或收录错题。':'已建立独立题目截图，可保存或收录错题。'));
   }catch(error){toast(error.message);}finally{committingRegion=false;$('#pdfConfirmRegion').disabled=false;updateStitchControls();}
  };
  $('#pdfSplitQuestion').onclick=async()=>{
   if(!current||committingRegion)return;const old=current.questions.find(q=>q.id===selectedId);if(!old||isCrop(old))return;
   const hasAnswer=await questionAnswers.has(current.id,old.id).catch(()=>false);
   if(current?.questions.find(q=>q.id===selectedId)!==old)return;
   if((old.savedAt||hasAnswer)&&!root.confirm('拆分会清除原题的答案附件和错题状态。拆分后请分别保存，继续吗？'))return;
   const previous=current.questions;
   try{
    const split=core.splitQuestion(old,pageNumber,$('#pdfSplitPercent').value,'manual-'+root.crypto.randomUUID());
    current.questions=current.questions.flatMap(q=>q.id===selectedId?split:[q]);
    try{await saveCurrent({discardAnswers:[old.id]});}catch(error){current.questions=previous;throw error;}
    $('#pdfSplitLine').hidden=true;await selectQuestion(split[0].id);await renderHistory();toast('已拆成两道。原识别文字保留在两题中，请核对文字与边界，再分别保存。');
   }catch(error){toast(error.message);}
  };
  function openQuestionAnswer(){
   const question=current?.questions.find(q=>q.id===selectedId);
   if(question)return questionAnswers.open(current.id,question);
  }
  $('#pdfCropAnswer').onclick=openQuestionAnswer;
  $('#pdfQuestionAnswer').onclick=openQuestionAnswer;
  $('#pdfDownloadOriginal').onclick=()=>{if(current?.blob)download(current.blob,current.filename);};
  $('#pdfExportClassification').onclick=()=>{if(current)download(new Blob([JSON.stringify({format:'chapterlab-pdf-classification-v1',...metadata(current)},null,2)],{type:'application/json'}),current.title+'-章节分类.json');};
  $('#pdfViewerDialog').addEventListener('close',()=>{questionAnswers.close();return cleanup();});
  root.addEventListener('pagehide',()=>{questionAnswers.close();return cleanup();});
  fileSync?.start();
  return {renderHistory,importFiles,openRecord,refresh,entries,questionCard,handleAction,setNotebook,practiceChanged:()=>fileSync?.changed()};
 }
 root.ChapterLabPDFLibrary={create};
})(globalThis);

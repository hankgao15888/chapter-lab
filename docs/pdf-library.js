(function(root){
 'use strict';
 function create({chapters,getOwner,getSubject,toast,onImported=()=>{},onChange=()=>{},storage,loadDocument}){
  const $=selector=>document.querySelector(selector),core=root.ChapterLabPDFCore,store=storage||root.ChapterLabPDFStore.create();
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const chapterMap=new Map(chapters.map(ch=>[ch.id,ch]));
  let recordsCache=[];
  let regionMode=false,regionDrag=null,regionDraft=null,regionVersion=0;
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
  function metadata(record){const {blob,...meta}=record;return meta;}
  async function refresh(){recordsCache=await store.list(await owner());onChange();}
  function entries(){return core.questionEntries(recordsCache);}
  function cacheRecord(record){recordsCache=recordsCache.filter(item=>item.id!==record.id).concat(metadata(record));onChange();}
  async function saveCurrent(){await store.update(await owner(),metadata(current));cacheRecord(current);}
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
     return `<article class="pdf-history-row"><div class="pdf-file-icon" aria-hidden="true">PDF</div><div><button class="pdf-title-button" data-open-pdf="${esc(record.id)}">${esc(record.title)}</button><p>${esc(core.subjects[record.subject])} · ${record.pageCount} 页 · ${record.questions.length} 个题目 / 页面条目 · ${classified} 个有章节</p><small>${record.scannedPages?'含 '+record.scannedPages+' 页扫描或少文字内容，需手动核对':'文字识别与章节为自动建议，可在阅读器调整'}</small></div><div class="pdf-row-actions"><button class="primary" data-open-pdf="${esc(record.id)}">直接查看 →</button><button class="text-button" data-remove-pdf="${esc(record.id)}">删除</button></div></article>`;
    }).join('')||'<div class="empty-state"><strong>还没有导入的 PDF</strong>点击「导入 PDF」，导入后可直接阅读并按章节整理。</div>';
   }catch(error){$('#pdfHistoryCount').textContent='';$('#pdfHistoryList').innerHTML=`<div class="info-box">${esc(error.message)}</div>`;}
  }
  function renderQuestions(){
   if(!current)return;
   const chapter=$('#pdfChapterFilter').value,type=$('#pdfTypeFilter').value,term=core.normalize($('#pdfQuestionSearch').value);
   const questions=current.questions.filter(q=>(!chapter||(chapter==='unmapped'?!q.chapters.length:q.chapters.includes(chapter)))&&(!type||q.type===type)&&(!term||core.normalize(q.label+' '+q.text+' '+q.chapters.map(id=>chapterMap.get(id)?.zh||'').join(' ')).includes(term)));
   $('#pdfQuestionCount').textContent=`共 ${current.questions.length} 个条目 · 当前 ${questions.length} 个`;
   $('#pdfQuestionList').innerHTML=questions.map(q=>`<button type="button" class="pdf-question-item ${q.id===selectedId?'selected':''}" data-select-pdf-question="${esc(q.id)}"><strong>${esc(q.label)}</strong><small>第 ${q.parts[0].page}${q.parts.at(-1).page!==q.parts[0].page?'–'+q.parts.at(-1).page:''} 页 · ${esc(core.types[q.type])}</small><span>${q.chapters.length?q.chapters.map(id=>esc(chapterMap.get(id)?.zh||id)).join(' / '):'待归类'}</span><em>${q.savedAt?'已保存单题'+(q.notebookStatus==='wrong'?' · 待掌握':q.notebookStatus==='correct'?' · 已掌握':''):q.reviewed?'已人工核对':q.manual?'待手动拆题':'自动建议，待核对'}</em></button>`).join('')||'<p class="pdf-empty">当前筛选没有题目，可清除筛选或手动新增题目。</p>';
  }
  function fillEditor(question){
   $('#pdfQuestionEditor').classList.toggle('hidden',!question);if(!question)return;
   $('#pdfQuestionLabel').value=question.label;
   $('#pdfStartPercent').value=Number((question.parts[0].top*100).toFixed(1));$('#pdfEndPercent').value=Number((question.parts.at(-1).bottom*100).toFixed(1));
   $('#pdfSaveToNotebook').checked=Boolean(question.notebookStatus);
   $('#pdfQuestionSaveStatus').textContent=question.savedAt?'已保存到「我的练习」'+(question.notebookStatus==='wrong'?' · 已收录，待掌握':question.notebookStatus==='correct'?' · 错题本中已掌握':' · 未收录错题'):'尚未保存为单题，核对后点击下方保存。';
   $('#pdfFirstPage').value=question.parts[0].page;$('#pdfLastPage').value=question.parts.at(-1).page;
   $('#pdfQuestionType').value=question.type;$('#pdfQuestionText').value=question.text;
   $('#pdfQuestionChapters').innerHTML=chapterOptions(current.subject,question.chapters);
   $('#pdfClassificationReason').textContent=question.reviewed?'已人工核对，可继续调整。':question.matchedKeywords?.length?'建议依据：'+question.matchedKeywords.join('、'):'没有足够的文字线索，请手动选择章节。';
  }
  async function selectQuestion(id){
   cancelRegion();
   const question=current?.questions.find(q=>q.id===id);if(!question)return;
   selectedId=id;pageNumber=question.parts[0].page;fillEditor(question);renderQuestions();await renderPage();
  }
  async function renderPage(){
   cancelRegion();
   const version=++renderVersion;
   if(renderTask){renderTask.cancel();await renderTask.promise.catch(()=>{});}
   if(version!==renderVersion||!pdf||!current)return;
   const documentToRender=pdf;
   $('#pdfPageStatus').textContent='正在显示第 '+pageNumber+' 页…';
   try{
    const page=await documentToRender.getPage(pageNumber);
    if(version!==renderVersion){page.cleanup();return;}
    const base=page.getViewport({scale:1}),host=$('#pdfCanvasHost');
    const width=Math.max(260,Math.min(1200,host.clientWidth||800)-24);
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
    $('#pdfPageStatus').textContent='第 '+pageNumber+' 页'+(part?' · '+question.label:'');
   }catch(error){if(version===renderVersion&&error.name!=='RenderingCancelledException')$('#pdfPageStatus').textContent='页面读取失败，请重试切换页码。';}
  }
  async function cleanup(){
   cancelRegion();setRegionMode(false);
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
    if(record.questions[0])await selectQuestion(record.questions.some(q=>q.id===questionId)?questionId:record.questions[0].id);else{fillEditor(null);renderQuestions();await renderPage();}
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
  $('#pdfQuestionList').onclick=event=>{const button=event.target.closest('[data-select-pdf-question]');if(button)selectQuestion(button.dataset.selectPdfQuestion);};
  ['pdfChapterFilter','pdfTypeFilter'].forEach(id=>$('#'+id).onchange=renderQuestions);$('#pdfQuestionSearch').oninput=renderQuestions;
  $('#pdfPagePrevious').onclick=()=>{if(pageNumber>1){pageNumber--;renderPage();}};
  $('#pdfPageNext').onclick=()=>{if(current&&pageNumber<current.pageCount){pageNumber++;renderPage();}};
  $('#pdfPageNumber').onchange=()=>{if(current){pageNumber=Math.max(1,Math.min(current.pageCount,Math.floor(Number($('#pdfPageNumber').value))||1));renderPage();}};
  $('#pdfZoom').onchange=renderPage;
  $('#pdfDocumentSubject').onchange=async()=>{
   if(!current)return;cancelRegion();const subject=$('#pdfDocumentSubject').value;if(!core.subjects[subject])return;
   const previous=current.subject,questions=current.questions;
   current.subject=subject;current.questions=current.questions.map(q=>({...q,...core.classify(q.text,subject,chapters),reviewed:false}));
   try{await saveCurrent();$('#pdfChapterFilter').innerHTML='<option value="">全部章节</option><option value="unmapped">待归类</option>'+chapterOptions(subject);fillEditor(current.questions.find(q=>q.id===selectedId));renderQuestions();await renderHistory();toast('科目已更新，章节已重新建议。');}
   catch(error){current.subject=previous;current.questions=questions;$('#pdfDocumentSubject').value=previous;toast(error.message);}
  };
  $('#pdfSaveQuestion').onclick=async()=>{
   if(!current)return;
   const old=current.questions.find(q=>q.id===selectedId);if(!old)return;
   try{
    const edit=core.validateEdit({number:$('#pdfQuestionLabel').value,firstPage:$('#pdfFirstPage').value,lastPage:$('#pdfLastPage').value,type:$('#pdfQuestionType').value,text:$('#pdfQuestionText').value,chapters:[...$('#pdfQuestionChapters').selectedOptions].map(option=>option.value)},current.subject,chapters,current.pageCount);
    if(edit.parts[0].page===old.parts[0].page&&edit.parts.at(-1).page===old.parts.at(-1).page)edit.parts=old.parts;
    edit.parts=core.editBounds(edit.parts,$('#pdfStartPercent').value,$('#pdfEndPercent').value);
    edit.savedAt=old.savedAt||new Date().toISOString();
    edit.notebookStatus=$('#pdfSaveToNotebook').checked?(old.notebookStatus||'wrong'):null;
    const updated={...old,...edit};const previous=current.questions;
    current.questions=current.questions.map(q=>q.id===selectedId?updated:q);
    try{await saveCurrent();}catch(error){current.questions=previous;throw error;}
    renderQuestions();fillEditor(updated);await renderHistory();await renderPage();toast(updated.notebookStatus?'单题已保存，并已收录到错题本。':'单题已保存到「我的练习」。');
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
   if(!current)return;
   const previous=current.questions;
   const question={id:'manual-'+root.crypto.randomUUID(),label:'新题目',number:null,parts:[{page:pageNumber,top:0,bottom:1}],text:'',chapters:[],type:'other',reviewed:false,manual:true};
   current.questions=[...current.questions,question];
   try{await saveCurrent();$('#pdfChapterFilter').value='';$('#pdfTypeFilter').value='';$('#pdfQuestionSearch').value='';await selectQuestion(question.id);await renderHistory();$('#pdfQuestionLabel').focus();toast('已新增题目，请填写页码和章节后保存。');}
   catch(error){current.questions=previous;toast(error.message);}
  };
  $('#pdfDeleteQuestion').onclick=async()=>{
   if(!current||!selectedId||!root.confirm('删除这道题及其错题记录？PDF 原文件会保留。'))return;
   const previous=current.questions;current.questions=current.questions.filter(q=>q.id!==selectedId);
   try{await saveCurrent();selectedId=null;fillEditor(null);renderQuestions();await renderHistory();await renderPage();}
   catch(error){current.questions=previous;toast(error.message);}
  };
  function questionCard(q,notebook=false){
   const status=q.notebookStatus;
   return `<article class="pdf-saved-question"><div><span class="badge">本地 PDF · ${esc(core.subjects[q.subject])}</span><h3>${esc(q.label)}</h3><small>${esc(q.title)} · 第 ${q.parts[0].page}–${q.parts.at(-1).page} 页 · ${esc(core.types[q.type])}</small><p>${q.chapters.map(id=>esc(chapterMap.get(id)?.zh||id)).join(' / ')||'待归类'}</p><pre>${esc(q.text.slice(0,500)||'扫描题目，请打开原题查看。')}</pre></div><div class="pdf-row-actions"><button class="primary" data-pdf-open-question="${esc(q.questionId)}" data-pdf-document="${esc(q.documentId)}">查看这道题 →</button><button data-pdf-status="${status?'remove':'wrong'}" data-pdf-question="${esc(q.questionId)}" data-pdf-document="${esc(q.documentId)}">${status?'移出错题本':'＋ 收录错题'}</button>${status?`<button data-pdf-status="${status==='correct'?'wrong':'correct'}" data-pdf-question="${esc(q.questionId)}" data-pdf-document="${esc(q.documentId)}">${status==='correct'?'↺ 仍需复习':'✓ 我已掌握'}</button>`:''}</div></article>`;
  }
  async function handleAction(event){
   const button=event.target.closest('[data-pdf-open-question], [data-pdf-status]');if(!button)return;
   if(button.dataset.pdfOpenQuestion){await openRecord(button.dataset.pdfDocument,button.dataset.pdfOpenQuestion);return;}
   button.disabled=true;
   try{await setNotebook(button.dataset.pdfDocument,button.dataset.pdfQuestion,button.dataset.pdfStatus==='remove'?null:button.dataset.pdfStatus);toast(button.dataset.pdfStatus==='correct'?'已移至已掌握。':button.dataset.pdfStatus==='remove'?'已移出错题本，单题仍保留。':'已收录到待掌握。');}catch(error){toast(error.message);}finally{button.disabled=false;}
  }
  $('#pdfSavedQuestionList').onclick=handleAction;
  $('#pdfSplitPercent').oninput=()=>{const value=Number($('#pdfSplitPercent').value);$('#pdfSplitLine').hidden=!Number.isFinite(value)||value<0||value>100;$('#pdfSplitLine').style.top=value+'%';};
  $('#pdfPageFrame').onclick=event=>{if(regionMode)return;const bounds=$('#pdfCanvas').getBoundingClientRect();if(!bounds.height)return;$('#pdfSplitPercent').value=Math.max(0,Math.min(100,(event.clientY-bounds.top)/bounds.height*100)).toFixed(1);$('#pdfSplitPercent').oninput();};
  function setRegionMode(enabled){
   regionMode=enabled;$('#pdfRegionMode').setAttribute('aria-pressed',String(enabled));$('#pdfPageFrame').classList.toggle('pdf-region-mode',enabled);
   $('#pdfRegionStatus').textContent=enabled?'按住鼠标拖动框住题目，松开后自动建议分类；按 Esc 可取消。':'开启框选后，在原页上按住鼠标拖动框住题目。';
   if(enabled)$('#pdfSplitLine').hidden=true;
  }
  function cancelRegion(){
   ++regionVersion;
   const pointer=regionDrag?.pointerId;regionDrag=null;regionDraft=null;
   if(pointer!==undefined&&$('#pdfPageFrame').hasPointerCapture?.(pointer))$('#pdfPageFrame').releasePointerCapture(pointer);
   $('#pdfRegionBox').hidden=true;$('#pdfRegionReview').hidden=true;$('#pdfQuestionEditor').classList.toggle('hidden',!current?.questions.some(q=>q.id===selectedId));$('#pdfCancelRegion').disabled=true;$('#pdfConfirmRegion').disabled=false;
   const preview=$('#pdfRegionPreview');preview.width=1;preview.height=1;
  }
  function point(event){
   const bounds=$('#pdfCanvas').getBoundingClientRect();
   return {x:Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width)),y:Math.max(0,Math.min(1,(event.clientY-bounds.top)/bounds.height))};
  }
  function drawRegion(region){
   const box=$('#pdfRegionBox');box.hidden=false;box.style.left=region.left*100+'%';box.style.top=region.top*100+'%';box.style.width=(region.right-region.left)*100+'%';box.style.height=(region.bottom-region.top)*100+'%';
  }
  async function recognizeRegion(region,page){
   const version=++regionVersion,documentId=current?.id,documentToRead=pdf;
   $('#pdfRegionStatus').textContent='正在读取框内文字并建议章节…';
   try{
    const source=await documentToRead.getPage(page),viewport=source.getViewport({scale:1});let text='',unreadable=false;
    try{const content=await source.getTextContent();text=core.regionText(content.items,viewport,region);}catch{unreadable=true;}
    if(version!==regionVersion||current?.id!==documentId||pageNumber!==page)return;
    regionDraft=core.regionQuestion(region,page,text,current.subject,chapters,'manual-'+root.crypto.randomUUID());
    $('#pdfRegionLabel').value='框选题目';$('#pdfRegionChapters').innerHTML=chapterOptions(current.subject,regionDraft.chapters);$('#pdfRegionType').value=regionDraft.type;$('#pdfRegionText').value=text;
    $('#pdfRegionReason').textContent=text?(regionDraft.matchedKeywords.length?'建议依据：'+regionDraft.matchedKeywords.join('、')+'。章节和题型均可修改。':'框内文字已读取，暂未匹配到章节，请手动选择。'):(unreadable?'文字读取失败。':'框内没有可提取文字，可能是扫描页。')+'可按原图手动分类或粘贴文字，未启用扫描文字识别。';
    const canvas=$('#pdfCanvas'),preview=$('#pdfRegionPreview'),width=(region.right-region.left)*canvas.width,height=(region.bottom-region.top)*canvas.height,scale=Math.min(1,600/width);
    preview.width=Math.max(1,Math.round(width*scale));preview.height=Math.max(1,Math.round(height*scale));
    preview.getContext('2d').drawImage(canvas,region.left*canvas.width,region.top*canvas.height,width,height,0,0,preview.width,preview.height);
    $('#pdfRegionReview').hidden=false;$('#pdfQuestionEditor').classList.toggle('hidden',true);$('#pdfRegionReview').scrollIntoView({behavior:'smooth',block:'nearest'});$('#pdfRegionStatus').textContent='已框选第 '+page+' 页。核对左侧预览和分类后确认，框错可取消或直接重新画。';
   }catch(error){if(version===regionVersion){$('#pdfRegionStatus').textContent='框选识别失败，请取消后重试。';toast(error.message||'框选识别失败。');}}
  }
  $('#pdfRegionMode').onclick=()=>{cancelRegion();setRegionMode(!regionMode);};
  $('#pdfCancelRegion').onclick=()=>{cancelRegion();$('#pdfRegionStatus').textContent='已取消框选，未修改原有题目。可以重新拖动框选。';};
  $('#pdfPageFrame').onpointerdown=event=>{
   if(!regionMode||!current||!pdf||renderTask||(event.button!==undefined&&event.button!==0)||event.isPrimary===false)return;
   event.preventDefault();cancelRegion();const start=point(event);if(!Number.isFinite(start.x)||!Number.isFinite(start.y))return;
   regionDrag={start,end:start,page:pageNumber,pointerId:event.pointerId};$('#pdfPageFrame').setPointerCapture?.(event.pointerId);$('#pdfCancelRegion').disabled=false;
  };
  $('#pdfPageFrame').onpointermove=event=>{
   if(!regionDrag||event.pointerId!==regionDrag.pointerId)return;event.preventDefault();regionDrag.end=point(event);
   const {start,end}=regionDrag;drawRegion({left:Math.min(start.x,end.x),right:Math.max(start.x,end.x),top:Math.min(start.y,end.y),bottom:Math.max(start.y,end.y)});
  };
  $('#pdfPageFrame').onpointerup=async event=>{
   if(!regionDrag||event.pointerId!==regionDrag.pointerId)return;event.preventDefault();
   const drag=regionDrag;regionDrag=null;if($('#pdfPageFrame').hasPointerCapture?.(event.pointerId))$('#pdfPageFrame').releasePointerCapture(event.pointerId);
   try{const region=core.rectangle(drag.start,point(event));drawRegion(region);await recognizeRegion(region,drag.page);}catch(error){cancelRegion();$('#pdfRegionStatus').textContent=error.message;}
  };
  $('#pdfPageFrame').onpointercancel=()=>cancelRegion();
  $('#pdfPageFrame').onlostpointercapture=()=>{if(regionDrag)cancelRegion();};
  $('#pdfViewerDialog').addEventListener('cancel',event=>{if(regionMode||regionDraft||regionDrag){event.preventDefault();cancelRegion();setRegionMode(false);}});
  $('#pdfViewerDialog').addEventListener('keydown',event=>{if(event.key==='Escape'&&(regionMode||regionDraft||regionDrag)){event.preventDefault();cancelRegion();setRegionMode(false);}});
  $('#pdfRegionSuggest').onclick=()=>{
   if(!current||!regionDraft)return;const text=$('#pdfRegionText').value,suggestion=core.classify(text,current.subject,chapters);
   $('#pdfRegionChapters').innerHTML=chapterOptions(current.subject,suggestion.chapters);$('#pdfRegionType').value=core.questionType(text);$('#pdfRegionReason').textContent=suggestion.matchedKeywords.length?'建议依据：'+suggestion.matchedKeywords.join('、'):'没有足够线索，请手动选择章节。';
  };
  $('#pdfConfirmRegion').onclick=async()=>{
   if(!current||!regionDraft)return;const record=current,previous=current.questions,draft=regionDraft;
   const label=$('#pdfRegionLabel').value.trim();if(!label){toast('请填写题目名称。');return;}
   const allowed=new Set(chapters.filter(ch=>ch.subject===record.subject).map(ch=>ch.id));
   const question={...draft,label:label.slice(0,30),text:$('#pdfRegionText').value.slice(0,20000),chapters:[...$('#pdfRegionChapters').selectedOptions].map(option=>option.value).filter(id=>allowed.has(id)),type:core.types[$('#pdfRegionType').value]?$('#pdfRegionType').value:'other'};
   $('#pdfConfirmRegion').disabled=true;record.questions=[...previous,question];
   try{
    await store.update(await owner(),metadata(record));cacheRecord(record);
    if(current===record){cancelRegion();setRegionMode(false);$('#pdfChapterFilter').value='';$('#pdfTypeFilter').value='';$('#pdfQuestionSearch').value='';await selectQuestion(question.id);}
    await renderHistory();toast('已建立框选题目。可继续修改分类，再保存单题或收录错题。');
   }catch(error){record.questions=previous;toast(error.message);}finally{$('#pdfConfirmRegion').disabled=false;}
  };
  $('#pdfSplitQuestion').onclick=async()=>{
   if(!current)return;const old=current.questions.find(q=>q.id===selectedId);if(!old)return;
   if(old.savedAt&&!root.confirm('拆分会替换这道已保存题目，并清除它原来的错题状态。拆分后请分别保存，继续吗？'))return;
   const previous=current.questions;
   try{
    const split=core.splitQuestion(old,pageNumber,$('#pdfSplitPercent').value,'manual-'+root.crypto.randomUUID());
    current.questions=current.questions.flatMap(q=>q.id===selectedId?split:[q]);
    try{await saveCurrent();}catch(error){current.questions=previous;throw error;}
    $('#pdfSplitLine').hidden=true;await selectQuestion(split[0].id);await renderHistory();toast('已拆成两道。原识别文字保留在两题中，请核对文字与边界，再分别保存。');
   }catch(error){toast(error.message);}
  };
  $('#pdfDownloadOriginal').onclick=()=>{if(current?.blob)download(current.blob,current.filename);};
  $('#pdfExportClassification').onclick=()=>{if(current)download(new Blob([JSON.stringify({format:'chapterlab-pdf-classification-v1',...metadata(current)},null,2)],{type:'application/json'}),current.title+'-章节分类.json');};
  $('#pdfViewerDialog').addEventListener('close',cleanup);
  root.addEventListener('pagehide',cleanup);
  return {renderHistory,importFiles,openRecord,refresh,entries,questionCard,handleAction,setNotebook};
 }
 root.ChapterLabPDFLibrary={create};
})(globalThis);

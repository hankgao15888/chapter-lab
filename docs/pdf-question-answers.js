(function(root){
 'use strict';
 const maxBytes=25*1024*1024;
 function attachmentType(bytes){
  const ascii=(start,end)=>String.fromCharCode(...bytes.slice(start,end));
  if(bytes[0]===137&&ascii(1,8)==='PNG\r\n\x1a\n')return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP')return 'image/webp';
  if(ascii(0,6)==='GIF87a'||ascii(0,6)==='GIF89a')return 'image/gif';
  if(ascii(0,1024).includes('%PDF-'))return 'application/pdf';
  return '';
 }
 function create({store,owner,loadPDF,download}){
  const $=selector=>root.document.querySelector(selector);
  const dialog=$('#pdfAnswerDialog'),picker=$('#pdfAnswerFile'),notice=$('#pdfAnswerStatus');
  const previewImage=$('#pdfAnswerImage'),previewCanvas=$('#pdfAnswerCanvas');
  let session=null,answerPDF=null,renderTask=null,imageUrl=null,previewVersion=0,pageVersion=0,pageNumber=1;

  function resetPreview(){
   ++previewVersion;++pageVersion;
   renderTask?.cancel();renderTask=null;
   if(answerPDF){void answerPDF.destroy().catch(()=>{});answerPDF=null;}
   if(imageUrl){previewImage.removeAttribute('src');root.URL.revokeObjectURL(imageUrl);imageUrl=null;}
   previewImage.hidden=true;previewCanvas.hidden=true;
   previewCanvas.width=1;previewCanvas.height=1;
   $('#pdfAnswerPages').hidden=true;
  }
  function updateControls(state){
   const attachment=state.attachment;
   $('#pdfAnswerPickerLabel').textContent=attachment?'替换答案':'导入答案';
   picker.disabled=state.busy;
   $('#pdfAnswerRemove').hidden=!attachment;
   $('#pdfAnswerRemove').disabled=state.busy;
   $('#pdfAnswerDownload').hidden=!attachment;
   $('#pdfAnswerName').hidden=!attachment;
   $('#pdfAnswerName').textContent=attachment?.filename||'';
  }
  async function renderPage(state,number){
   const pdf=answerPDF;
   if(session!==state||!pdf)return false;
   const version=++pageVersion;
   pageNumber=Math.max(1,Math.min(pdf.numPages,number));
   const requestedPage=pageNumber;
   renderTask?.cancel();
   $('#pdfAnswerPrevious').disabled=pageNumber<=1;
   $('#pdfAnswerNext').disabled=pageNumber>=pdf.numPages;
   $('#pdfAnswerPages').hidden=pdf.numPages<=1;
   $('#pdfAnswerPageNumber').textContent=`第 ${pageNumber} / ${pdf.numPages} 页`;
   notice.textContent='正在显示答案…';
   try{
    const source=await pdf.getPage(requestedPage);
    if(version!==pageVersion){source.cleanup();return false;}
    const base=source.getViewport({scale:1});
    const width=Math.max(240,Math.min(960,dialog.clientWidth-48||640));
    const scale=Math.min(width/base.width*Math.min(root.devicePixelRatio||1,2),1920/base.width,2600/base.height);
    const viewport=source.getViewport({scale});
    const canvas=root.document.createElement('canvas');
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    const task=source.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport,background:'rgb(255,255,255)'});
    renderTask=task;
    try{await task.promise;}finally{if(renderTask===task)renderTask=null;source.cleanup();}
    if(version!==pageVersion)return false;
    previewCanvas.width=canvas.width;previewCanvas.height=canvas.height;
    previewCanvas.getContext('2d').drawImage(canvas,0,0);
    previewCanvas.hidden=false;
    notice.textContent='';
    return true;
   }catch(error){
    if(version===pageVersion)notice.textContent='本页暂时无法显示，可下载答案文件查看。';
    return false;
   }
  }
  async function preview(state,preparedPDF=null){
   resetPreview();
   const version=previewVersion;
   const attachment=state.attachment;
   if(!attachment){notice.textContent='这道题还没有附件，可以从电脑导入答案。';return true;}
   notice.textContent='正在打开答案…';
   if(attachment.type==='application/pdf'){
    try{
     const doc=preparedPDF||await loadPDF(await attachment.blob.arrayBuffer());
     if(session!==state||version!==previewVersion){await doc.destroy().catch(()=>{});return false;}
     answerPDF=doc;
     return await renderPage(state,1);
    }catch(error){
     if(session===state&&version===previewVersion)notice.textContent='暂时无法预览答案 PDF，可下载原文件查看。';
     return false;
    }
   }
   imageUrl=root.URL.createObjectURL(attachment.blob);
   previewImage.src=imageUrl;
   previewImage.hidden=false;
   notice.textContent='';
   return true;
  }
  const has=async(documentId,questionId)=>Boolean(await store.getAnswer(await owner(),documentId,questionId));

  async function open(documentId,question){
   resetPreview();
   const state={documentId,questionId:question.id,attachment:null,busy:true};
   session=state;
   updateControls(state);
   $('#pdfAnswerTitle').textContent=`单题答案 · ${question.label}`;
   notice.textContent='正在读取本机答案…';
   if(!dialog.open)dialog.showModal();
   try{
    state.attachment=await store.getAnswer(await owner(),documentId,question.id);
    if(session===state){updateControls(state);await preview(state);}
   }catch(error){if(session===state)notice.textContent=error.message||'暂时无法读取本机答案。';}
   finally{state.busy=false;if(session===state)updateControls(state);}
  }
  async function prepare(file){
   if(!file.size||file.size>maxBytes)throw new Error('请选择 25 MB 以内的答案文件。');
   const type=attachmentType(new Uint8Array(await file.slice(0,1024).arrayBuffer()));
   if(!type)throw new Error('请选择 PDF、PNG、JPG、WebP 或 GIF 文件。');
   const blob=file.slice(0,file.size,type);
   let document=null;
   if(type==='application/pdf')document=await loadPDF(await blob.arrayBuffer());
   else{
    const url=root.URL.createObjectURL(blob);
    try{
     const image=new root.Image();
     image.src=url;
     await image.decode();
    }catch{throw new Error('无法读取这张图片，请选择完整的图片文件。');}
    finally{root.URL.revokeObjectURL(url);}
   }
   return {attachment:{filename:file.name,type,blob},document};
  }
  picker.onchange=async()=>{
   const file=picker.files[0];picker.value='';
   const state=session;
   if(!state||state.busy||!file)return;
   state.busy=true;updateControls(state);
   notice.textContent='正在导入答案…';
   let preparedPDF=null;
   try{
    const prepared=await prepare(file);
    preparedPDF=prepared.document;
    if(session!==state)return;
    await store.setAnswer(await owner(),state.documentId,state.questionId,prepared.attachment);
    if(session!==state)return;
    state.attachment=prepared.attachment;
    updateControls(state);
    const ready=preview(state,preparedPDF);
    preparedPDF=null; // The preview now owns the PDF until replacement or close.
    if(await ready&&session===state)notice.textContent='答案已保存到这道题。';
   }catch(error){if(session===state)notice.textContent=error.message||'导入答案失败，请重试。';}
   finally{
    if(preparedPDF)await preparedPDF.destroy().catch(()=>{});
    state.busy=false;if(session===state)updateControls(state);
   }
  };
  $('#pdfAnswerDownload').onclick=()=>{const attachment=session?.attachment;if(attachment)download(attachment.blob,attachment.filename);};
  $('#pdfAnswerRemove').onclick=async()=>{
   const state=session;
   if(!state?.attachment||state.busy||!root.confirm('移除这道题保存的答案附件？'))return;
   state.busy=true;updateControls(state);
   try{
    await store.setAnswer(await owner(),state.documentId,state.questionId,null);
    if(session!==state)return;
    state.attachment=null;
    resetPreview();
    notice.textContent='已移除答案附件。';
   }catch(error){if(session===state)notice.textContent=error.message||'无法移除答案，请重试。';}
   finally{state.busy=false;if(session===state)updateControls(state);}
  };
  previewImage.addEventListener('error',()=>{
   if(session&&imageUrl)notice.textContent='暂时无法显示图片，可下载答案文件查看。';
  });
  $('#pdfAnswerPrevious').onclick=()=>renderPage(session,pageNumber-1);
  $('#pdfAnswerNext').onclick=()=>renderPage(session,pageNumber+1);
  function close(){session=null;resetPreview();if(dialog.open)dialog.close();}
  dialog.addEventListener('close',()=>{if(!dialog.open)close();});
  return {open,close,has};
 }
 root.ChapterLabPDFQuestionAnswers={create};
})(globalThis);

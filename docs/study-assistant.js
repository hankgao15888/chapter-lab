/* MIT License · Search the published question index and the browser-local notebook. */
(function(root){
 'use strict';
 const normalize=value=>String(value??'').normalize('NFKC').toLowerCase().trim();
 const compact=value=>normalize(value).replace(/[^a-z0-9]/g,'');
 const boards=[
  ['oxford-aqa-international',/oxford[\s-]*aqa(?:[\s-]*international)?|牛津\s*aqa|aqa/i],
  ['cie-international',/cambridge(?:[\s-]*international)?|cie(?:[\s-]*international)?|caie|剑桥/i],
  ['edexcel-ial',/edexcel(?:[\s-]*ial)?|pearson|爱德思|\bial\b/i]
 ];
 const subjects=[
  ['furthermathematics',/进阶数学|高数|进一步数学|further\s*math(?:ematics|s)?/i],
  ['mathematics',/普数|数学|math(?:ematics|s)?/i],
  ['physics',/物理|physics/i],['chemistry',/化学|chemistry/i],
  ['biology',/生物|biology/i],['economics',/经济学?|economics/i]
 ];
 const syllabuses={9702:'physics',9709:'mathematics',9231:'furthermathematics',9701:'chemistry',9700:'biology',9708:'economics'};
 const sessions={m:3,s:6,w:11,'f/m':3,'m/j':6,'o/n':11};
 function parseLookup(value){
  let input=normalize(value);
  const detected=boards.find(([,pattern])=>pattern.test(input));
  let board=detected?.[0]||'',year=null,month=null,paper='',unit=null;
  if(detected)input=input.replace(detected[1],' ');
  const namedSubject=subjects.find(([,pattern])=>pattern.test(input));
  let subject=namedSubject?.[0]||'';
  if(namedSubject)input=input.replace(namedSubject[1],' ');
  const citation=input.match(/(^|\D)(970[01289]|9231)\s*\/\s*(\d{2})\s*\/\s*([fmo]\s*\/\s*[mjn])\s*\/\s*(\d{4}|\d{2})(?!\d)/);
  if(citation){
   board=board||'cie-international';
   subject=subject||syllabuses[citation[2]];
   paper=citation[3];
   month=sessions[citation[4].replace(/\s/g,'')]||null;
   year=citation[5].length===2?2000+Number(citation[5]):Number(citation[5]);
   input=input.replace(citation[0],' ');
  }
  const explicitQuestion=input.match(/(?:第\s*|题号\s*[:：]?\s*|q(?:uestion)?\s*[:：]?\s*)(\d{1,3})(?!\d)/i);
  if(explicitQuestion)input=input.replace(explicitQuestion[0],' ');
  const date=input.match(/(?:^|\D)(20\d{2})\s*[-_/.]\s*(0?[1-9]|1[0-2])(?=\b|[-_/])/);
  if(date){
   year=Number(date[1]);month=Number(date[2]);
   input=input.replace(date[0],' ');
  }
  const yearToken=input.match(/(?:^|\D)(20\d{2})(?!\d)\s*年?/);
  if(yearToken){year=Number(yearToken[1]);input=input.replace(yearToken[0],' ');}
  const monthToken=input.match(/(?:^|\D)(0?[1-9]|1[0-2])\s*月/);
  if(monthToken){month=Number(monthToken[1]);input=input.replace(monthToken[0],' ');}
  if(!month){
   const terms=[[3,/feb(?:ruary)?\s*[/–-]\s*mar(?:ch)?|\bmarch\b|\bf\s*\/\s*m\b/],[6,/may\s*[/–-]\s*jun(?:e)?|\bjune?\b|\bm\s*\/\s*j\b/],[11,/oct(?:ober)?\s*[/–-]\s*nov(?:ember)?|\bnov(?:ember)?\b|\bo\s*\/\s*n\b/],[1,/\bjan(?:uary)?\b/],[10,/\boct(?:ober)?\b/]];
   const season=terms.find(([,pattern])=>pattern.test(input));
   if(season){month=season[0];input=input.replace(season[1],' ');}
  }
  if(month===5&&board==='cie-international')month=6;
  const pair=input.match(/(?:^|\D)(970[01289]|9231)\s*\/\s*(\d{2})(?!\d)/);
  if(pair){board=board||'cie-international';subject=subject||syllabuses[pair[1]];paper=pair[2];input=input.replace(pair[0],' ');}
  const cambridgeCode=input.match(/(?:^|\D)(970[01289]|9231)_(?:qp_)?([msw])(\d{2})_(\d{2})(?!\d)/);
  if(cambridgeCode){
   board=board||'cie-international';subject=subject||syllabuses[cambridgeCode[1]];
   month=sessions[cambridgeCode[2]];year=2000+Number(cambridgeCode[3]);paper=cambridgeCode[4];
   input=input.replace(cambridgeCode[0],' ');
  }
  if(board==='cie-international'&&!subject){
   const syllabus=input.match(/(?:^|\D)(970[01289]|9231)(?!\d)/);
   if(syllabus){subject=syllabuses[syllabus[1]];input=input.replace(syllabus[0],' ');}
  }
  const module=input.match(/(?:^|[^a-z0-9])(w[a-z]{2}\d{2}(?:[-/]\d{2}[a-z]?(?:[-_](?:unused|[ab]))?)?|(?:fp(?:sm)?|psm|f[ms]|ph|ch|bl|ec|p|m|s)\d{1,2})(?![a-z0-9])/);
  if(module){paper=compact(module[1]);input=input.replace(module[0],' ');}
  const paperToken=input.match(/(?:paper|unit|卷)\s*[-:：]?\s*(\d{1,2})(?!\d)/);
  if(paperToken){
   if(board==='cie-international'&&paperToken[1].length===2)paper=paperToken[1];
   else unit=Number(paperToken[1]);
   input=input.replace(paperToken[0],' ');
  }
  if(board==='cie-international'&&!paper&&explicitQuestion){
   const variant=input.match(/(?:^|[^\d])([1-6][1-9])(?!\d)/);
   if(variant){paper=variant[1];input=input.replace(variant[0],' ');}
  }
  const bareQuestion=input.match(/(?:^|\D)(\d{1,3})(?!\d)(?:\s*\([a-z0-9]+\))?\s*题?\s*$/);
  const number=Number(explicitQuestion?.[1]||bareQuestion?.[1])||null;
  const choice=normalize(value).match(/\b(either|or)\b/)?.[1]||'';
  return {board,subject,year,month,paper,unit,number,choice};
 }
 function paperMatches(paper,query,subject){
  if(query.board&&paper.board!==query.board)return false;
  if(query.year&&paper.year!==query.year)return false;
  if((subject&&paper.subject!==subject)||(query.subject&&paper.subject!==query.subject))return false;
  const title=normalize(paper.title),code=compact(title.slice(8));
  if(query.month&&Number(title.slice(5,7))!==query.month)return false;
  if(query.unit&&Number(normalize(paper.unit).match(/(?:paper|unit)\s*(\d+)/)?.[1])!==query.unit)return false;
  if(query.paper){
   if(query.paper===code)return true;
   // A bare Edexcel unit code covers its published variants; a full paper code is exact.
   return paper.board==='edexcel-ial'&&query.paper.length===5&&code.startsWith(query.paper);
  }
  return true;
 }
 function numberMatches(label,query){
  const match=normalize(label).match(/^(\d+)(?:\s+(either|or))?/);
  return Boolean(match&&Number(match[1])===query.number&&(!query.choice||match[2]===query.choice));
 }
 function searchPapers(papers,lookup,query,subject){
  const hits=[],unindexed=[];
  for(const paper of papers){
   if(!paperMatches(paper,query,subject))continue;
   if(!Object.hasOwn(lookup,paper.id)){unindexed.push(paper);continue;}
   for(const number of lookup[paper.id])if(numberMatches(number,query))hits.push({paper,number});
  }
  return {hits,unindexed};
 }
 function moveWithinViewport(x,y,width,height,viewportWidth,viewportHeight){
  return {x:Math.max(8,Math.min(x,viewportWidth-width-8)),y:Math.max(8,Math.min(y,viewportHeight-height-8))};
 }
 const maxPetFileSize=5*1024*1024;
 const maxGifSize=1024*1024;
 function petImageType(bytes){
  const ascii=(start,end)=>String.fromCharCode(...bytes.slice(start,end));
  if(bytes[0]===137&&ascii(1,8)==='PNG\r\n\x1a\n')return 'png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpeg';
  if(ascii(0,6)==='GIF87a'||ascii(0,6)==='GIF89a')return 'gif';
  if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP')return 'webp';
  return '';
 }
 async function preparePetPicture(file){
  if(file.size>maxPetFileSize)throw new Error('图片不能超过 5 MB。');
  const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());
  const type=petImageType(bytes);
  if(!type)throw new Error('请选择 PNG、JPG、WebP 或 GIF 图片。');
  if(type==='gif'&&file.size>maxGifSize)throw new Error('GIF 不能超过 1 MB。');
  const blob=new root.Blob([file],{type:`image/${type}`});
  const url=root.URL.createObjectURL(blob);
  try{
   const image=new root.Image();
   image.src=url;
   try{await image.decode();}catch{throw new Error('这张图片无法读取，请换一张。');}
   if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>40000000){
    throw new Error('图片的像素尺寸过大，请先缩小。');
   }
   if(type==='gif')return await new Promise((resolve,reject)=>{
    const reader=new root.FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error('GIF 无法读取，请换一张。'));
    reader.readAsDataURL(blob);
   });
   const scale=Math.min(1,256/Math.max(image.naturalWidth,image.naturalHeight));
   const canvas=root.document.createElement('canvas');
   canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
   canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
   const context=canvas.getContext('2d');
   if(!context)throw new Error('浏览器无法处理这张图片。');
   context.drawImage(image,0,0,canvas.width,canvas.height);
   return canvas.toDataURL('image/png');
  }finally{root.URL.revokeObjectURL(url);}
 }
 function mountPetPicture($,owner){
  const key='chapterlab-pet-image-v1:'+owner;
  const fileInput=$('assistantPetFile'),custom=$('assistantPetPicture'),frog=$('assistantDefaultPet');
  const feedback=$('assistantPetStatus'),reset=$('assistantResetPet');
  function show(data){
   const hasPicture=Boolean(data);
   if(hasPicture)custom.src=data;
   else custom.removeAttribute('src');
   custom.hidden=!hasPicture;
   frog.hidden=hasPicture;
   reset.hidden=!hasPicture;
  }
  try{
   const saved=root.localStorage.getItem(key);
   if(/^data:image\/(?:png|gif);base64,[a-z0-9+/=]+$/i.test(saved||''))show(saved);
  }catch{}
  fileInput.onchange=async()=>{
   const file=fileInput.files[0];
   fileInput.value='';
   if(!file)return;
   fileInput.disabled=true;
   reset.disabled=true;
   feedback.textContent='正在读取图片…';
   try{
    const data=await preparePetPicture(file);
    try{root.localStorage.setItem(key,data);}catch{throw new Error('浏览器无法保存图片，请检查空间或隐私设置。');}
    show(data);
    feedback.textContent='已换好桌宠图片。';
   }catch(error){feedback.textContent=error.message||'无法导入这张图片。';}
   finally{fileInput.disabled=false;reset.disabled=false;}
  };
  reset.onclick=()=>{
   try{root.localStorage.removeItem(key);}
   catch{feedback.textContent='无法恢复默认图片，请稍后重试。';return;}
   show('');
   feedback.textContent='已恢复默认桌宠。';
   fileInput.focus({preventScroll:true});
  };
 }
 function mount({subjectNames,boardNames,papers,lookupPath,getNotebook,openIndexed,openNotebookQuestion,showNotebook,owner=''}){
  const $=id=>root.document.getElementById(id);
  const widget=$('studyAssistant'),launch=$('assistantLaunch'),panel=$('assistantPanel'),handle=$('assistantTitle');
  const form=$('assistantSearch'),input=$('assistantQuery'),subject=$('assistantSubject'),status=$('assistantMastery');
  const notice=$('assistantStatus'),results=$('assistantResults'),more=$('assistantMore');
  mountPetPicture($,owner);
  let mode='exam',lookupPromise,request=0,actions=[],visible=0,position=null,drag=null,suppressClick=false;
  const pageSize=12;
  for(const [id,label] of Object.entries(subjectNames)){
   const option=root.document.createElement('option');option.value=id;option.textContent=label;subject.append(option);
  }
  function loadLookup(){
   if(!lookupPromise)lookupPromise=root.fetch(lookupPath).then(response=>{
    if(!response.ok)throw new Error('无法载入真题索引，请稍后重试。');
    return response.json();
   }).catch(error=>{lookupPromise=null;throw error;});
   return lookupPromise;
  }
  function layout(){
   const rect=launch.getBoundingClientRect();
   if(position){
    position=moveWithinViewport(position.x,position.y,rect.width,rect.height,root.innerWidth,root.innerHeight);
    widget.style.left=position.x+'px';widget.style.top=position.y+'px';
    widget.style.right='auto';widget.style.bottom='auto';
   }
   if(panel.hidden)return;
   const anchor=launch.getBoundingClientRect(),box=panel.getBoundingClientRect();
   const x=anchor.right-box.width;
   const above=anchor.top-box.height-10;
   const y=above>=8?above:anchor.bottom+10;
   const placed=moveWithinViewport(x,y,box.width,box.height,root.innerWidth,root.innerHeight);
   panel.style.left=placed.x+'px';panel.style.top=placed.y+'px';
  }
  function setOpen(open){
   panel.hidden=!open;launch.setAttribute('aria-expanded',String(open));
   if(open){
    layout();
    if(!root.matchMedia?.('(pointer: coarse)')?.matches)input.focus({preventScroll:true});
   }
  }
  function resetResults(message=''){
   actions=[];visible=0;results.replaceChildren();more.hidden=true;notice.textContent=message;layout();
  }
  function selectMode(next){
   ++request;mode=next;
   $('assistantExam').setAttribute('aria-pressed',String(mode==='exam'));
   $('assistantNotebook').setAttribute('aria-pressed',String(mode==='notebook'));
   $('assistantMasteryField').hidden=mode==='exam';
   $('assistantNotebookLink').hidden=mode==='exam';
   $('assistantQueryLabel').textContent=mode==='exam'?'考试局、年份和题号':'题号、章节或关键词';
   input.placeholder=mode==='exam'?'例如 CIE 2024 物理 42 Q3':'例如 力学、PH01 Q6';
   input.value='';
   resetResults(mode==='exam'?'可加科目、月份和卷号缩小范围。':'留空可列出该科目和状态下的错题。');
   input.focus({preventScroll:true});
  }
  async function choose(action){
   const version=++request;
   notice.textContent='正在打开题目…';
   try{
    const opened=await action.open(()=>version===request);
    if(version!==request)return;
    if(opened===false){notice.textContent='暂时无法打开此题，请重试。';return;}
    setOpen(false);notice.textContent='';
   }catch(error){if(version===request)notice.textContent=error.message||'暂时无法打开此题，请重试。';}
  }
  function appendResults(){
   for(const action of actions.slice(visible,visible+pageSize)){
    const item=root.document.createElement('li');
    const control=root.document.createElement(action.href?'a':'button');
    control.className='assistant-result';
    if(action.href){control.href=action.href;control.target='_blank';control.rel='noopener';}
    else{control.type='button';control.onclick=()=>choose(action);}
    const title=root.document.createElement('strong'),meta=root.document.createElement('span');
    title.textContent=action.title;meta.textContent=action.meta;
    control.append(title,meta);item.append(control);results.append(item);
   }
   visible+=pageSize;more.hidden=visible>=actions.length;layout();
  }
  function examActions(found){
   return found.hits.map(hit=>({
    title:`${subjectNames[hit.paper.subject]} · ${hit.paper.title} · Q${hit.number}`,
    meta:`${boardNames[hit.paper.board]} · ${hit.paper.unit}`,
    open:isCurrent=>openIndexed(hit,isCurrent)
   })).concat(found.unindexed.map(paper=>({
    title:`${subjectNames[paper.subject]} · ${paper.title}`,
    meta:`${boardNames[paper.board]} · ${paper.unit} · 试卷未拆题，打开原卷`,
    href:paper.qp
   })));
  }
  form.onsubmit=async event=>{
   event.preventDefault();
   const version=++request,term=input.value.trim(),subjectId=subject.value;
   resetResults('正在查找…');
   try{
    if(mode==='exam'){
     const query=parseLookup(term);
     if(!query.board||!query.year||!query.number){notice.textContent='请输入考试局、四位年份和题号，例如 CIE 2024 Q3。';return;}
     if(subjectId&&query.subject&&subjectId!==query.subject){notice.textContent='输入中的科目与所选科目不同，请调整后重试。';return;}
     const found=searchPapers(papers,await loadLookup(),query,subjectId);
     if(version!==request)return;
     actions=examActions(found);
     if(actions.length===1&&found.hits.length===1){
      notice.textContent='找到 1 道题。';appendResults();await choose(actions[0]);return;
     }
     notice.textContent=actions.length?`找到 ${found.hits.length} 道题${found.unindexed.length?`，另有 ${found.unindexed.length} 份原卷` : ''}。请选择卷号。`:'站内没有匹配的题。请核对科目、考季、卷号和题号。';
    }else{
     const found=await getNotebook({subject:subjectId,status:status.value,term});
     if(version!==request)return;
     actions=found.rows.map(row=>({...row,open:isCurrent=>openNotebookQuestion(row.question,isCurrent)}));
     notice.textContent=(actions.length?`找到 ${actions.length} 道错题，点题目即可复习。`:'当前筛选没有错题。')+(found.incomplete?' 部分题库或本地 PDF 读取失败，可重试。':'');
    }
    appendResults();
   }catch(error){if(version===request)notice.textContent=error.message||'无法查找，请重试。';}
  };
  more.onclick=appendResults;
  $('assistantExam').onclick=()=>selectMode('exam');
  $('assistantNotebook').onclick=()=>selectMode('notebook');
  $('assistantNotebookLink').onclick=()=>{++request;showNotebook(subject.value,status.value);setOpen(false);};
  $('assistantClose').onclick=()=>{++request;setOpen(false);launch.focus();};
  for(const control of [input,subject,status])control.addEventListener('input',()=>{++request;resetResults();});
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();$('assistantClose').click();}});
  launch.onclick=()=>{
   if(suppressClick)return;
   if(!panel.hidden)++request;
   setOpen(panel.hidden);
  };
  function startDrag(event){
   if(event.button!==0||event.isPrimary===false)return;
   const rect=launch.getBoundingClientRect();
   suppressClick=false;
   drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,moved:false};
   event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event){
   if(!drag||event.pointerId!==drag.id)return;
   const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
   if(!drag.moved&&Math.hypot(dx,dy)<6)return;
   drag.moved=true;launch.classList.add('is-dragging');position={x:drag.left+dx,y:drag.top+dy};layout();
  }
  function endDrag(event){
   if(!drag||event.pointerId!==drag.id)return;
   suppressClick=drag.moved;
   launch.classList.remove('is-dragging');
   drag=null;
   root.setTimeout(()=>{suppressClick=false;},0);
  }
  for(const target of [launch,handle]){
   target.addEventListener('pointerdown',startDrag);
   target.addEventListener('pointermove',moveDrag);
   target.addEventListener('pointerup',endDrag);
   target.addEventListener('pointercancel',endDrag);
   target.addEventListener('lostpointercapture',endDrag);
  }
  launch.addEventListener('keydown',event=>{
   const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
   if(!direction)return;
   event.preventDefault();
   const rect=launch.getBoundingClientRect();
   position={x:rect.left+direction[0]*24,y:rect.top+direction[1]*24};layout();
  });
  root.addEventListener('resize',layout);
  if(root.ResizeObserver)new root.ResizeObserver(layout).observe(panel);
  widget.hidden=false;
 }
 const api={parseLookup,paperMatches,numberMatches,searchPapers,moveWithinViewport,petImageType,mount};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.ChapterLabAssistant=api;
})(globalThis);

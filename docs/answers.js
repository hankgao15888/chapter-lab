/* MIT License · Display only the official answer regions belonging to a question. */
(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function create({getQuestion,onChange=()=>{},fetcher=root.fetch.bind(root),renderer=root.ChapterLabQuestions}){
  const papers=new Map(),pendingPapers=new Map(),entries=new Map(),pending=new Map();
  function paper(q){
   if(papers.has(q.paperId))return Promise.resolve(papers.get(q.paperId));
   if(pendingPapers.has(q.paperId))return pendingPapers.get(q.paperId);
   const request=fetcher('answers/'+encodeURIComponent(q.paperId)+'.json?v=1.4.0').then(async response=>{
    if(!response.ok)throw Error('答案索引暂时无法读取，请重试。');
    const data=await response.json();
    if(data.paperId!==q.paperId||!data.questions||new URL(data.renderMs||data.ms).protocol!=='https:')throw Error('答案索引校验失败。');
    papers.set(q.paperId,data);return data;
   }).finally(()=>pendingPapers.delete(q.paperId));
   pendingPapers.set(q.paperId,request);return request;
  }
  function state(id){return entries.get(id)||{status:'idle'};}
  function notify(id){
   if(root.document)for(const element of root.document.querySelectorAll('[data-answer-visual]'))if(element.dataset.answerVisual===id)element.innerHTML=visual(id);
   onChange(id);
  }
  async function prepare(q){
   const data=await paper(q),answer=data.questions[q.id];
   if(answer?.unavailable){entries.set(q.id,{status:'unavailable',note:answer.note});notify(q.id);return state(q.id);}
   if(!answer?.parts?.length)throw Error('本题官方解答暂未能定位，请稍后重试。');
   for(const part of answer.parts)if(!Number.isInteger(part.page)||part.page<1||!Array.isArray(part.box)||part.box.length!==4||!part.box.every(Number.isFinite)||part.box[2]<=part.box[0]||part.box[3]<=part.box[1])throw Error('答案区域校验失败。');
   const entry=entries.get(q.id);entry.option=answer.option;entry.note=answer.note;
   if(answer.keyPoints){
    if(!Array.isArray(answer.keyPoints)||!answer.keyPoints.length||answer.keyPoints.some(point=>typeof point!=='string'||!point.trim()))throw Error('答案要点校验失败。');
    entry.keyPoints=answer.keyPoints;entry.images=[];entry.status='ready';notify(q.id);return entry;
   }
   const source={id:q.id+'::answer',qp:data.renderMs||data.ms,parts:answer.parts.map(part=>({...part,exact:true})),images:[]};
   entry.source=source;notify(q.id);
   await renderer.load(source);entry.images=source.images;entry.status='ready';notify(q.id);return entry;
  }
  function load(q){
   if(['ready','unavailable'].includes(state(q.id).status))return Promise.resolve(state(q.id));
   if(pending.has(q.id))return pending.get(q.id);
   entries.set(q.id,{status:'loading',images:[]});notify(q.id);
   const request=prepare(q).catch(error=>{entries.set(q.id,{status:'error',error:error.message||'官方解答暂时无法加载，请重试。'});notify(q.id);throw error;}).finally(()=>pending.delete(q.id));
   pending.set(q.id,request);return request;
  }
  function visual(id){
   const entry=state(id),q=getQuestion(id);
   if(entry.status==='unavailable')return `<div class="solution-note" role="status"><strong>本题官方解答未公开</strong><p>${esc(entry.note)}</p></div>`;
   if(entry.status==='ready'&&entry.keyPoints)return `<strong class="solution-key-title">官方答案要点（整理）</strong><ol class="solution-key">${entry.keyPoints.map(point=>`<li>${esc(point)}</li>`).join('')}</ol><p class="solution-note">${esc(entry.note)}</p>`;
   if(entry.status==='ready')return `${entry.option?`<div class="correct-option">正确选项：<strong>${esc(entry.option)}</strong></div><p class="solution-note">官方评分标准仅给出正确选项，未提供逐步推导。</p>`:''}${entry.note?`<p class="solution-note">${esc(entry.note)}</p>`:''}${entry.images.map(src=>`<img src="${esc(src)}" alt="${esc(q?.title)} 原题 Q${esc(q?.number)} 官方答案与得分点">`).join('')}`;
   if(entry.status==='error')return `<div class="question-load-error" role="status"><strong>官方解答暂未加载</strong><p>${esc(entry.error)}</p><button class="quiet" data-retry-answer="${esc(id)}">重试加载解答</button></div>`;
   return `<div class="question-loading" role="status"><span class="loading-dot"></span><strong>正在加载本题官方解答…</strong><p>答案、计算过程、图示与得分点将在这里直接显示。</p></div>`;
  }
  function content(q,collapsible=true){
   const body=`<div class="solution-source">${esc(q.title)} · 原题 Q${esc(q.number)} · 官方答案与得分点</div><div class="solution-images" data-answer-visual="${esc(q.id)}">${visual(q.id)}</div>`;
   return collapsible?`<details class="solution-panel" data-answer-question="${esc(q.id)}"><summary>查看答案与解析<span>官方解答</span></summary>${body}</details>`:`<div class="solution-panel solution-expanded">${body}</div>`;
  }
  if(root.document){
   root.document.addEventListener('toggle',event=>{const node=event.target;if(node.matches?.('details[data-answer-question]')&&node.open){const q=getQuestion(node.dataset.answerQuestion);if(q)load(q).catch(()=>{});}},true);
   root.document.addEventListener('click',event=>{const button=event.target.closest('[data-retry-answer]');if(button){const q=getQuestion(button.dataset.retryAnswer);if(q)load(q).catch(()=>{});}});
  }
  return {load,state,content};
 }
 const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ChapterLabAnswers=api;
})(typeof globalThis!=='undefined'?globalThis:this);

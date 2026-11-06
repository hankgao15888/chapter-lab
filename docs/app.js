/* Chapter Lab: buildless, browser-local practice. No API keys or server storage. */
'use strict';
if (!window.ChapterLabAuth || !window.ChapterLabAuth.isAuthenticated()) {
  throw new Error('Student login is required before loading Chapter Lab.');
}
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SUBJECT={physics:'物理',mathematics:'数学',furthermathematics:'进阶数学',chemistry:'化学',biology:'生物',economics:'经济'};
const BOARD={'oxford-aqa-international':'OxfordAQA','cie-international':'CIE International','edexcel-ial':'Edexcel IAL'};
const DIFF={foundation:'基础',standard:'标准',challenge:'挑战',unknown:'待核分'};
const CH=new Map(DB.chapters.map(c=>[c.id,c])), QM=new Map(DB.questions.map(q=>[q.id,q]));
const catalog=ChapterLabCatalogLoader.createCatalog(DB),subjectErrors=new Map();
const answers=ChapterLabAnswers.create({getQuestion:id=>QM.get(id),onChange:()=>{if($('#previewDialog').open)updatePreviewStatus();}});
const originalParts=q=>q.parts.filter(part=>part.role!=='source');
async function loadSubjects(subjects){
 const groups=await catalog.loadMany(subjects);
 for(const rows of groups)for(const q of rows)QM.set(q.id,q);
}
async function activateSubject(subject){
 subjectErrors.delete(subject);renderChapters();refreshYears();renderBank();
 try{await loadSubjects([subject]);}
 catch(error){subjectErrors.set(subject,error);}
 if(state.subject!==subject)return;
 refreshYears();renderChapters();renderBank();updateBasket();
 if(state.view==='history')renderHistory();
 if(state.view==='notebook')renderNotebook();
}
function renderSubjectStatus(){
 const error=subjectErrors.has(state.subject);
 $('#resultTitle').textContent=SUBJECT[state.subject]+'章节题库';
 $('#resultCount').textContent=error?'题库暂未加载':'正在加载所选科目…';
 $('#smartBtn').disabled=true;
 $('#questionList').innerHTML=`<div class="empty-state"><strong>${error?'这门科目的题库暂未加载':'正在加载'+SUBJECT[state.subject]+'题库…'}</strong>${error?'请检查网络后重试。':'首次打开需读取该科目的真题索引。'}${error?'<br><button class="quiet" id="retrySubject">重试加载</button>':''}</div>`;
 $('#pagination').innerHTML='';
 if(error)$('#retrySubject').onclick=()=>activateSubject(state.subject);
}

let saved={practice:{},overrides:{},papers:[]};
try{Object.assign(saved,JSON.parse(localStorage.getItem('chapterlab-v1')||'{}'));}catch{}
const notebookModel=ChapterLabNotebook;
const notebookSubjectFor=id=>QM.get(id)?.subject||notebookModel.subjectFromId(id);
saved.notebook=notebookModel.migrate(saved,notebookSubjectFor);
let state={subject:'physics',view:'bank',notebookSubject:null,notebookStatus:'wrong',chapters:new Set(),basket:[],page:1,paperPage:1,wrongPage:1,unmapped:false,title:'',minutes:90};
let previewQuestions=[];
const drafts={};
const pdfLibrary=ChapterLabPDFLibrary.create({chapters:DB.chapters,getOwner:()=>ChapterLabAuth.currentStudent(),getSubject:()=>state.subject,toast,onImported:()=>switchView('history')});
const qCh=q=>(saved.overrides[q.id]??q.chapters).filter(id=>CH.has(id));
const total=qs=>qs.reduce((s,q)=>s+(q.marks||0),0);
function persist(){try{localStorage.setItem('chapterlab-v1',JSON.stringify(saved));return true;}catch{toast('浏览器未能保存记录，请导出备份。');return false;}}
let toastTimer;function toast(t){$('#toast').textContent=t;$('#toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').style.display='none',3500);}
function badge(board){return `<span class="badge ${board==='cie-international'?'cie':board==='edexcel-ial'?'edexcel':''}">${BOARD[board]}</span>`;}
function wrongButton(q){const active=Boolean(saved.notebook[q.id]);return `<button type="button" class="wrong-toggle ${active?'is-wrong':''}" data-wrong-id="${esc(q.id)}" aria-pressed="${active}">${active?'✓ 已收录 · 移出错题':'＋ 收录错题'}</button>`;}
function syncPractice(){
 const count=Object.values(saved.practice).filter(status=>status==='wrong').length;
 $('#notebookCount').textContent=count>99?'99+':String(count);
 $('#notebookCount').hidden=!count;
 $('#notebookNav').setAttribute('aria-label',`错题本，共 ${count} 道错题`);
 $$('[data-wrong-id]').forEach(button=>{const active=Boolean(saved.notebook[button.dataset.wrongId]);button.classList.toggle('is-wrong',active);button.setAttribute('aria-pressed',String(active));button.textContent=active?'✓ 已收录 · 移出错题':'＋ 收录错题';});
 $$('[data-practice-status]').forEach(span=>{const result=saved.practice[span.dataset.practiceStatus];span.textContent=result==='wrong'?'↺ 错题':result==='correct'?'✓ 已掌握':'';span.hidden=!result;});
}
function setPractice(id,result){
 if(!QM.has(id))return;
 const previous=saved.practice[id],previousEntry=saved.notebook[id];
 notebookModel.update(saved,id,result,QM.get(id).subject);
 if(!persist()){if(previous===undefined)delete saved.practice[id];else saved.practice[id]=previous;if(previousEntry===undefined)delete saved.notebook[id];else saved.notebook[id]=previousEntry;return;}
 syncPractice();
 if(state.view==='notebook')renderNotebook();
 if(state.view==='history')renderHistory();
 if(state.view==='bank'&&($('#onlyWrong').checked||$('#excludeDone').checked))renderBank();
 toast(result==='wrong'?'已移至待掌握，可以继续复习。':result==='correct'?(saved.notebook[id]?'已移至「已掌握」，题目仍保留在错题本。':'已标记掌握。'):'已移出错题本并清除练习状态。');
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-wrong-id]');if(button)setPractice(button.dataset.wrongId,saved.notebook[button.dataset.wrongId]?'clear':'wrong');const review=event.target.closest('[data-notebook-result]');if(review)setPractice(review.dataset.questionId,review.dataset.notebookResult);});
function filters(){return {boards:$$('.boards input[value]:checked').map(x=>x.value),level:$('#level').value,year:$('#year').value,difficulty:$('#difficulty').value,search:$('#search').value.trim().toLowerCase(),wrong:$('#onlyWrong').checked,exclude:$('#excludeDone').checked};}
function refreshYears(){
 const previous=$('#year').value;
 const years=catalog.isLoaded(state.subject)?ChapterLabCatalog.availableYears(DB.questions,state.subject,filters().boards):[...new Set(filters().boards.flatMap(board=>DB.subjectIndex[state.subject]?.byBoard[board]?.years||[]))].sort((a,b)=>b-a);
 $('#year').innerHTML='<option value="">全部年份</option>'+years.map(year=>`<option value="${year}">${year}</option>`).join('');
 if(previous&&years.includes(Number(previous)))$('#year').value=previous;
}
function pool(){const f=filters();return DB.questions.filter(q=>{
 if(q.subject!==state.subject||!f.boards.includes(q.board))return false;
 const ch=qCh(q);if(state.unmapped&&ch.length)return false;
 if(state.chapters.size&&!ch.some(c=>state.chapters.has(c)))return false;
 if(f.level&&!ch.some(c=>CH.get(c)?.level===f.level||CH.get(c)?.level==='AS/A2'))return false;
 if(f.year&&q.year!==Number(f.year))return false;
 if(f.difficulty&&q.difficulty!==f.difficulty)return false;
 if(f.wrong&&saved.practice[q.id]!=='wrong')return false;
 if(f.exclude&&saved.practice[q.id])return false;
 return !f.search||`${q.text} ${q.number} ${q.title} ${q.sourceUnit} ${BOARD[q.board]} ${ch.map(c=>CH.get(c)?.zh).join(' ')}`.toLowerCase().includes(f.search);
});}
function renderChapters(){const counts=new Map();if(catalog.isLoaded(state.subject))DB.questions.filter(q=>q.subject===state.subject).forEach(q=>qCh(q).forEach(c=>counts.set(c,(counts.get(c)||0)+1)));else Object.entries(DB.subjectIndex[state.subject]?.chapterCounts||{}).forEach(([id,count])=>counts.set(id,count));
 let unit='';$('#chapters').innerHTML=DB.chapters.filter(c=>c.subject===state.subject).map(c=>{const head=c.unit!==unit?`<div class="unit-label"><span>${esc(c.unit)}</span><span>${c.level}</span></div>`:'';unit=c.unit;return head+`<label class="chapter ${counts.get(c.id)?'':'empty'}"><input type="checkbox" value="${c.id}" ${state.chapters.has(c.id)?'checked':''}><span>${esc(c.code)} ${esc(c.zh)}<small>${esc(c.name)}</small></span><span class="count">${counts.get(c.id)||0}</span></label>`;}).join('');
 $$('#chapters input').forEach(el=>el.onchange=()=>{el.checked?state.chapters.add(el.value):state.chapters.delete(el.value);state.unmapped=false;state.page=1;renderBank();});}
function renderBank(){if(!catalog.isLoaded(state.subject)){renderSubjectStatus();return;}$('#smartBtn').disabled=false;const qs=pool(),pageCount=Math.max(1,Math.ceil(qs.length/12));state.page=Math.min(state.page,pageCount);
 $('#resultTitle').textContent=state.unmapped?'待归类题目':state.chapters.size?`${state.chapters.size} 个章节的${SUBJECT[state.subject]}练习`:`全部${SUBJECT[state.subject]}章节`;
 $('#resultCount').textContent=`${qs.length} 道真题 · ${total(qs)} 分已识别 · 所有分类可调整`;
 $('#unmappedBtn').textContent=state.unmapped?'返回全部题目':'查看待归类';
 $('#questionList').innerHTML=qs.slice((state.page-1)*12,state.page*12).map(q=>card(q)).join('')||`<div class="empty-state"><strong>当前条件下还没有题目</strong>试试减少章节或考试局限制，也可到整卷档案查看原卷。<br>章节显示 0 表示当前题库尚未匹配到该章节。</div>`;
 $('#pagination').innerHTML=pagination(state.page,pageCount,'question');bindCards();}
function card(q){const ch=qCh(q),done=saved.practice[q.id],added=state.basket.includes(q.id);return `<article class="question-card" data-id="${q.id}"><div class="card-top">${badge(q.board)}<span>${q.year} · ${esc(q.sourceUnit)}</span><span>原题 Q${q.number}</span><span class="tag" data-practice-status="${esc(q.id)}" ${done?'':'hidden'}>${done==='wrong'?'↺ 错题':done==='correct'?'✓ 已掌握':''}</span><span class="difficulty">${DIFF[q.difficulty]}（估计） · ${q.marks??'?'} 分</span></div><h3>${ch.length?ch.map(c=>esc(CH.get(c).zh)).join(' / '):'待归类 · 请对照原题核对'} <span class="tag">${saved.overrides[q.id]?'已调整':'自动匹配建议'}</span></h3><p class="snippet">${esc(q.text.slice(0,240))}</p>${q.materialNote?`<p class="material-note">${esc(q.materialNote)}</p>`:''}${q.withdrawn?`<p class="material-note">${esc(q.answerNote)}</p>`:''}<div class="tags">${ch.map(c=>`<span class="tag">${esc(CH.get(c).code)}</span>`).join('')}<span class="tag">${q.images.length?q.images.length+' 张原题图':'可直接加载原题'} · 原卷第 ${[...new Set(originalParts(q).map(p=>p.page))].join('、')} 页</span></div><div class="card-bottom"><button class="text-button" data-action="expand">查看原题 ▾</button><a class="text-button" href="${q.qp}#page=${originalParts(q)[0]?.page||1}" target="_blank" rel="noopener">原卷 ↗</a>${q.ms?`<a class="text-button" href="${q.ms}" target="_blank" rel="noopener">评分标准 ↗</a>`:''}<button class="text-button" data-action="map">调整章节</button>${wrongButton(q)}<button class="add ${added?'added':''}" data-action="add" ${q.autoSelectable===false||q.withdrawn?'disabled':''}>${q.withdrawn?'官方已作废':q.autoSelectable===false?'缺配套材料':added?'✓ 已加入':'＋ 加入练习卷'}</button></div><div class="expand-slot"></div><div class="mapping-slot"></div>${answers.content(q)}</article>`;}
function bindCards(selector='#questionList'){$$(selector+' article').forEach(el=>{const q=QM.get(el.dataset.id);el.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{
 if(b.dataset.action==='add'){const i=state.basket.indexOf(q.id);i>=0?state.basket.splice(i,1):state.basket.push(q.id);b.classList.toggle('added',i<0);b.textContent=i<0?'✓ 已加入':'＋ 加入练习卷';updateBasket();}
 if(b.dataset.action==='expand'){const slot=el.querySelector('.expand-slot');if(slot.innerHTML){slot.innerHTML='';b.textContent='查看原题 ▾';return;}slot.innerHTML=`<div class="question-images">${questionContent(q)}<div class="actions"><button class="quiet" data-result="correct">✓ 我已掌握</button><button class="quiet" data-result="wrong">↺ 收录错题</button><button class="quiet" data-result="clear">清除状态</button></div></div>`;slot.querySelectorAll('[data-result]').forEach(bt=>bt.onclick=()=>{setPractice(q.id,bt.dataset.result);});b.textContent='收起原题 ▴';ChapterLabQuestions.load(q).catch(()=>{});}
 if(b.dataset.action==='map'){const slot=el.querySelector('.mapping-slot');if(slot.innerHTML){slot.innerHTML='';return;}slot.innerHTML=`<div class="mapping-editor"><p>对照原图选择章节，可按 Ctrl / Command 多选。仅在本浏览器生效。</p><select multiple size="8">${DB.chapters.filter(c=>c.subject===q.subject).map(c=>`<option value="${c.id}" ${qCh(q).includes(c.id)?'selected':''}>${esc(c.code)} · ${esc(c.zh)} (${c.level})</option>`).join('')}</select><button class="primary" data-save-map>保存调整</button> <button class="quiet" data-reset-map>恢复自动建议</button></div>`;slot.querySelector('[data-save-map]').onclick=()=>{saved.overrides[q.id]=[...slot.querySelector('select').selectedOptions].map(o=>o.value);persist();renderChapters();renderBank();if(state.view==='notebook')renderNotebook();toast('章节调整已保存。');};slot.querySelector('[data-reset-map]').onclick=()=>{delete saved.overrides[q.id];persist();renderChapters();renderBank();if(state.view==='notebook')renderNotebook();};}
 });});}
function pagination(page,count,type){return `<div class="pagination"><button data-page="${page-1}" data-type="${type}" ${page===1?'disabled':''}>← 上一页</button><span>${page} / ${count}</span><button data-page="${page+1}" data-type="${type}" ${page===count?'disabled':''}>下一页 →</button></div>`;}
document.addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(!b)return;if(b.dataset.type==='question'){state.page=Number(b.dataset.page);renderBank();$('.results-head').scrollIntoView({behavior:'smooth',block:'start'});}else if(b.dataset.type==='notebook'){state.wrongPage=Number(b.dataset.page);renderNotebook();$('#notebookView').scrollIntoView({behavior:'smooth',block:'start'});}else{state.paperPage=Number(b.dataset.page);renderPapers();$('#papersView').scrollIntoView({behavior:'smooth'});}});
function updateBasket(){state.basket=state.basket.filter(id=>QM.has(id));$$('.question-card [data-action="add"]').forEach(button=>{const el=button.closest('[data-id]'),q=QM.get(el.dataset.id);if(!q||q.autoSelectable===false||q.withdrawn)return;const added=state.basket.includes(q.id);button.classList.toggle('added',added);button.textContent=added?'✓ 已加入':'＋ 加入练习卷';});const qs=state.basket.map(id=>QM.get(id)),unknown=qs.filter(q=>!q.marks).length;$('#basketCount').textContent=`${qs.length} 道题`;$('#basketMarks').textContent=qs.length?`${total(qs)} 分${unknown?` + ${unknown} 道待核分`:''} · 约 ${state.minutes} 分钟`:'从题库加入，或智能生成';}
function renderPapers(){const term=$('#paperSearch').value.trim().toLowerCase();const rows=DB.papers.filter(p=>p.subject===state.subject&&`${p.title} ${p.unit} ${BOARD[p.board]} ${p.year}`.toLowerCase().includes(term));const count=Math.max(1,Math.ceil(rows.length/25));state.paperPage=Math.min(count,state.paperPage);$('#paperList').innerHTML=rows.slice((state.paperPage-1)*25,state.paperPage*25).map(p=>`<div class="archive-row">${badge(p.board)}<div><strong>${esc(p.title)}</strong><small>${esc(p.unit)} · ${SUBJECT[p.subject]}</small></div>${DB.importedPapers.includes(p.id)?'<span class="tag">已拆题</span>':`<span class="tag">${esc(DB.coverage?.unavailable?.find(item=>item.id===p.id)?.reason||'暂未拆题')}</span>`}<div class="row-links"><a href="${p.qp}" target="_blank" rel="noopener">试题原卷 ↗</a>${p.ms?`<a href="${p.ms}" target="_blank" rel="noopener">评分标准 ↗</a>`:'<span>暂无答案链接</span>'}</div></div>`).join('')||'<div class="empty-state">没有匹配的试卷。</div>';$('#paperPagination').innerHTML=pagination(state.paperPage,count,'paper');}
function notebookQuestions(){return [...QM.values()].filter(q=>q.subject===state.notebookSubject&&notebookModel.includes(saved,q.id,state.notebookStatus));}
function notebookPool(){
 const chapter=$('#notebookChapter').value,term=$('#notebookSearch').value.trim().toLowerCase();
 return notebookQuestions().filter(q=>{
  const chapters=qCh(q);
  if(chapter==='unmapped'&&chapters.length)return false;
  if(chapter&&chapter!=='unmapped'&&!chapters.includes(chapter))return false;
  return !term||`${q.text} ${q.number} ${q.title} ${q.sourceUnit} ${BOARD[q.board]} ${chapters.map(id=>CH.get(id)?.zh).join(' ')}`.toLowerCase().includes(term);
 });
}
function renderNotebook(){
 const summary=notebookModel.summary(saved),subject=state.notebookSubject;
 $('#notebookHome').classList.toggle('hidden',Boolean(subject));
 $('#notebookDetail').classList.toggle('hidden',!subject);
 if(!subject){
  $('#notebookTitle').textContent='我的错题本';
  $('#notebookDescription').textContent='先选科目，再把错题逐一练会。';
  $('#notebookTotal').textContent=String(Object.values(summary).reduce((sum,item)=>sum+item.total,0));
  $('#notebookSubjectLabel').textContent='道已收录题目';
  const symbols={physics:'↗',mathematics:'ƒ',furthermathematics:'∫',chemistry:'⚗',biology:'✧',economics:'↗'};
  $('#notebookSubjects').innerHTML=Object.entries(SUBJECT).map(([id,name])=>{
   const stats=summary[id];
   return `<button type="button" class="notebook-subject-card" data-notebook-subject="${id}" aria-label="${esc(name)}，待掌握 ${stats.wrong} 道，已掌握 ${stats.correct} 道"><span class="notebook-subject-icon" aria-hidden="true">${symbols[id]}</span><h3>${esc(name)}</h3><p>待掌握 <strong>${stats.wrong}</strong><span>已掌握 <strong>${stats.correct}</strong></span></p><span class="notebook-subject-link">查看科目错题 <b aria-hidden="true">→</b></span></button>`;
  }).join('');
  return;
 }
 const stats=summary[subject],mastered=state.notebookStatus==='correct';
 $('#notebookDescription').textContent='练会一道，收进已掌握；还不熟，就移回待掌握。';
 $('#notebookPendingCount').textContent=String(stats.wrong);
 $('#notebookMasteredCount').textContent=String(stats.correct);
 $$('[data-notebook-status]').forEach(button=>{const selected=button.dataset.notebookStatus===state.notebookStatus;button.classList.toggle('selected',selected);button.setAttribute('aria-selected',String(selected));});
 $('#notebookPractice').textContent='按待掌握错题组卷 →';
 $('#notebookTitle').textContent=SUBJECT[state.subject]+'错题本';
 $('#notebookSubjectLabel').textContent='道'+SUBJECT[state.subject]+'收录题目';
 if(!catalog.isLoaded(state.subject)){
  const error=subjectErrors.has(state.subject);
  $('#notebookTotal').textContent='—';$('#notebookResultCount').textContent=error?'题库暂未加载':'正在载入错题对应的题库…';
  $('#notebookPractice').disabled=true;
  $('#notebookList').innerHTML=`<div class="empty-state"><strong>${error?'暂时无法显示错题':'正在加载'+SUBJECT[state.subject]+'错题…'}</strong>${error?'记录仍在本浏览器中，请检查网络后重试。<br><button class="quiet" id="retryNotebook">重试加载</button>':'首次打开需读取该科目题库。'}</div>`;
  $('#notebookPagination').innerHTML='';
  if(error)$('#retryNotebook').onclick=()=>{activateSubject(state.subject);renderNotebook();};
  return;
 }
 const all=notebookQuestions(),counts=new Map(),selected=$('#notebookChapter').value;
 for(const q of all){const chapters=qCh(q);for(const id of chapters.length?chapters:['unmapped'])counts.set(id,(counts.get(id)||0)+1);}
 $('#notebookChapter').innerHTML='<option value="">全部错题章节</option>'+DB.chapters.filter(ch=>ch.subject===state.subject&&counts.has(ch.id)).map(ch=>`<option value="${esc(ch.id)}">${esc(ch.code)} · ${esc(ch.zh)} (${counts.get(ch.id)})</option>`).join('')+(counts.has('unmapped')?`<option value="unmapped">待归类 (${counts.get('unmapped')})</option>`:'');
 if(counts.has(selected))$('#notebookChapter').value=selected;
 const qs=notebookPool(),pages=Math.max(1,Math.ceil(qs.length/12));state.wrongPage=Math.min(state.wrongPage,pages);
 $('#notebookTotal').textContent=String(stats.total);
 $('#notebookResultCount').textContent=`${SUBJECT[subject]} · ${mastered?'已掌握':'待掌握'} ${all.length} 道 · 当前筛选 ${qs.length} 道`;
 $('#notebookPractice').disabled=mastered||!qs.some(q=>!q.withdrawn&&q.autoSelectable!==false&&q.marks&&qCh(q).length);
 $('#notebookList').innerHTML=qs.slice((state.wrongPage-1)*12,state.wrongPage*12).map(q=>`<section class="notebook-entry">${card(q)}<div class="notebook-review-actions"><span>${mastered?'已掌握的题目会保留在这里。':'这道题现在掌握了吗？'}</span><button type="button" class="${mastered?'quiet':'primary'}" data-question-id="${esc(q.id)}" data-notebook-result="${mastered?'wrong':'correct'}">${mastered?'↺ 仍需复习，移回待掌握':'✓ 我已掌握'}</button></div></section>`).join('')||(all.length?'<div class="empty-state"><strong>当前筛选没有题目</strong>试试其他章节或搜索词。<br><button class="quiet" id="resetNotebookFilters">清除筛选</button></div>':`<div class="empty-state"><span class="notebook-empty-mark" aria-hidden="true">${mastered?'✓':'↺'}</span><strong>${mastered?'还没有已掌握的'+SUBJECT[subject]+'错题':'暂时没有待掌握的'+SUBJECT[subject]+'错题'}</strong>${mastered?'在「待掌握」中点击「我已掌握」，题目就会保留在这里。':'在题库或练习卷中点击「收录错题」，就能按科目接着练。'}<br><button class="quiet" id="browseNotebookBank">去题库选题 →</button></div>`);
 $('#notebookPagination').innerHTML=qs.length?pagination(state.wrongPage,pages,'notebook'):'';
 bindCards('#notebookList');
 if($('#resetNotebookFilters'))$('#resetNotebookFilters').onclick=()=>{$('#notebookSearch').value='';$('#notebookChapter').value='';state.wrongPage=1;renderNotebook();};
 if($('#browseNotebookBank'))$('#browseNotebookBank').onclick=()=>switchView('bank');
}
$('#notebookSubjects').onclick=event=>{const button=event.target.closest('[data-notebook-subject]');if(!button||!SUBJECT[button.dataset.notebookSubject])return;state.notebookSubject=button.dataset.notebookSubject;state.notebookStatus='wrong';selectSubject(state.notebookSubject);};
$('#notebookBack').onclick=()=>{state.notebookSubject=null;renderNotebook();};
$('#notebookStatusTabs').onclick=event=>{const button=event.target.closest('[data-notebook-status]');if(!button)return;state.notebookStatus=button.dataset.notebookStatus;state.wrongPage=1;$('#notebookChapter').value='';renderNotebook();};
$('#notebookSearch').oninput=()=>{state.wrongPage=1;renderNotebook();};
$('#notebookChapter').onchange=()=>{state.wrongPage=1;renderNotebook();};
$('#notebookPractice').onclick=()=>{
 const chapter=$('#notebookChapter').value;
 state.chapters.clear();if(CH.has(chapter))state.chapters.add(chapter);
 state.unmapped=chapter==='unmapped';state.page=1;
 $('#search').value=$('#notebookSearch').value.trim();$('#onlyWrong').checked=true;$('#excludeDone').checked=false;
 $('#level').value='';$('#difficulty').value='';$$('.boards input[value]').forEach(input=>input.checked=true);refreshYears();$('#year').value='';
 $('#avoidDone').checked=false;$('#paperTitle').value=SUBJECT[state.subject]+' · 错题再练';
 renderChapters();renderBank();switchView('bank');smartInfo();$('#smartDialog').showModal();
};
function switchView(view){if(view==='notebook')state.notebookSubject=null;state.view=view;document.body.dataset.view=view;$$('.view').forEach(x=>x.classList.add('hidden'));$('#'+view+'View').classList.remove('hidden');$$('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('#basket').classList.toggle('study-hidden',view==='study');if(view==='papers')renderPapers();if(view==='history')renderHistory();if(view==='notebook')renderNotebook();}
$$('.nav').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
function selectSubject(subject){drafts[state.subject]={basket:[...state.basket],title:state.title,minutes:state.minutes,target:state.target};state.subject=subject;Object.assign(state,{basket:[],title:'',minutes:90,target:undefined},drafts[state.subject]||{});state.chapters.clear();state.page=1;state.paperPage=1;state.wrongPage=1;$('#notebookSearch').value='';$('#notebookChapter').value='';state.unmapped=false;$$('[data-subject]').forEach(x=>x.classList.toggle('selected',x.dataset.subject===subject));activateSubject(state.subject);updateBasket();if(state.view==='papers')renderPapers();if(state.view==='history')renderHistory();if(state.view==='notebook')renderNotebook();}
$$('[data-subject]').forEach(b=>b.onclick=()=>selectSubject(b.dataset.subject));
['level','year','difficulty','onlyWrong','excludeDone'].forEach(id=>$('#'+id).onchange=()=>{state.page=1;renderBank();});$$('.boards input[value]').forEach(x=>x.onchange=()=>{state.page=1;refreshYears();renderBank();});let searchTimer;$('#search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.page=1;renderBank();},180);};$('#paperSearch').oninput=()=>{state.paperPage=1;renderPapers();};
$('#clearChapters').onclick=()=>{state.chapters.clear();state.unmapped=false;renderChapters();renderBank();};$('#unmappedBtn').onclick=()=>{state.unmapped=!state.unmapped;state.chapters.clear();state.page=1;renderChapters();renderBank();};$('#clearBasket').onclick=()=>{state.basket=[];updateBasket();renderBank();};

// A bounded subset-sum search approaches the score target without repeating a question.
// Preference scoring encourages chosen chapter coverage and requested difficulty proportions.
const selectPaper=(candidates,target,recipe,mix)=>ChapterLabSelection.selectPaper(candidates,target,recipe,mix,{chapters:state.chapters,getChapters:qCh});
function smartInfo(){let qs=pool().filter(q=>!q.withdrawn&&q.autoSelectable!==false&&q.marks&&qCh(q).length);if($('#avoidDone').checked)qs=qs.filter(q=>!saved.practice[q.id]);$('#smartInfo').textContent=`当前可自动组卷：${qs.length} 道 / ${total(qs)} 分。未知分值或待归类题不参与自动选题；组卷会替换当前选题篮。难度配比按题数尽量匹配。`;}
$('#smartBtn').onclick=()=>{smartInfo();$('#smartDialog').showModal();};$('#avoidDone').onchange=smartInfo;$('#targetMarks').oninput=()=>{if(Number($('#targetMarks').value)>0)$('#minutes').value=Math.round(Number($('#targetMarks').value)*1.5);};
$('#generateBtn').onclick=()=>{
 const target=Number($('#targetMarks').value),mins=Number($('#minutes').value);if(!Number.isInteger(target)||target<5||target>300||!Number.isFinite(mins)||mins<5||mins>600){toast('请输入5–300的整数目标分值与5–600分钟时长。');return;}
 let qs=pool().filter(q=>!q.withdrawn&&q.autoSelectable!==false&&Number.isInteger(q.marks)&&q.marks>0&&q.marks<=target&&qCh(q).length);if($('#avoidDone').checked)qs=qs.filter(q=>!saved.practice[q.id]);const result=selectPaper(qs,target,$('#recipe').value,$('#freshYears').checked);
 if(!result){$('#smartInfo').textContent='当前题池无法生成。请增加来源或章节、降低难度限制，或取消避开已练题。';return;}
 state.basket=result.ids;state.minutes=mins;state.title=$('#paperTitle').value.trim()||`${SUBJECT[state.subject]} · ${state.chapters.size?state.chapters.size+'章专题':'综合'}练习`;state.target=target;updateBasket();renderBank();$('#smartDialog').close();openPreview();if(result.achieved<target)toast(`已生成 ${result.achieved} 分，距目标差 ${target-result.achieved} 分。`);
};
function paperHtml(qs,includeAnswers,forPrint=false){
 const contexts=new Set();
 const body=qs.map((q,i)=>{
  const omit=q.contextKey&&contexts.has(q.contextKey);
  if(q.contextKey)contexts.add(q.contextKey);
  return `<section class="paper-question"><div class="qhead"><strong>${i+1}. ${qCh(q).map(c=>esc(CH.get(c).zh)).join(' / ')||'待归类'}</strong><span>${q.marks??'?'} 分</span></div>${forPrint?'':`<div class="paper-practice-actions">${wrongButton(q)}</div>`}<div class="qsource">${BOARD[q.board]} · ${esc(q.title)} · 原题 Q${q.number} · 原卷页 ${originalParts(q).map(p=>p.page).join('、')}</div>${q.contextPartsCount?`<p class="print-note">${omit?'阅读材料见本卷前题。':'本题所需阅读材料与图表列于下方。'}</p>`:''}${questionContent(q,omit)}${!includeAnswers&&!forPrint?answers.content(q):''}</section>`;
 }).join('');
 const index=includeAnswers?`<section class="answer-section"><h2>官方答案与解析</h2><p class="print-note">按本卷题目顺序列出对应官方答案、计算过程和评分细则。选择题若官方只给出选项，会单独说明。</p>${qs.map((q,i)=>`<section class="paper-answer"><h3>${i+1}. 原题 Q${esc(q.number)}</h3>${answers.content(q,false)}</section>`).join('')}</section>`:'';
 return body+index;
}
function updatePreviewStatus(){
 const ready=previewQuestions.filter(q=>q.images.length).length;
 const failures=previewQuestions.filter(q=>!q.images.length&&ChapterLabQuestions.state(q.id).status==='error').length;
 const missingMaterials=previewQuestions.filter(q=>q.autoSelectable===false).length;
 const answersIncluded=$('#includeAnswers').checked,answerReady=previewQuestions.filter(q=>['ready','unavailable'].includes(answers.state(q.id).status)).length;
 const unavailableAnswers=answersIncluded?previewQuestions.filter(q=>answers.state(q.id).status==='unavailable').length:0;
 const answerFailures=answersIncluded?previewQuestions.filter(q=>answers.state(q.id).status==='error').length:0;
 const complete=ready===previewQuestions.length&&ready>0&&!missingMaterials&&(!answersIncluded||answerReady===previewQuestions.length);
 $('#previewProgress').textContent=missingMaterials?`${missingMaterials} 道题缺少配套阅读材料，请移除后再打印。`:complete?`${ready} 道真实题目${answersIncluded?'及解答内容':''}已加载，可打印${unavailableAnswers?'。其中 '+unavailableAnswers+' 道题的官方解答未公开，答案部分已注明。':'完整练习卷。'}`:answersIncluded&&ready===previewQuestions.length?`正在加载官方解答：${answerReady} / ${previewQuestions.length}${answerFailures?'，部分解答暂未加载，请重试。':'。'}`:`正在加载真实题目：${ready} / ${previewQuestions.length}${failures?`，${failures} 道暂未加载，请重试。`:'。'}`;
 $('#printPaper').disabled=!complete;
 $('#printPaper').textContent=complete?'打印 / 存为 PDF':answersIncluded&&ready===previewQuestions.length?`解答加载中 ${answerReady}/${previewQuestions.length}`:`题目加载中 ${ready}/${previewQuestions.length}`;
 $('#retryPaper').classList.toggle('hidden',!failures&&!answerFailures);
}
function loadPreviewQuestions(){
 for(const q of previewQuestions){ChapterLabQuestions.load(q).catch(()=>{});if($('#includeAnswers').checked)answers.load(q).catch(()=>{});}
 updatePreviewStatus();
}
function openPreview(){
 if(!state.basket.length){toast('请先选题或智能组卷。');return;}
 previewQuestions=state.basket.map(id=>QM.get(id));
 const unknown=previewQuestions.filter(q=>!q.marks).length;
 $('#previewTitle').textContent=state.title||`${SUBJECT[state.subject]} · 章节练习`;
 $('#previewMeta').textContent=`${previewQuestions.length} 道 · ${total(previewQuestions)} 分${unknown?` + ${unknown} 道待核分`:''} · 建议 ${state.minutes} 分钟${state.target&&total(previewQuestions)<state.target?` · 距目标 ${state.target} 分差 ${state.target-total(previewQuestions)} 分`:''}`;
 $('#paperPreview').innerHTML=paperHtml(previewQuestions,$('#includeAnswers').checked);
 if(!$('#previewDialog').open)$('#previewDialog').showModal();
 loadPreviewQuestions();
}
$('#previewBtn').onclick=openPreview;
$('#retryPaper').onclick=loadPreviewQuestions;
$('#includeAnswers').onchange=()=>{$('#paperPreview').innerHTML=paperHtml(previewQuestions,$('#includeAnswers').checked);loadPreviewQuestions();};
$('#printPaper').onclick=async()=>{
 if(previewQuestions.some(q=>q.autoSelectable===false)){toast('请先移除缺少阅读材料的题目。');return;}
 if(previewQuestions.some(q=>!q.images.length)){loadPreviewQuestions();toast('正在加载题目，全部加载后即可打印。');return;}
 if($('#includeAnswers').checked&&previewQuestions.some(q=>!['ready','unavailable'].includes(answers.state(q.id).status))){loadPreviewQuestions();toast('正在加载官方解答，全部准备完成后即可附答案打印。');return;}
 $('#printArea').innerHTML=`<h1 class="print-title">${esc($('#previewTitle').textContent)}</h1><div class="print-meta">${esc($('#previewMeta').textContent)} · 姓名 __________ · 日期 __________</div><p class="print-note">本卷按 OxfordAQA 官方课程单元归类；保留原题图像、共享题干与原题号便于核对。</p>`+paperHtml(previewQuestions,$('#includeAnswers').checked,true);
 try{await Promise.all($$('#printArea img').map(img=>img.decode()));}
 catch{toast('部分题图尚未准备完成，请稍后重试打印。');return;}
 $('#previewDialog').close();window.print();
};
function download(name,obj){const url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
$('#exportPaper').onclick=()=>download('chapter-lab-paper.json',{format:'chapterlab-paper-v1',title:$('#previewTitle').textContent,minutes:state.minutes,questions:previewQuestions.map(q=>({...q,images:[],chapters:qCh(q)}))});
$('#savePaper').onclick=()=>{saved.papers.unshift({id:Date.now().toString(36),title:$('#previewTitle').textContent,minutes:state.minutes,subject:state.subject,ids:previewQuestions.map(q=>q.id),date:new Date().toISOString()});persist();toast('已保存到「我的练习」。');};
function renderHistory(){pdfLibrary.renderHistory();const rows=saved.papers.filter(p=>p.subject===state.subject);const wrong=Object.entries(saved.practice).filter(([id,status])=>status==='wrong'&&QM.get(id)?.subject===state.subject).length;$('#historyList').innerHTML=`<div class="info-box">${SUBJECT[state.subject]}：已记录 ${Object.keys(saved.practice).filter(id=>QM.get(id)?.subject===state.subject).length} 道练习，其中 ${wrong} 道错题。可打开「错题本」集中复习、查看答案或按错题组卷。</div>`+rows.map(p=>`<div class="history-row"><div><strong>${esc(p.title)}</strong><small>${p.ids.filter(id=>QM.has(id)).length} 道 · ${p.minutes} 分钟 · ${new Date(p.date).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})}</small></div><div class="row-links"><button data-history="${esc(p.id)}">继续练习 →</button><button data-delete="${esc(p.id)}">删除</button></div></div>`).join('')+(rows.length?'':'<div class="empty-state"><strong>留下一份练习记录</strong>在练习卷预览中点击「保存练习」，下次可以接着做。</div>');$$('[data-history]').forEach(b=>b.onclick=()=>{const p=saved.papers.find(p=>p.id===b.dataset.history);state.basket=p.ids.filter(id=>QM.has(id));state.title=p.title;state.minutes=p.minutes;delete state.target;updateBasket();openPreview();});$$('[data-delete]').forEach(b=>b.onclick=()=>{saved.papers=saved.papers.filter(p=>p.id!==b.dataset.delete);persist();renderHistory();});}
$('#backupBtn').onclick=()=>download('chapter-lab-backup.json',{format:'chapterlab-backup-v1',...saved});
$('#restoreInput').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>5e6)throw Error();const data=JSON.parse(await f.text());if(data.format!=='chapterlab-backup-v1'||!Array.isArray(data.papers)||typeof data.practice!=='object'||typeof data.overrides!=='object')throw Error();const referenced=new Set(data.papers.map(p=>p.subject).filter(subject=>SUBJECT[subject]));for(const id of [...Object.keys(data.practice),...Object.keys(data.overrides)])for(const subject of Object.keys(SUBJECT))if(id.includes('-'+subject+'-'))referenced.add(subject);toast('正在载入备份涉及的题库…');await loadSubjects([...referenced]);for(const [id,v] of Object.entries(data.practice))if(QM.has(id)&&['correct','wrong'].includes(v))saved.practice[id]=v;for(const [id,ids] of Object.entries(data.overrides))if(QM.has(id)&&Array.isArray(ids))saved.overrides[id]=ids.filter(c=>CH.has(c)&&CH.get(c).subject===QM.get(id).subject);const safe=data.papers.filter(p=>typeof p.title==='string'&&typeof p.id==='string'&&Array.isArray(p.ids)&&Number.isFinite(p.minutes)&&SUBJECT[p.subject]&&Number.isFinite(Date.parse(p.date))).map(p=>({...p,ids:p.ids.filter(id=>QM.has(id))}));const have=new Set(saved.papers.map(p=>p.id));saved.papers.push(...safe.filter(p=>!have.has(p.id)));notebookModel.restore(saved,data,notebookSubjectFor);persist();syncPractice();renderHistory();renderChapters();renderBank();if(state.view==='notebook')renderNotebook();toast('备份已合并到当前浏览器。');}catch{toast('文件不是有效的 Chapter Lab 备份。');}e.target.value='';};
function coverageTable(){
 const rows=Object.keys(BOARD).map(board=>{
  const entries=Object.values(DB.subjectIndex).map(subject=>subject.byBoard[board]).filter(Boolean);
  const years=entries.flatMap(entry=>entry.years);
  return `<tr><td>${BOARD[board]}</td><td>${Math.min(...years)}–${Math.max(...years)}</td><td>${entries.reduce((sum,entry)=>sum+entry.paperCount,0)}</td><td>${entries.reduce((sum,entry)=>sum+entry.count,0)}</td></tr>`;
 }).join('');
 return `<table class="answer-table"><thead><tr><th>考试局</th><th>年份</th><th>已拆试卷</th><th>题目</th></tr></thead><tbody>${rows}</tbody></table><p><a href="coverage.json" target="_blank" rel="noopener">查看逐科逐卷覆盖与分值核对记录 ↗</a></p>`;
}
$('#aboutBtn').onclick=()=>{
 $('#coverage').innerHTML=`<div class="coverage-grid"><div><strong>${DB.coverage.questionCount}</strong><small>道已拆分题目 · ${DB.importedPapers.length}套试卷</small></div><div><strong>${Object.keys(DB.subjectIndex).length}</strong><small>门科目 · ${DB.papers.length}条整卷目录记录</small></div><div><strong>${DB.coverage.chaptersCovered} / ${DB.chapters.length}</strong><small>个分类有匹配建议</small></div><div><strong>${DB.coverage.unmappedQuestionCount}</strong><small>道待归类题目</small></div></div><p>已拆题范围：按来源网站全部年份、考季与变体整理。各科的实际收录年份随科目和考试局显示；不代表网站之外的全部历史试卷。外链可用性随来源网站变化。</p>${coverageTable()}${DB.answerCoverage?`<p>官方答案已定位 ${DB.answerCoverage.locatedQuestionCount} 道，可在题目下直接展开。${DB.answerCoverage.unavailable.length?DB.answerCoverage.unavailable.length+' 道题的公开评分标准缺少解答，已逐题说明。':''}</p>`:''}${DB.coverage.materialIncompleteQuestions?`<p class="material-note">${DB.coverage.materialIncompleteQuestions} 道题的配套阅读材料暂不可用，已标注并排除组卷。</p>`:''}`;
 $('#aboutDialog').showModal();
};
$$('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close();}));
$('#questionTotal').textContent=DB.coverage.questionCount.toLocaleString('en-US');$('#classificationCount').textContent=DB.chapters.length;$('#importTotal').textContent=`${DB.importedPapers.length} 套历年试卷 · ${DB.chapters.length} 个课程分类`;
activateSubject(state.subject);updateBasket();syncPractice();


function questionVisual(q,omitContext=false){
 if(q.images.length)return q.images.slice(omitContext?(q.contextPartsCount||0):0).map(src=>`<img src="${esc(src)}" alt="${esc(BOARD[q.board])} ${esc(q.title)} 原题 Q${q.number}" loading="eager">`).join('');
 const status=ChapterLabQuestions.state(q.id);
 if(status.status==='error')return `<div class="question-load-error" role="status"><strong>这道题暂未加载</strong><p>${esc(status.error)}</p><button class="quiet" data-load-question="${esc(q.id)}">重试加载题目</button> <a href="${esc(q.qp)}#page=${originalParts(q)[0]?.page||1}" target="_blank" rel="noopener">打开原卷 ↗</a></div>`;
 return `<div class="question-loading" role="status"><span class="loading-dot"></span><strong>正在加载真实题目…</strong><p>原题 Q${q.number} · ${q.parts.length} 个题图区域。公式与图表将随题目一同显示。</p></div>`;
}
function questionContent(q,omitContext=false){return `<div class="question-visual" data-question-visual="${esc(q.id)}" data-omit-context="${omitContext?'1':'0'}">${questionVisual(q,omitContext)}</div>`;}
ChapterLabQuestions.subscribe(id=>{
 const q=QM.get(id);if(!q)return;
 $$('[data-question-visual]').filter(el=>el.dataset.questionVisual===id).forEach(el=>el.innerHTML=questionVisual(q,el.dataset.omitContext==='1'));
 if($('#previewDialog').open)updatePreviewStatus();
});
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-load-question]');
 if(button){const q=QM.get(button.dataset.loadQuestion);if(q)ChapterLabQuestions.load(q).catch(()=>{});}
});
const localImageUrls=[];
$('#importBankBtn').onclick=()=>$('#importDialog').showModal();
$('#localBankInput').onchange=async e=>{
 const button=$('#importBankBtn');button.disabled=true;button.textContent='正在读取题库…';
 try{
  const files=[...e.target.files];
  if(!files.length)return;
  if(files.length>10000||files.reduce((s,f)=>s+f.size,0)>300*1024*1024)throw Error('题库文件夹过大，请选择解压后的 Chapter Lab 文件夹。');
  const dataFile=files.find(f=>f.name==='data.js');
  if(!dataFile||dataFile.size>20*1024*1024)throw Error('未找到有效的 data.js，请选择解压后的完整题库文件夹。');
  let raw=(await dataFile.text()).trim().replace(/^\uFEFF/,'');
  const prefix='window.DB=';
  if(!raw.startsWith(prefix))throw Error('data.js 格式不匹配。');
  raw=raw.slice(prefix.length).replace(/;\s*$/,'');
  const bank=JSON.parse(raw);
  if(!bank||!Array.isArray(bank.questions))throw Error('题库格式不匹配。');await loadSubjects(bank.questions.map(q=>q.subject).filter(subject=>SUBJECT[subject]));
  const imageFiles=new Map();
  for(const file of files){
   const relative=(file.webkitRelativePath||file.name).replace(/\\/g,'/');
   const idx=relative.lastIndexOf('/questions/');
   if(idx>=0&&/\.(webp|png|jpe?g)$/i.test(relative))imageFiles.set(relative.slice(idx+1),file);
  }
  const updates=[];
  for(const item of bank.questions){
   const existing=QM.get(item.id);
   if(!existing||!Array.isArray(item.images)||!item.images.length)continue;
   if(item.images.some(path=>typeof path!=='string'||!/^questions\/[a-zA-Z0-9_.-]+\.(webp|png|jpe?g)$/i.test(path)||!imageFiles.has(path)))continue;
   updates.push({existing,text:typeof item.text==='string'?item.text.slice(0,12000):existing.text,files:item.images.map(path=>imageFiles.get(path))});
  }
  if(!updates.length)throw Error('该文件夹内没有与当前索引匹配的完整题图。');
  for(const update of updates){
   update.existing.images=update.files.map(file=>{const url=URL.createObjectURL(file);localImageUrls.push(url);return url;});
   update.existing.text=update.text;
  }
  $('#distributionNote').textContent=`已在本地载入 ${updates.length} 道题的原图。文件不会上传；刷新页面后需重新导入题库文件夹。`;
  renderBank();if(state.view==='notebook')renderNotebook();updateBasket();toast(`已载入 ${updates.length} 道题的原图。`);
 }catch(error){toast(error.message||'题库导入失败，请检查文件夹。');}
 finally{button.disabled=false;button.textContent='导入本地题库';e.target.value='';}
};
window.addEventListener('pagehide',()=>localImageUrls.forEach(url=>URL.revokeObjectURL(url)));

/* Chapter Lab: buildless, browser-local practice. No API keys or server storage. */
'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SUBJECT={physics:'物理',mathematics:'数学',furthermathematics:'进阶数学'};
const BOARD={'oxford-aqa-international':'OxfordAQA','cie-international':'CIE International','edexcel-ial':'Edexcel IAL'};
const DIFF={foundation:'基础',standard:'标准',challenge:'挑战',unknown:'待核分'};
const CH=new Map(DB.chapters.map(c=>[c.id,c])), QM=new Map(DB.questions.map(q=>[q.id,q]));
let saved={practice:{},overrides:{},papers:[]};
try{Object.assign(saved,JSON.parse(localStorage.getItem('chapterlab-v1')||'{}'));}catch{}
let state={subject:'physics',view:'bank',chapters:new Set(),basket:[],page:1,paperPage:1,unmapped:false,title:'',minutes:90};
let previewQuestions=[];
const drafts={};
const qCh=q=>(saved.overrides[q.id]??q.chapters).filter(id=>CH.has(id));
const total=qs=>qs.reduce((s,q)=>s+(q.marks||0),0);
function persist(){try{localStorage.setItem('chapterlab-v1',JSON.stringify(saved));}catch{toast('浏览器未能保存记录，请导出备份。');}}
let toastTimer;function toast(t){$('#toast').textContent=t;$('#toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').style.display='none',3500);}
function badge(board){return `<span class="badge ${board==='cie-international'?'cie':board==='edexcel-ial'?'edexcel':''}">${BOARD[board]}</span>`;}
function filters(){return {boards:$$('.boards input[value]:checked').map(x=>x.value),level:$('#level').value,year:$('#year').value,difficulty:$('#difficulty').value,search:$('#search').value.trim().toLowerCase(),wrong:$('#onlyWrong').checked,exclude:$('#excludeDone').checked};}
function pool(){const f=filters();return DB.questions.filter(q=>{
 if(q.subject!==state.subject||!f.boards.includes(q.board))return false;
 const ch=qCh(q);if(state.unmapped&&ch.length)return false;
 if(state.chapters.size&&!ch.some(c=>state.chapters.has(c)))return false;
 if(f.level&&!ch.some(c=>CH.get(c)?.level===f.level))return false;
 if(f.year&&q.year!==Number(f.year))return false;
 if(f.difficulty&&q.difficulty!==f.difficulty)return false;
 if(f.wrong&&saved.practice[q.id]!=='wrong')return false;
 if(f.exclude&&saved.practice[q.id])return false;
 return !f.search||`${q.text} ${q.number} ${q.title} ${ch.map(c=>CH.get(c)?.zh).join(' ')}`.toLowerCase().includes(f.search);
});}
function renderChapters(){const counts=new Map();DB.questions.filter(q=>q.subject===state.subject).forEach(q=>qCh(q).forEach(c=>counts.set(c,(counts.get(c)||0)+1)));
 let unit='';$('#chapters').innerHTML=DB.chapters.filter(c=>c.subject===state.subject).map(c=>{const head=c.unit!==unit?`<div class="unit-label"><span>${esc(c.unit)}</span><span>${c.level}</span></div>`:'';unit=c.unit;return head+`<label class="chapter ${counts.get(c.id)?'':'empty'}"><input type="checkbox" value="${c.id}" ${state.chapters.has(c.id)?'checked':''}><span>${esc(c.code)} ${esc(c.zh)}<small>${esc(c.name)}</small></span><span class="count">${counts.get(c.id)||0}</span></label>`;}).join('');
 $$('#chapters input').forEach(el=>el.onchange=()=>{el.checked?state.chapters.add(el.value):state.chapters.delete(el.value);state.unmapped=false;state.page=1;renderBank();});}
function renderBank(){const qs=pool(),pageCount=Math.max(1,Math.ceil(qs.length/12));state.page=Math.min(state.page,pageCount);
 $('#resultTitle').textContent=state.unmapped?'待归类题目':state.chapters.size?`${state.chapters.size} 个章节的${SUBJECT[state.subject]}练习`:`全部${SUBJECT[state.subject]}章节`;
 $('#resultCount').textContent=`${qs.length} 道真题 · ${total(qs)} 分已识别 · 所有分类可调整`;
 $('#unmappedBtn').textContent=state.unmapped?'返回全部题目':'查看待归类';
 $('#questionList').innerHTML=qs.slice((state.page-1)*12,state.page*12).map(q=>card(q)).join('')||`<div class="empty-state"><strong>当前条件下还没有题目</strong>试试减少章节或考试局限制，也可到整卷档案查看原卷。<br>章节显示 0 表示当前导入的代表卷尚未覆盖。</div>`;
 $('#pagination').innerHTML=pagination(state.page,pageCount,'question');bindCards();}
function card(q){const ch=qCh(q),done=saved.practice[q.id],added=state.basket.includes(q.id);return `<article class="question-card" data-id="${q.id}"><div class="card-top">${badge(q.board)}<span>${q.year} · ${esc(q.sourceUnit)}</span><span>原题 Q${q.number}</span>${done?`<span class="tag">${done==='wrong'?'↺ 错题':'✓ 已练'}</span>`:''}<span class="difficulty">${DIFF[q.difficulty]}（估计） · ${q.marks??'?'} 分</span></div><h3>${ch.length?ch.map(c=>esc(CH.get(c).zh)).join(' / '):'待归类 · 请对照原题核对'} <span class="tag">${saved.overrides[q.id]?'已调整':'自动匹配建议'}</span></h3><p class="snippet">${esc(q.text.slice(0,240))}</p><div class="tags">${ch.map(c=>`<span class="tag">${esc(CH.get(c).code)}</span>`).join('')}<span class="tag">${q.images.length?q.images.length+' 张原题图':'可直接加载原题'} · 原卷第 ${[...new Set(q.parts.map(p=>p.page))].join('、')} 页</span></div><div class="card-bottom"><button class="text-button" data-action="expand">查看原题 ▾</button><a class="text-button" href="${q.qp}#page=${q.parts[0]?.page||1}" target="_blank" rel="noopener">原卷 ↗</a>${q.ms?`<a class="text-button" href="${q.ms}" target="_blank" rel="noopener">评分标准 ↗</a>`:''}<button class="text-button" data-action="map">调整章节</button><button class="add ${added?'added':''}" data-action="add">${added?'✓ 已加入':'＋ 加入练习卷'}</button></div><div class="expand-slot"></div><div class="mapping-slot"></div></article>`;}
function bindCards(){$$('#questionList article').forEach(el=>{const q=QM.get(el.dataset.id);el.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{
 if(b.dataset.action==='add'){const i=state.basket.indexOf(q.id);i>=0?state.basket.splice(i,1):state.basket.push(q.id);b.classList.toggle('added',i<0);b.textContent=i<0?'✓ 已加入':'＋ 加入练习卷';updateBasket();}
 if(b.dataset.action==='expand'){const slot=el.querySelector('.expand-slot');if(slot.innerHTML){slot.innerHTML='';b.textContent='查看原题 ▾';return;}slot.innerHTML=`<div class="question-images">${questionContent(q)}<div class="actions"><button class="quiet" data-result="correct">✓ 我已掌握</button><button class="quiet" data-result="wrong">↺ 加入错题</button><button class="quiet" data-result="clear">清除状态</button></div></div>`;slot.querySelectorAll('[data-result]').forEach(bt=>bt.onclick=()=>{bt.dataset.result==='clear'?delete saved.practice[q.id]:saved.practice[q.id]=bt.dataset.result;persist();toast(bt.dataset.result==='wrong'?'已加入错题，可筛选后再组卷。':'已更新练习状态。');});b.textContent='收起原题 ▴';ChapterLabQuestions.load(q).catch(()=>{});}
 if(b.dataset.action==='map'){const slot=el.querySelector('.mapping-slot');if(slot.innerHTML){slot.innerHTML='';return;}slot.innerHTML=`<div class="mapping-editor"><p>对照原图选择章节，可按 Ctrl / Command 多选。仅在本浏览器生效。</p><select multiple size="8">${DB.chapters.filter(c=>c.subject===q.subject).map(c=>`<option value="${c.id}" ${qCh(q).includes(c.id)?'selected':''}>${esc(c.code)} · ${esc(c.zh)} (${c.level})</option>`).join('')}</select><button class="primary" data-save-map>保存调整</button> <button class="quiet" data-reset-map>恢复自动建议</button></div>`;slot.querySelector('[data-save-map]').onclick=()=>{saved.overrides[q.id]=[...slot.querySelector('select').selectedOptions].map(o=>o.value);persist();renderChapters();renderBank();toast('章节调整已保存。');};slot.querySelector('[data-reset-map]').onclick=()=>{delete saved.overrides[q.id];persist();renderChapters();renderBank();};}
 });});}
function pagination(page,count,type){return `<div class="pagination"><button data-page="${page-1}" data-type="${type}" ${page===1?'disabled':''}>← 上一页</button><span>${page} / ${count}</span><button data-page="${page+1}" data-type="${type}" ${page===count?'disabled':''}>下一页 →</button></div>`;}
document.addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(!b)return;if(b.dataset.type==='question'){state.page=Number(b.dataset.page);renderBank();$('.results-head').scrollIntoView({behavior:'smooth',block:'start'});}else{state.paperPage=Number(b.dataset.page);renderPapers();$('#papersView').scrollIntoView({behavior:'smooth'});}});
function updateBasket(){state.basket=state.basket.filter(id=>QM.has(id));const qs=state.basket.map(id=>QM.get(id)),unknown=qs.filter(q=>!q.marks).length;$('#basketCount').textContent=`${qs.length} 道题`;$('#basketMarks').textContent=qs.length?`${total(qs)} 分${unknown?` + ${unknown} 道待核分`:''} · 约 ${state.minutes} 分钟`:'从题库加入，或智能生成';}
function renderPapers(){const term=$('#paperSearch').value.trim().toLowerCase();const rows=DB.papers.filter(p=>p.subject===state.subject&&`${p.title} ${p.unit} ${BOARD[p.board]} ${p.year}`.toLowerCase().includes(term));const count=Math.max(1,Math.ceil(rows.length/25));state.paperPage=Math.min(count,state.paperPage);$('#paperList').innerHTML=rows.slice((state.paperPage-1)*25,state.paperPage*25).map(p=>`<div class="archive-row">${badge(p.board)}<div><strong>${esc(p.title)}</strong><small>${esc(p.unit)} · ${SUBJECT[p.subject]}</small></div>${DB.importedPapers.includes(p.id)?'<span class="tag">已拆题</span>':''}<div class="row-links"><a href="${p.qp}" target="_blank" rel="noopener">试题原卷 ↗</a>${p.ms?`<a href="${p.ms}" target="_blank" rel="noopener">评分标准 ↗</a>`:'<span>暂无答案链接</span>'}</div></div>`).join('')||'<div class="empty-state">没有匹配的试卷。</div>';$('#paperPagination').innerHTML=pagination(state.paperPage,count,'paper');}
function switchView(view){state.view=view;$$('.view').forEach(x=>x.classList.add('hidden'));$('#'+view+'View').classList.remove('hidden');$$('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===view));if(view==='papers')renderPapers();if(view==='history')renderHistory();}
$$('.nav').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
$$('[data-subject]').forEach(b=>b.onclick=()=>{drafts[state.subject]={basket:[...state.basket],title:state.title,minutes:state.minutes,target:state.target};state.subject=b.dataset.subject;Object.assign(state,{basket:[],title:'',minutes:90,target:undefined},drafts[state.subject]||{});state.chapters.clear();state.page=1;state.paperPage=1;state.unmapped=false;$$('[data-subject]').forEach(x=>x.classList.toggle('selected',x===b));renderChapters();renderBank();updateBasket();if(state.view==='papers')renderPapers();if(state.view==='history')renderHistory();});
['level','year','difficulty','onlyWrong','excludeDone'].forEach(id=>$('#'+id).onchange=()=>{state.page=1;renderBank();});$$('.boards input[value]').forEach(x=>x.onchange=()=>{state.page=1;renderBank();});let searchTimer;$('#search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.page=1;renderBank();},180);};$('#paperSearch').oninput=()=>{state.paperPage=1;renderPapers();};
$('#clearChapters').onclick=()=>{state.chapters.clear();state.unmapped=false;renderChapters();renderBank();};$('#unmappedBtn').onclick=()=>{state.unmapped=!state.unmapped;state.chapters.clear();state.page=1;renderChapters();renderBank();};$('#clearBasket').onclick=()=>{state.basket=[];updateBasket();renderBank();};

// A bounded subset-sum search approaches the score target without repeating a question.
// Preference scoring encourages chosen chapter coverage and requested difficulty proportions.
const selectPaper=(candidates,target,recipe,mix)=>ChapterLabSelection.selectPaper(candidates,target,recipe,mix,{chapters:state.chapters,getChapters:qCh});
function smartInfo(){let qs=pool().filter(q=>q.marks&&qCh(q).length);if($('#avoidDone').checked)qs=qs.filter(q=>!saved.practice[q.id]);$('#smartInfo').textContent=`当前可自动组卷：${qs.length} 道 / ${total(qs)} 分。未知分值或待归类题不参与自动选题；组卷会替换当前选题篮。难度配比按题数尽量匹配。`;}
$('#smartBtn').onclick=()=>{smartInfo();$('#smartDialog').showModal();};$('#avoidDone').onchange=smartInfo;$('#targetMarks').oninput=()=>{if(Number($('#targetMarks').value)>0)$('#minutes').value=Math.round(Number($('#targetMarks').value)*1.5);};
$('#generateBtn').onclick=()=>{
 const target=Number($('#targetMarks').value),mins=Number($('#minutes').value);if(!Number.isInteger(target)||target<5||target>300||!Number.isFinite(mins)||mins<5||mins>600){toast('请输入5–300的整数目标分值与5–600分钟时长。');return;}
 let qs=pool().filter(q=>Number.isInteger(q.marks)&&q.marks>0&&q.marks<=target&&qCh(q).length);if($('#avoidDone').checked)qs=qs.filter(q=>!saved.practice[q.id]);const result=selectPaper(qs,target,$('#recipe').value,$('#freshYears').checked);
 if(!result){$('#smartInfo').textContent='当前题池无法生成。请增加来源或章节、降低难度限制，或取消避开已练题。';return;}
 state.basket=result.ids;state.minutes=mins;state.title=$('#paperTitle').value.trim()||`${SUBJECT[state.subject]} · ${state.chapters.size?state.chapters.size+'章专题':'综合'}练习`;state.target=target;updateBasket();renderBank();$('#smartDialog').close();openPreview();if(result.achieved<target)toast(`已生成 ${result.achieved} 分，距目标差 ${target-result.achieved} 分。`);
};
function paperHtml(qs,answers){return qs.map((q,i)=>`<section class="paper-question"><div class="qhead"><strong>${i+1}. ${qCh(q).map(c=>esc(CH.get(c).zh)).join(' / ')||'待归类'}</strong><span>${q.marks??'?'} 分</span></div><div class="qsource">${BOARD[q.board]} · ${esc(q.title)} · 原题 Q${q.number} · 原卷页 ${q.parts.map(p=>p.page).join('、')}</div>${questionContent(q)}</section>`).join('')+(answers?`<section class="answer-section"><h2>答案出处与原题索引</h2><p class="print-note">按下表的「原题号」查阅原卷评分标准；跨页的子问属于同一道原题。</p><table class="answer-table"><thead><tr><th>本卷</th><th>出处 / 原题</th><th>评分标准</th></tr></thead><tbody>${qs.map((q,i)=>`<tr><td>${i+1}</td><td>${BOARD[q.board]} · ${esc(q.title)} · Q${q.number}</td><td>${q.ms?`<a href="${q.ms}" target="_blank" rel="noopener">原卷评分标准 · Q${q.number}</a>`:'暂无公开链接'}</td></tr>`).join('')}</tbody></table></section>`:'');}
function updatePreviewStatus(){
 const ready=previewQuestions.filter(q=>q.images.length).length;
 const failures=previewQuestions.filter(q=>!q.images.length&&ChapterLabQuestions.state(q.id).status==='error').length;
 const complete=ready===previewQuestions.length&&ready>0;
 $('#previewProgress').textContent=complete?`${ready} 道真实题目已加载，可打印完整练习卷。`:`正在加载真实题目：${ready} / ${previewQuestions.length}${failures?`，${failures} 道暂未加载，请重试。`:'。'}`;
 $('#printPaper').disabled=!complete;
 $('#printPaper').textContent=complete?'打印 / 存为 PDF':`题目加载中 ${ready}/${previewQuestions.length}`;
 $('#retryPaper').classList.toggle('hidden',!failures);
}
function loadPreviewQuestions(){
 for(const q of previewQuestions)ChapterLabQuestions.load(q).catch(()=>{});
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
$('#includeAnswers').onchange=()=>{$('#paperPreview').innerHTML=paperHtml(previewQuestions,$('#includeAnswers').checked);};
$('#printPaper').onclick=async()=>{
 if(previewQuestions.some(q=>!q.images.length)){loadPreviewQuestions();toast('正在加载题目，全部加载后即可打印。');return;}
 $('#printArea').innerHTML=`<h1 class="print-title">${esc($('#previewTitle').textContent)}</h1><div class="print-meta">${esc($('#previewMeta').textContent)} · 姓名 __________ · 日期 __________</div><p class="print-note">本卷按 OxfordAQA 官方课程单元归类；保留原题图像、共享题干与原题号便于核对。</p>`+paperHtml(previewQuestions,$('#includeAnswers').checked);
 try{await Promise.all($$('#printArea img').map(img=>img.decode()));}
 catch{toast('部分题图尚未准备完成，请稍后重试打印。');return;}
 $('#previewDialog').close();window.print();
};
function download(name,obj){const url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
$('#exportPaper').onclick=()=>download('chapter-lab-paper.json',{format:'chapterlab-paper-v1',title:$('#previewTitle').textContent,minutes:state.minutes,questions:previewQuestions.map(q=>({...q,images:[],chapters:qCh(q)}))});
$('#savePaper').onclick=()=>{saved.papers.unshift({id:Date.now().toString(36),title:$('#previewTitle').textContent,minutes:state.minutes,subject:state.subject,ids:previewQuestions.map(q=>q.id),date:new Date().toISOString()});persist();toast('已保存到「我的练习」。');};
function renderHistory(){const rows=saved.papers.filter(p=>p.subject===state.subject);const wrong=Object.entries(saved.practice).filter(([id,status])=>status==='wrong'&&QM.get(id)?.subject===state.subject).length;$('#historyList').innerHTML=`<div class="info-box">${SUBJECT[state.subject]}：已记录 ${Object.keys(saved.practice).filter(id=>QM.get(id)?.subject===state.subject).length} 道练习，其中 ${wrong} 道错题。可在章节题库勾选「只看错题」再次组卷。</div>`+rows.map(p=>`<div class="history-row"><div><strong>${esc(p.title)}</strong><small>${p.ids.filter(id=>QM.has(id)).length} 道 · ${p.minutes} 分钟 · ${new Date(p.date).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})}</small></div><div class="row-links"><button data-history="${esc(p.id)}">继续练习 →</button><button data-delete="${esc(p.id)}">删除</button></div></div>`).join('')+(rows.length?'':'<div class="empty-state"><strong>留下一份练习记录</strong>在练习卷预览中点击「保存练习」，下次可以接着做。</div>');$$('[data-history]').forEach(b=>b.onclick=()=>{const p=saved.papers.find(p=>p.id===b.dataset.history);state.basket=p.ids.filter(id=>QM.has(id));state.title=p.title;state.minutes=p.minutes;delete state.target;updateBasket();openPreview();});$$('[data-delete]').forEach(b=>b.onclick=()=>{saved.papers=saved.papers.filter(p=>p.id!==b.dataset.delete);persist();renderHistory();});}
$('#backupBtn').onclick=()=>download('chapter-lab-backup.json',{format:'chapterlab-backup-v1',...saved});
$('#restoreInput').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>5e6)throw Error();const data=JSON.parse(await f.text());if(data.format!=='chapterlab-backup-v1'||!Array.isArray(data.papers)||typeof data.practice!=='object'||typeof data.overrides!=='object')throw Error();for(const [id,v] of Object.entries(data.practice))if(QM.has(id)&&['correct','wrong'].includes(v))saved.practice[id]=v;for(const [id,ids] of Object.entries(data.overrides))if(QM.has(id)&&Array.isArray(ids))saved.overrides[id]=ids.filter(c=>CH.has(c)&&CH.get(c).subject===QM.get(id).subject);const safe=data.papers.filter(p=>typeof p.title==='string'&&typeof p.id==='string'&&Array.isArray(p.ids)&&Number.isFinite(p.minutes)&&SUBJECT[p.subject]&&Number.isFinite(Date.parse(p.date))).map(p=>({...p,ids:p.ids.filter(id=>QM.has(id))}));const have=new Set(saved.papers.map(p=>p.id));saved.papers.push(...safe.filter(p=>!have.has(p.id)));persist();renderHistory();renderChapters();renderBank();toast('备份已合并到当前浏览器。');}catch{toast('文件不是有效的 Chapter Lab 备份。');}e.target.value='';};
$('#aboutBtn').onclick=()=>{const mapped=DB.questions.filter(q=>qCh(q).length).length,covered=new Set(DB.questions.flatMap(qCh)).size;$('#coverage').innerHTML=`<div class="coverage-grid"><div><strong>${DB.questions.length}</strong><small>道已拆分题目 · ${DB.importedPapers.length}套代表卷</small></div><div><strong>${DB.papers.length}</strong><small>条整卷目录记录（含不同年份与变体）</small></div><div><strong>${covered} / ${DB.chapters.length}</strong><small>个分类有匹配建议</small></div><div><strong>${DB.questions.length-mapped}</strong><small>道待归类题目</small></div></div><p>已拆题范围：每个来源试卷单元选取2024、2025年各一套，共${DB.importedPapers.length}套。并非这两年所有考季与变体，也不是网站全部试卷均已拆分。整卷目录取自指定网站，外链可用性随来源网站变化。</p>`;$('#aboutDialog').showModal();};
$$('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close();}));
$('#questionTotal').textContent=DB.questions.length.toLocaleString('en-US');$('#importTotal').textContent=`${DB.importedPapers.length} 套代表卷索引 · 94 个课程分类`;
renderChapters();renderBank();updateBasket();


function questionVisual(q){
 if(q.images.length)return q.images.map(src=>`<img src="${esc(src)}" alt="${esc(BOARD[q.board])} ${esc(q.title)} 原题 Q${q.number}" loading="eager">`).join('');
 const status=ChapterLabQuestions.state(q.id);
 if(status.status==='error')return `<div class="question-load-error" role="status"><strong>这道题暂未加载</strong><p>${esc(status.error)}</p><button class="quiet" data-load-question="${esc(q.id)}">重试加载题目</button> <a href="${esc(q.qp)}#page=${q.parts[0]?.page||1}" target="_blank" rel="noopener">打开原卷 ↗</a></div>`;
 return `<div class="question-loading" role="status"><span class="loading-dot"></span><strong>正在加载真实题目…</strong><p>原题 Q${q.number} · ${q.parts.length} 个题图区域。公式与图表将随题目一同显示。</p></div>`;
}
function questionContent(q){return `<div class="question-visual" data-question-visual="${esc(q.id)}">${questionVisual(q)}</div>`;}
ChapterLabQuestions.subscribe(id=>{
 const q=QM.get(id);if(!q)return;
 $$('[data-question-visual]').filter(el=>el.dataset.questionVisual===id).forEach(el=>el.innerHTML=questionVisual(q));
 if($('#previewDialog').open)updatePreviewStatus();
});
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-load-question]');
 if(button){const q=QM.get(button.dataset.loadQuestion);if(q)ChapterLabQuestions.load(q).catch(()=>{});}
});
const localImageUrls=[];
$('#importBankBtn').onclick=()=>$('#localBankInput').click();
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
  if(!bank||!Array.isArray(bank.questions))throw Error('题库格式不匹配。');
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
  renderBank();updateBasket();toast(`已载入 ${updates.length} 道题的原图。`);
 }catch(error){toast(error.message||'题库导入失败，请检查文件夹。');}
 finally{button.disabled=false;button.textContent='导入本地题库';e.target.value='';}
};
window.addEventListener('pagehide',()=>localImageUrls.forEach(url=>URL.revokeObjectURL(url)));

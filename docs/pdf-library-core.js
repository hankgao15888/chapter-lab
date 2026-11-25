(function(root){
 'use strict';
 const subjects={physics:'物理',mathematics:'数学',furthermathematics:'进阶数学',chemistry:'化学',biology:'生物',economics:'经济'};
 const types={calculation:'计算题',explanation:'解释题',graph:'图像题',practical:'实验题',essay:'论述题',choice:'选择题',other:'其他题型'};
 const normalize=text=>String(text||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
 function linesFromItems(items,width,height){
  const rows=[];
  for(const item of items){
   if(!item.str?.trim()||!Array.isArray(item.transform))continue;
   const x=item.transform[4],top=height-item.transform[5],fontHeight=Math.max(1,Math.abs(item.height||item.transform[3]||10));
   if(!Number.isFinite(x)||!Number.isFinite(top))continue;
   let row=rows.find(row=>Math.abs(row.y-top)<=Math.min(3,fontHeight*.3));
   if(!row){row={y:top,items:[]};rows.push(row);}
   row.items.push({text:item.str,x,height:fontHeight});
  }
  return rows.sort((a,b)=>a.y-b.y).map(row=>{
   row.items.sort((a,b)=>a.x-b.x);
   return {text:row.items.map(item=>item.text).join(' ').replace(/\s+/g,' ').trim(),x:row.items[0].x/width,top:Math.max(0,(row.y-Math.max(...row.items.map(i=>i.height)))/height),bottom:Math.min(1,(row.y+3)/height)};
  });
 }
 function classify(text,subject,chapters){
  const normalized=normalize(text);
  const ranked=chapters.filter(ch=>ch.subject===subject).map(ch=>{
   const matches=[...new Set([...(ch.keywords||[]),ch.zh].filter(word=>String(word||'').trim().length>=(/[\u3400-\u9fff]/.test(word)?2:3)))].filter(word=>normalized.includes(normalize(word)));
   return {id:ch.id,score:matches.reduce((sum,word)=>sum+Math.min(5,String(word).length/4),0),matches};
  }).filter(ch=>ch.score>0).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  const top=ranked[0]?.score||0;
  return {chapters:ranked.filter(ch=>ch.score>=top*.6).slice(0,3).map(ch=>ch.id),matchedKeywords:[...new Set(ranked.slice(0,3).flatMap(ch=>ch.matches))].slice(0,8)};
 }
 function questionType(text){
  const t=normalize(text);
  if(/which (?:one|statement)|选择|选项/.test(t)||['A','B','C','D'].every(letter=>new RegExp('(?:^|\\n)\\s*'+letter+'(?:[.)]|\\s)').test(text)))return 'choice';
  if(/evaluate.*(?:view|statement|policy)|assess|to what extent|discuss|评估|论述/.test(t))return 'essay';
  if(/experiment|experimental|apparatus|procedure|practical|实验|仪器/.test(t))return 'practical';
  if(/sketch|plot|draw.*(?:graph|diagram)|画图|绘制/.test(t))return 'graph';
  if(/calculate|determine|find|solve|differentiat|integrat|计算|求出|解方程/.test(t))return 'calculation';
  if(/explain|describe|suggest|state|解释|描述|说明/.test(t))return 'explanation';
  return 'other';
 }
 function inferSubject(name,text,chapters,fallback='physics'){
  const hay=normalize(name+' '+text),aliases={furthermathematics:/further(?: pure)? mathematics|further maths|进阶数学|高数/,physics:/physics|物理/,chemistry:/chemistry|化学/,biology:/biology|生物/,economics:/economics|经济/,mathematics:/mathematics|maths|数学/};
  for(const subject of Object.keys(aliases))if(aliases[subject].test(hay))return subject;
  const scores=Object.keys(subjects).map(subject=>({subject,score:classify(text,subject,chapters).matchedKeywords.length})).sort((a,b)=>b.score-a.score);
  return scores[0]?.score>=2?scores[0].subject:fallback;
 }
 function heading(line){
  if(line.x>.23||line.top<.055||line.top>.94)return null;
  const match=line.text.match(/^(?:Question\s+|Q\s*|第\s*)?(\d{1,2})(?:\s*题|[.)．、:：])?(?:\s+|$)(.*)$/i);
  if(!match)return null;
  const number=Number(match[1]),tail=match[2].trim();
  if(number<1||number>60)return null;
  if(/^(?:of\s+\d|(?:marks?|minutes?|hours?|cm|mm|kg|mol|June|January|May|October|November)\b)/i.test(tail))return null;
  if(tail&&tail.length<6&&!/^\([a-z]\)/i.test(tail))return null;
  return {number};
 }
 function extractQuestions(pages,subject,chapters){
  const starts=[];
  let last=0;
  for(const page of pages)for(const line of page.lines){
   const found=heading(line);
   if(found&&(!starts.length||found.number===last+1)){
    starts.push({number:found.number,page:page.page,top:Math.max(0,line.top-.008)});last=found.number;
   }
  }
  const detected=starts.length>0;
  if(!detected)for(const page of pages)starts.push({number:null,page:page.page,top:0});
  return starts.slice(0,500).map((start,i)=>{
   const end=starts[i+1],endPage=end?end.page:pages.at(-1).page;
   const parts=[];const content=[];
   for(const page of pages){
    if(page.page<start.page||page.page>endPage)continue;
    const top=page.page===start.page?start.top:0;
    const bottom=end&&page.page===end.page?end.top:1;
    if(bottom<=top+.001)continue;
    const lines=page.lines.filter(line=>line.top>=top-.01&&line.top<bottom&&line.top>.045&&line.bottom<.96&&!/do not write in this area|leave blank|^(?:leave|blank)$|turn over|^[_*\d\s]+$|^\*?p\d+[a-z\d*]*$/i.test(line.text));
    if(bottom<1&&!lines.length)continue;
    parts.push({page:page.page,top,bottom});
    content.push(...lines.map(line=>line.text));
   }
   const text=content.join('\n').slice(0,20000),suggestion=classify(text,subject,chapters);
   return {id:'q'+(i+1),number:start.number,label:start.number===null?'第 '+start.page+' 页（待拆分）':'第 '+start.number+' 题',parts,text,type:questionType(text),...suggestion,reviewed:false,manual:!detected};
  });
 }
 function validateEdit(input,subject,chapters,pageCount){
  const first=Number(input.firstPage),last=Number(input.lastPage);
  if(!Number.isInteger(first)||!Number.isInteger(last)||first<1||last<first||last>pageCount)throw new Error('请输入 PDF 范围内有效的起止页码。');
  const number=String(input.number||'').trim().slice(0,30);
  if(!number)throw new Error('请填写题号或题目名称。');
  const allowed=new Set(chapters.filter(ch=>ch.subject===subject).map(ch=>ch.id));
  const selected=[...new Set((input.chapters||[]).filter(id=>allowed.has(id)))];
  const parts=[];
  for(let page=first;page<=last;page++)parts.push({page,top:0,bottom:1});
  return {label:number,number:null,parts,text:String(input.text||'').slice(0,20000),chapters:selected,type:types[input.type]?input.type:'other',reviewed:true,manual:true};
 }
 function editBounds(parts,top,bottom){
  top=Number(top)/100;bottom=Number(bottom)/100;
  if(!Number.isFinite(top)||!Number.isFinite(bottom)||top<0||top>=1||bottom<=0||bottom>1||(parts.length===1&&bottom<=top))throw new Error('题目边界需在 0–100% 内，结束位置必须晚于起始位置。');
  return parts.map((part,index)=>({...part,top:index===0?top:part.top,bottom:index===parts.length-1?bottom:part.bottom}));
 }
 function splitQuestion(question,page,position,newId){
  page=Number(page);position=Number(position)/100;
  const part=question.parts.find(part=>part.page===page);
  if(!part||!Number.isFinite(position)||position<part.top||position>part.bottom)throw new Error('请在当前题目高亮范围内选择拆分位置。');
  const before=[],after=[];
  for(const item of question.parts){
   if(item.page<page)before.push({...item});
   else if(item.page>page)after.push({...item});
   else {if(position>item.top+.001)before.push({...item,bottom:position});if(position<item.bottom-.001)after.push({...item,top:position});}
  }
  if(!before.length||!after.length)throw new Error('拆分后两道题都必须包含内容，请调整位置。');
  const draft={...question,reviewed:false,manual:true,savedAt:null,notebookStatus:null};
  return [{...draft,id:question.id,label:(question.label+'（上）').slice(0,30),parts:before},{...draft,id:newId,label:(question.label+'（下）').slice(0,30),parts:after}];
 }
 function rectangle(start,end){
  const clamp=value=>Math.max(0,Math.min(1,Number(value)));
  const left=clamp(Math.min(start.x,end.x)),right=clamp(Math.max(start.x,end.x)),top=clamp(Math.min(start.y,end.y)),bottom=clamp(Math.max(start.y,end.y));
  if(![left,right,top,bottom].every(Number.isFinite)||right-left<.01||bottom-top<.01)throw new Error('框选区域太小，请重新拖动框住完整题目。');
  return {left,right,top,bottom};
 }
 function regionText(items,viewport,region){
  const selected=[];
  for(const item of items){
   if(!item.str?.trim()||!Array.isArray(item.transform))continue;
   const [a,b,c,d,x,y]=item.transform,along=Math.hypot(a,b)||1,up=Math.hypot(c,d)||1;
   const width=Math.abs(item.width||item.str.length*(item.height||10)*.5),height=Math.abs(item.height||up);
   const dx=a/along*width,dy=b/along*width,ux=c/up*height,uy=d/up*height;
   const points=[[x,y],[x+dx,y+dy],[x+ux,y+uy],[x+dx+ux,y+dy+uy]].map(([px,py])=>viewport.convertToViewportPoint(px,py));
   const left=Math.min(...points.map(p=>p[0]))/viewport.width,right=Math.max(...points.map(p=>p[0]))/viewport.width,top=Math.min(...points.map(p=>p[1]))/viewport.height,bottom=Math.max(...points.map(p=>p[1]))/viewport.height;
   const cx=(left+right)/2,cy=(top+bottom)/2;
   if(cx<region.left||cx>region.right||cy<region.top||cy>region.bottom)continue;
   const baseline=viewport.convertToViewportPoint(x,y);
   selected.push({...item,transform:[1,0,0,Math.max(1,(bottom-top)*viewport.height),baseline[0],viewport.height-baseline[1]],height:Math.max(1,(bottom-top)*viewport.height)});
  }
  return linesFromItems(selected,viewport.width,viewport.height).map(line=>line.text).join('\n').slice(0,20000);
 }
 function regionQuestion(region,page,text,subject,chapters,id){
  region=rectangle({x:region.left,y:region.top},{x:region.right,y:region.bottom});
  if(!Number.isInteger(page)||page<1)throw new Error('框选页码无效。');
  return {id,label:'框选题目',number:null,parts:[{page,...region}],text:String(text||'').slice(0,20000),...classify(text,subject,chapters),type:questionType(text),reviewed:false,manual:true,savedAt:null,notebookStatus:null};
 }
 function questionEntries(records){
  return records.flatMap(record=>record.questions.filter(q=>q.savedAt).map(q=>({...q,id:record.id+'::'+q.id,localPDF:true,documentId:record.id,questionId:q.id,subject:record.subject,title:record.title,autoSelectable:false,marks:null,number:q.label})));
 }
 const api={rectangle,regionText,regionQuestion,editBounds,splitQuestion,questionEntries,subjects,types,normalize,linesFromItems,classify,questionType,inferSubject,extractQuestions,validateEdit};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.ChapterLabPDFCore=api;
})(globalThis);

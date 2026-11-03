/* MIT License · Chapter Lab contributors */
(function(root){
'use strict';
function balancedCandidates(candidates,limit,getChapters){
 if(candidates.length<=limit)return candidates;
 const buckets=new Map();
 for(const q of candidates){
  const key=[q.board,q.year,q.difficulty,getChapters(q)[0]||''].join('|');
  if(!buckets.has(key))buckets.set(key,[]);
  buckets.get(key).push(q);
 }
 const groups=[...buckets.values()].map(group=>group.map(q=>({q,r:Math.random()})).sort((a,b)=>a.r-b.r).map(x=>x.q)).sort((a,b)=>a.length-b.length);
 const result=[];
 for(let round=0;result.length<limit;round++){
  let added=0;
  for(const group of groups)if(group[round]&&result.length<limit){result.push(group[round]);added++;}
  if(!added)break;
 }
 return result;
}
function selectPaper(candidates,target,recipe,mix,options={}){
 const state={chapters:options.chapters||new Set()};
 const qCh=options.getChapters||((q)=>q.chapters||[]);
 const fullPool=candidates.filter(q=>q.autoSelectable!==false&&Number.isInteger(q.marks)&&q.marks>0&&q.marks<=target);
 candidates=balancedCandidates(fullPool,options.candidateLimit??1200,qCh);
 const QM=new Map(candidates.map(q=>[q.id,q]));
 const total=rows=>rows.reduce((s,q)=>s+(q.marks||0),0);const ratios={balanced:[.3,.5,.2],foundation:[.7,.3,0],challenge:[0,.3,.7]}[recipe],ds=['foundation','standard','challenge'];const freqs=new Map();candidates.forEach(q=>qCh(q).forEach(c=>freqs.set(c,(freqs.get(c)||0)+1)));let best=null;
 for(let trial=0;trial<(options.trials||10);trial++){
  const means=ds.map(d=>{const group=candidates.filter(q=>q.difficulty===d);return group.length?total(group)/group.length:0;});
  const available=ratios.map((r,i)=>means[i]?r:0),ratioSum=available.reduce((a,b)=>a+b,0)||1;
  const adjusted=available.map(r=>r/ratioSum),average=adjusted.reduce((s,r,i)=>s+r*means[i],0)||5,expectedCount=target/average;
  const desired=adjusted.map(r=>r*expectedCount);
  const dp=Array(target+1).fill(null);dp[0]={score:0,ids:[],counts:[0,0,0],covered:[]};
  const ranked=candidates.map(q=>({q,r:Math.random()})).sort((a,b)=>a.r-b.r);
  for(const {q,r} of ranked){const di=ds.indexOf(q.difficulty),pref=ratios[di]??0;if(!pref)continue;const relevant=qCh(q).filter(c=>!state.chapters.size||state.chapters.has(c));
   for(let n=target;n>=q.marks;n--){const prev=dp[n-q.marks];if(!prev)continue;
    const distribution=-8*(2*(prev.counts[di]-desired[di])+1);
    const coverage=relevant.filter(c=>!prev.covered.includes(c)).length*5;
    const diversity=mix&&!prev.ids.some(id=>QM.get(id).board===q.board)?5:0;
    const score=prev.score+q.marks*100+distribution+coverage+diversity+r*.2;
    if(!dp[n]||score>dp[n].score){const counts=[...prev.counts];counts[di]++;dp[n]={score,ids:[...prev.ids,q.id],counts,covered:[...new Set([...prev.covered,...relevant])]};}}
  }
  let achieved=target;while(achieved>0&&!dp[achieved])achieved--;if(!achieved)continue;const qs=dp[achieved].ids.map(id=>QM.get(id));const actual=ds.map(d=>qs.filter(q=>q.difficulty===d).length/qs.length);const ratioError=actual.reduce((s,x,i)=>s+Math.abs(x-ratios[i]),0);const covered=new Set(qs.flatMap(qCh).filter(c=>!state.chapters.size||state.chapters.has(c))).size;const diversity=new Set(qs.map(q=>q.board)).size+new Set(qs.map(q=>q.year)).size;
  const quality=achieved*10000+covered*20-ratioError*40+(mix?diversity*12:0);
  if(!best||quality>best.quality)best={ids:qs.map(q=>q.id),achieved,quality,covered};
 }
 if((!best||best.achieved<target)&&candidates.length<fullPool.length){
  const complete=selectPaper(fullPool,target,recipe,mix,{...options,candidateLimit:Infinity,trials:1});
  if(complete&&(!best||complete.achieved>best.achieved))return complete;
 }
 return best;
}

const api={selectPaper,balancedCandidates};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ChapterLabSelection=api;
})(typeof globalThis!=='undefined'?globalThis:this);

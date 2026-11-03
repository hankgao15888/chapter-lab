/* MIT License · Chapter Lab contributors */
(function(root){
 'use strict';
 function availableYears(questions,subject,boards){
  const selected=new Set(boards);
  return [...new Set(questions.filter(q=>q.subject===subject&&selected.has(q.board)).map(q=>q.year))].sort((a,b)=>b-a);
 }
 const api={availableYears};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ChapterLabCatalog=api;
})(typeof globalThis!=='undefined'?globalThis:this);

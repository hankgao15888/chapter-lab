/* MIT License · Chapter Lab contributors. PDF crop boxes use top-left point coordinates. */
(function(root){
 'use strict';
 function cropGeometry(box,pageWidth,pageHeight,scale=1.75){
  if(!Array.isArray(box)||box.length!==4||!box.every(Number.isFinite)||![pageWidth,pageHeight,scale].every(v=>Number.isFinite(v)&&v>0))throw new Error('Invalid question crop geometry');
  const left=Math.max(0,Math.min(pageWidth,box[0]));
  const top=Math.max(0,Math.min(pageHeight,box[1]));
  const right=Math.max(0,Math.min(pageWidth,box[2]));
  const bottom=Math.max(0,Math.min(pageHeight,box[3]));
  if(right<=left||bottom<=top)throw new Error('Question crop is outside its PDF page');
  return {width:Math.ceil((right-left)*scale),height:Math.ceil((bottom-top)*scale),transform:[1,0,0,1,-left*scale,-top*scale]};
 }
 function expandPageStart(box){
  const expanded=[...box];
  // Tall matrices and fractions can extend above a question number's baseline.
  // At the start of the page body there is no preceding question to overlap.
  const bodyTop=45+Math.max(0,box[0]-35);
  if(box[1]>bodyTop&&box[1]<bodyTop+40)expanded[1]=bodyTop;
  return expanded;
 }
 const api={cropGeometry,expandPageStart};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ChapterLabGeometry=api;
})(typeof globalThis!=='undefined'?globalThis:this);

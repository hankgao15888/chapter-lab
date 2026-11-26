export {SyncVault} from './vault.mjs';

const maxBytes=80*1024*1024;
const hex=value=>Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('');
function hasOrigin(request,env){
 const origin=request.headers.get('Origin');
 return origin&&env.SYNC_ORIGINS?.split(',').map(item=>item.trim()).includes(origin);
}
export default{
 async fetch(request,env){
  const url=new URL(request.url);
  const origin=request.headers.get('Origin');
  const headers={'Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
  const allowed=hasOrigin(request,env);
  if(allowed){
   headers['Access-Control-Allow-Origin']=origin;
   headers['Access-Control-Allow-Methods']='GET, PUT, OPTIONS';
   headers['Access-Control-Allow-Headers']='Authorization, Content-Type, If-Match, If-None-Match';
   headers['Access-Control-Expose-Headers']='ETag';
  }
  const respond=(status,message=null,extra={})=>new Response(message,{status,headers:{...headers,...extra}});
  if(url.pathname!=='/v1/files')return respond(404);
  if(origin&&!allowed)return respond(403);
  if(request.method==='OPTIONS')return respond(allowed?204:403);
  if(!env.PRIVATE_VAULTS)return respond(503);
  const token=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if(!token)return respond(401);
  const vault=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));
  if(!env.SYNC_VAULTS?.split(',').map(item=>item.trim()).includes(vault))return respond(403);
  if(request.method!=='GET'&&request.method!=='PUT')return respond(405);
  if(request.method==='PUT'){
   const length=Number(request.headers.get('Content-Length'));
   if(!request.body||!Number.isSafeInteger(length)||length<40)return respond(400);
   if(length>maxBytes)return respond(413);
   if(request.headers.get('Content-Type')!=='application/octet-stream')return respond(415);
   const match=request.headers.get('If-Match'),fresh=request.headers.get('If-None-Match');
   if((!match&&fresh!=='*')||(match&&(fresh||!/^"[a-f0-9]+"$/i.test(match))))return respond(428);
  }
  try{
   const result=await env.PRIVATE_VAULTS.getByName(vault).fetch(request);
   for(const key of ['Content-Type','Content-Length','ETag']){
    const value=result.headers.get(key);
    if(value)headers[key]=value;
   }
   return respond(result.status,result.body);
  }catch{return respond(503);}
 }
};

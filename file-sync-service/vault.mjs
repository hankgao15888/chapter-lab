const chunkSize=512*1024;
const maxChunks=160; // 80 MiB, shared with the outer request limit.
const key=(slot,index)=>`chunk:${slot}:${index}`;
const noCache={noCache:true};

export class SyncVault{
 constructor(ctx){
  this.storage=ctx.storage;
  this.readers=0;
  this.writing=false;
 }

 async fetch(request){
  if(request.method==='GET'){
   if(this.writing)return new Response(null,{status:409});
   ++this.readers;
   try{
    const head=await this.storage.get('head');
    if(head)return this.download(head);
    --this.readers;
    return new Response(null,{status:404});
   }catch(error){--this.readers;throw error;}
  }
  if(request.method!=='PUT')return new Response(null,{status:405});
  if(this.readers||this.writing)return new Response(null,{status:409});
  this.writing=true;
  try{
   const head=await this.storage.get('head');
   const match=request.headers.get('If-Match');
   if(match?match!==head?.etag:Boolean(head))return new Response(null,{status:412});
   return await this.upload(request,head);
  }finally{this.writing=false;}
 }

 async clear(slot,count){
  for(let offset=0;offset<count;offset+=128){
   await this.storage.delete(Array.from({length:Math.min(128,count-offset)},(_,i)=>key(slot,offset+i)));
  }
 }

 async upload(request,head){
  const size=Number(request.headers.get('Content-Length'));
  const slot=head?.slot===0?1:0;
  const staged=await this.storage.get('staged');
  // After a restart, either the staged slot or the previous slot can remain on disk.
  // Only clear what is not pointed to by the last completed upload.
  if(staged)await this.clear(slot,maxChunks);
  await this.storage.put('staged',true);
  const reader=request.body.getReader();
  let buffer=new Uint8Array(chunkSize),offset=0,count=0,total=0,complete=false;
  try{
   while(true){
    const {value,done}=await reader.read();
    if(done){complete=true;break;}
    total+=value.length;
    if(total>size)return new Response(null,{status:400});
    for(let start=0;start<value.length;){
     const n=Math.min(chunkSize-offset,value.length-start);
     buffer.set(value.subarray(start,start+n),offset);
     offset+=n;start+=n;
     if(offset===chunkSize){
      await this.storage.put(key(slot,count++),buffer,noCache);
      offset=0;
     }
    }
   }
   if(total!==size)return new Response(null,{status:400});
   if(offset)await this.storage.put(key(slot,count++),buffer.slice(0,offset),noCache);
   const etag='"'+crypto.randomUUID().replaceAll('-','')+'"';
   await this.storage.put('head',{slot,count,size,etag});
   if(head)await this.clear(head.slot,head.count);
   await this.storage.delete('staged');
   return new Response(null,{status:204,headers:{ETag:etag}});
  }finally{
   if(!complete)await reader.cancel().catch(()=>{});
   reader.releaseLock();
  }
 }

 download(head){
  let index=0,released=false;
  const release=()=>{if(!released){released=true;--this.readers;}};
  const body=new ReadableStream({
   pull:async controller=>{
    try{
     const chunk=await this.storage.get(key(head.slot,index++),noCache);
     if(!(chunk instanceof Uint8Array))throw Error('Missing stored chunk');
     if(released)return;
     controller.enqueue(chunk);
     if(index===head.count){controller.close();release();}
    }catch(error){if(!released)controller.error(error);release();}
   },
   cancel:release
  });
  return new Response(body,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(head.size),ETag:head.etag}});
 }
}

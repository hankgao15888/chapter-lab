(function(root){
 'use strict';
 function create({store,owner,download,onRestored}){
  const $=id=>root.document.getElementById(id),core=root.ChapterLabFileSyncCore;
  const dialog=$('fileSyncDialog'),status=$('fileSyncStatus'),keyInput=$('fileSyncCode');
  const select=$('fileSyncDocument'),importInput=$('fileSyncImport');
  const upload=$('fileSyncPush'),pull=$('fileSyncPull');
  const folderAPI=root.ChapterLabSyncFolder;
  const hasFolderPicker=typeof root.showDirectoryPicker==='function'&&Boolean(folderAPI);
  const folderSelect=$('fileSyncFolderPackage');
  let directory=null,folderFiles=[];
  const controls=['fileSyncNew','fileSyncUse','fileSyncReveal','fileSyncCopy','fileSyncExport'];
  let account,settings={},endpoint='',cryptoKeys=null,busy=false;

  function writeSettings(next){
   try{root.localStorage.setItem('chapterlab-file-sync-v1:'+account,JSON.stringify(next));}
   catch{throw Error('浏览器无法保存同步设置，请保留密钥并检查站点存储。');}
   settings=next;
  }
  function updateControls(){
   for(const id of controls)$(id).disabled=busy;
   $('fileSyncExport').disabled=busy||!cryptoKeys||select.options.length<2;
   importInput.disabled=busy||!cryptoKeys;
   select.disabled=busy;
   keyInput.disabled=busy;
   upload.disabled=busy||!endpoint||!cryptoKeys||select.options.length<2;
   pull.disabled=busy||!endpoint||!cryptoKeys;
   $('fileSyncVault').textContent=cryptoKeys?.vault||'请先设置同步密钥。';
   $('fileSyncFolderPick').disabled=busy||!hasFolderPicker;
   $('fileSyncFolderSave').disabled=busy||!directory||!cryptoKeys||select.options.length<2;
   $('fileSyncFolderRefresh').disabled=busy||!directory||!cryptoKeys;
   $('fileSyncFolderRestore').disabled=busy||!directory||!cryptoKeys;
   folderSelect.disabled=busy||!folderFiles.length;
   $('fileSyncFolderState').textContent=directory?`已选择「${directory.name}」`:
    hasFolderPicker?'选择坚果云已经同步到本地的文件夹。':'当前浏览器不能直接连接电脑文件夹。可下载坚果云里的 .clsync 文件后导入。';
  }
  async function task(message,work){
   if(busy)return;
   busy=true;updateControls();status.textContent=message;
   try{await work();}
   catch(error){status.textContent=error.name==='AbortError'?'已取消选择。':error.message||'同步未完成，请稍后重试。';}
   finally{busy=false;updateControls();}
  }
  async function listFiles(){
   const selected=select.value;
   const files=await store.list(account);
   select.replaceChildren();
   const all=root.document.createElement('option');all.textContent=`全部 ${files.length} 份 PDF`;all.value='';select.append(all);
   for(const file of files){
    const item=root.document.createElement('option');item.value=file.id;
    item.textContent=file.title+(file.id.includes(':sync-')?'（同步副本）':'');select.append(item);
   }
   if(files.some(file=>file.id===selected))select.value=selected;
  }
  async function makePack(selection){
   const documents=selection?[{id:selection}]:await store.list(account);
   const snapshots=[];
   for(const document of documents){
    const snapshot=await store.snapshot(account,document.id);
    if(!snapshot)throw Error('有文件已被删除或无法读取，请关闭窗口后重试。');
    snapshots.push(snapshot);
   }
   return core.pack(snapshots,account,cryptoKeys.key);
  }
  async function restorePack(blob){
   const snapshots=await core.unpack(blob,account,cryptoKeys.key);
   let result;
   try{result=await core.merge(store,account,snapshots);}
   catch(error){await reloadViews().catch(()=>{});throw error;}
   return `已导入 ${result.added} 份 PDF，跳过 ${result.same} 份相同文件。${result.conflicts?`其中 ${result.conflicts} 份不同版本另存为副本。`:''}`;
  }
  async function reloadViews(){await listFiles();await onRestored();}
  async function setCode(code){
   code=code.trim().toLowerCase();
   if(settings.code&&settings.code!==code&&!root.confirm('更换密钥会切换到另一组同步文件。确定继续吗？'))return false;
   const derived=await core.keys(code,account);
   writeSettings(settings.code===code?settings:{code});
   cryptoKeys=derived;
   keyInput.value=code;
   await refreshWithSavedPermission();
   return true;
  }
  $('fileSyncOpen').onclick=()=>{
   if(dialog.open)return;
   dialog.showModal();
   keyInput.type='password';$('fileSyncReveal').textContent='显示密钥';
   return task('正在读取同步设置…',async()=>{
    account=await owner();
    settings={};cryptoKeys=null;endpoint='';directory=null;
    setFolderFiles([]);
    try{settings=JSON.parse(root.localStorage.getItem('chapterlab-file-sync-v1:'+account)||'{}')||{};}catch{}
    keyInput.value=core.validCode(settings.code||'')?settings.code:'';
    if(keyInput.value)cryptoKeys=await core.keys(keyInput.value,account);
    await listFiles();
    if(hasFolderPicker){
     try{directory=await store.getSyncDirectory?.(account)||null;}catch{}
     await refreshWithSavedPermission();
    }
    try{
     const response=await root.fetch('file-sync-config.json',{cache:'no-store',signal:AbortSignal.timeout(5000)});
     if(response.ok){
      const config=await response.json();
      if(config.endpoint){
       const url=new URL(config.endpoint);
       const localhost=['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&['localhost','127.0.0.1','[::1]'].includes(root.location.hostname);
       if((url.protocol==='https:'||(localhost&&url.protocol==='http:'))&&!url.username&&!url.password)endpoint=new URL('/v1/files',url.origin).href;
      }
     }
    }catch{}
    $('fileSyncCloudState').textContent=endpoint?'使用同一学员名和同步密钥连接云端。':'云端存储尚未开通。可以用同步包迁移到其它设备。';
    status.textContent=cryptoKeys?'可导出同步包，或导入另一台设备的同步包。':'请先生成密钥，或填入原设备的同步密钥。';
   });
  };
  $('fileSyncNew').onclick=()=>task('正在生成密钥…',async()=>{
   status.textContent=await setCode(core.newCode())?'已生成。请复制密钥并妥善保存。':'已取消更换密钥。';
  });
  $('fileSyncUse').onclick=()=>task('正在设置密钥…',async()=>{
   status.textContent=await setCode(keyInput.value)?'已保存这台设备的同步密钥。':'已取消更换密钥。';
  });
  $('fileSyncReveal').onclick=()=>{
   const reveal=keyInput.type==='password';keyInput.type=reveal?'text':'password';
   $('fileSyncReveal').textContent=reveal?'隐藏密钥':'显示密钥';
  };
  $('fileSyncCopy').onclick=()=>task('正在复制…',async()=>{
   if(!cryptoKeys)throw Error('请先生成或设置同步密钥。');
   try{await root.navigator.clipboard.writeText(settings.code);status.textContent='已复制同步密钥。';}
   catch{status.textContent='自动复制失败。请显示密钥后手动复制。';}
  });
  $('fileSyncExport').onclick=()=>task('正在加密 PDF、截图和答案…',async()=>{
   const encrypted=await makePack(select.value);
   download(encrypted,`chapter-lab-${new Date().toISOString().slice(0,10)}.clsync`);
   status.textContent='已导出加密同步包。在另一设备使用同一学员名和密钥导入即可。';
  });
  importInput.onchange=()=>{
   const file=importInput.files[0];importInput.value='';
   if(!file||!cryptoKeys)return;
   return task('正在解密并导入同步包…',async()=>{
    status.textContent=await restorePack(file);await reloadViews();
   });
  };
  function setFolderFiles(files){
   const prior=folderSelect.value;
   folderFiles=files;
   folderSelect.replaceChildren();
   const latest=root.document.createElement('option');latest.value='';latest.textContent='最新同步包';folderSelect.append(latest);
   for(const file of folderFiles){
    const option=root.document.createElement('option');
    option.value=file.name;
    const date=new Date(file.createdAt).toLocaleString('zh-CN',{hour12:false});
    option.textContent=`${date} · ${file.name.slice(-19,-7)}`;
    folderSelect.append(option);
   }
   folderSelect.value=files.some(file=>file.name===prior)?prior:'';
  }
  async function refreshWithSavedPermission(){
   setFolderFiles([]);
   if(!directory||!cryptoKeys)return;
   try{
    if(await directory.queryPermission({mode:'read'})==='granted')setFolderFiles(await folderAPI.list(directory,cryptoKeys.vault));
   }catch{}
  }
  async function folderPermission(mode){
   if(!directory)throw Error('请先选择坚果云同步文件夹。');
   const options={mode};
   if(await directory.requestPermission(options)!=='granted')throw Error('未获得文件夹权限，请重新选择坚果云文件夹。');
  }
  $('fileSyncFolderPick').onclick=()=>task('请选择坚果云同步文件夹…',async()=>{
   const selected=await root.showDirectoryPicker({id:'chapter-lab-nutstore',mode:'readwrite'});
   directory=selected;
   let remembered=true;
   try{await store.setSyncDirectory(account,selected);}catch{remembered=false;}
   await refreshWithSavedPermission();
   status.textContent=remembered?'已选择文件夹。写入后，坚果云客户端会负责同步。':'已为本次打开选择文件夹。下次打开可能需要重新选择。';
  });
  $('fileSyncFolderSave').onclick=()=>task('正在加密并保存到坚果云文件夹…',async()=>{
   if(!cryptoKeys)throw Error('请先设置同步密钥。');
   await folderPermission('readwrite');
   const encrypted=await makePack(select.value);
   await folderAPI.write(directory,cryptoKeys.vault,encrypted);
   await refreshWithSavedPermission();
   status.textContent='已写入 Chapter Lab Sync 文件夹。请等坚果云客户端显示同步完成。';
  });
  $('fileSyncFolderRefresh').onclick=()=>task('正在读取坚果云文件夹…',async()=>{
   if(!cryptoKeys)throw Error('请先设置同步密钥。');
   await folderPermission('read');
   setFolderFiles(await folderAPI.list(directory,cryptoKeys.vault));
   status.textContent=folderFiles.length?`找到 ${folderFiles.length} 个同步包。`:'还没有找到同步包。等坚果云同步完成后再试。';
  });
  $('fileSyncFolderRestore').onclick=()=>task('正在读取并解密同步包…',async()=>{
   if(!cryptoKeys)throw Error('请先设置同步密钥。');
   const requested=folderSelect.value;
   await folderPermission('read');
   setFolderFiles(await folderAPI.list(directory,cryptoKeys.vault));
   const file=requested?folderFiles.find(item=>item.name===requested):folderFiles[0];
   if(!file)throw Error(requested?'选中的同步包已不在文件夹中，请重新选择。':'还没有找到可恢复的同步包。请核对密钥并等待坚果云同步完成。');
   const blob=await file.handle.getFile();
   if(blob.size<40)throw Error('同步包还未下载完整，请等坚果云同步完成后重试。');
   status.textContent=await restorePack(blob);await reloadViews();
  });
  function cloudRequest(method,options={}){
   const {headers={},...rest}=options;
   return root.fetch(endpoint,{method,cache:'no-store',signal:AbortSignal.timeout(120000),...rest,
    headers:{...headers,Authorization:'Bearer '+cryptoKeys.token}});
  }
  function cloudError(response){
   if(response.status===403||response.status===401)return '此同步存储尚未开通，请联系网站管理员。';
   if(response.status===412)return '云端已有新版本。请先下载合并，再尝试上传。';
   if(response.status===413)return '同步包超过云端允许的大小。';
   return '云端同步未完成，请检查网络后重试。';
  }
  upload.onclick=()=>task('正在加密并上传…',async()=>{
   const body=await makePack('');
   const conditions=settings.etag?{'If-Match':settings.etag}:{'If-None-Match':'*'};
   const response=await cloudRequest('PUT',{body,headers:{...conditions,'Content-Type':'application/octet-stream'}});
   if(!response.ok)throw Error(cloudError(response));
   const etag=response.headers.get('etag');
   if(!etag)throw Error('文件已上传，但未读取到云端版本。下次请先下载再上传。');
   writeSettings({...settings,etag});status.textContent='云端上传完成，可在另一台设备下载。';
  });
  pull.onclick=()=>task('正在下载并解密…',async()=>{
   const response=await cloudRequest('GET');
   if(response.status===404){status.textContent='云端还没有文件。请先在原设备上传。';return;}
   if(!response.ok)throw Error(cloudError(response));
   const summary=await restorePack(await response.blob());
   writeSettings({...settings,etag:response.headers.get('etag')||''});
   status.textContent=summary;await reloadViews();
  });
  dialog.addEventListener('close',()=>{keyInput.type='password';});
 }
 root.ChapterLabFileSync={create};
})(globalThis);

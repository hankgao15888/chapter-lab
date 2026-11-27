(function(root){
 'use strict';
 function create({store,owner,download,onRestored,canReplace,practiceSync}){
  const $=id=>root.document.getElementById(id),core=root.ChapterLabFileSyncCore;
  const dialog=$('fileSyncDialog'),status=$('fileSyncStatus'),keyInput=$('fileSyncCode');
  const select=$('fileSyncDocument'),importInput=$('fileSyncImport');
  const upload=$('fileSyncPush'),pull=$('fileSyncPull');
  const folderAPI=root.ChapterLabSyncFolder;
  const hasFolderPicker=typeof root.showDirectoryPicker==='function'&&Boolean(folderAPI);
  const folderSelect=$('fileSyncFolderPackage');
  let directory=null,folderFiles=[];
  const controls=['fileSyncNew','fileSyncUse','fileSyncReveal','fileSyncCopy','fileSyncExport'];
  let account,settings={},endpoint='',cryptoKeys=null,busy=false,initializing,endpointChecked=false;
  let edits=0,savedEdits=0,timer,autoRequested=false,lastCheck=0,retries=0;
  const activity=message=>{$('fileSyncActivity').textContent=message;};
  const practiceSnapshot=()=>{
   const records=practiceSync?.snapshot();
   return records&&root.ChapterLabPracticeSync.size(records)?records:null;
  };

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
   upload.disabled=busy||!endpoint||!cryptoKeys||(select.options.length<2&&!practiceSnapshot());
   pull.disabled=busy||!endpoint||!cryptoKeys;
   $('fileSyncVault').textContent=cryptoKeys?.vault||'请先设置同步密钥。';
   $('fileSyncCopyVault').disabled=busy||!cryptoKeys;
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
   finally{busy=false;updateControls();if(autoRequested){autoRequested=false;queueAuto(250);}}
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
  async function snapshotsFor(selection){
   const documents=selection?[{id:selection}]:await store.list(account);
   const snapshots=[];
   for(const document of documents){
    const snapshot=await store.snapshot(account,document.id);
    if(!snapshot)throw Error('有文件已被删除或无法读取，请关闭窗口后重试。');
    snapshots.push(snapshot);
   }
   return snapshots;
  }
  async function makePack(selection){return core.pack(await snapshotsFor(selection),account,cryptoKeys.key);}
  async function restorePack(blob){
   const snapshots=await core.unpack(blob,account,cryptoKeys.key);
   let result;
   try{result=await core.merge(store,account,snapshots);}
   catch(error){await reloadViews().catch(()=>{});throw error;}
   if(result.added)changed();
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
  function initialize(){
   if(!initializing)initializing=(async()=>{
    account=await owner();
    setFolderFiles([]);
    try{settings=JSON.parse(root.localStorage.getItem('chapterlab-file-sync-v1:'+account)||'{}')||{};}catch{}
    keyInput.value=core.validCode(settings.code||'')?settings.code:'';
    if(keyInput.value)cryptoKeys=await core.keys(keyInput.value,account);
    await listFiles();
    if(hasFolderPicker){
     try{directory=await store.getSyncDirectory?.(account)||null;}catch{}
     await refreshWithSavedPermission();
    }
   })().catch(error=>{initializing=null;throw error;});
   return initializing;
  }
  async function loadEndpoint(){
   if(!endpointChecked)try{
     const response=await root.fetch('file-sync-config.json',{cache:'no-store',signal:AbortSignal.timeout(5000)});
     if(response.ok){
      const config=await response.json();
      if(config.endpoint){
       const url=new URL(config.endpoint);
       const localhost=['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&['localhost','127.0.0.1','[::1]'].includes(root.location.hostname);
       if((url.protocol==='https:'||(localhost&&url.protocol==='http:'))&&!url.username&&!url.password)endpoint=new URL('/v1/files',url.origin).href;
      }
      endpointChecked=true;
     }
   }catch{}
   $('fileSyncCloudState').textContent=endpoint?'开通后自动同步。新设备只需设置一次原来的同步密钥。每次备份最多 80 MB。':endpointChecked?'云端存储尚未开通。可以用同步包迁移到其它设备。':'暂时无法读取云端配置，仍可使用同步包。';
  }
  $('fileSyncOpen').onclick=()=>{
   if(dialog.open)return;
   dialog.showModal();
   keyInput.type='password';$('fileSyncReveal').textContent='显示密钥';
   return task('正在读取同步设置…',async()=>{
    await initialize();await loadEndpoint();await listFiles();await refreshWithSavedPermission();
    status.textContent=cryptoKeys?'可导出同步包，或导入另一台设备的同步包。':'请先生成密钥，或填入原设备的同步密钥。';
   });
  };
  $('fileSyncNew').onclick=()=>task('正在生成密钥…',async()=>{
   status.textContent=await setCode(core.newCode())?'已生成。请复制密钥并妥善保存。':'已取消更换密钥。';
  });
  $('fileSyncUse').onclick=()=>task('正在设置密钥…',async()=>{
   const applied=await setCode(keyInput.value);
   status.textContent=applied?'已保存这台设备的同步密钥。':'已取消更换密钥。';
   if(applied&&endpoint)autoRequested=true;
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
  $('fileSyncCopyVault').onclick=()=>task('正在复制存储编号…',async()=>{
   if(!cryptoKeys)throw Error('请先设置同步密钥。');
   try{await root.navigator.clipboard.writeText(cryptoKeys.vault);status.textContent='已复制存储编号。开通云端只需要这个编号。';}
   catch{status.textContent='自动复制失败。请选中下方显示的编号手动复制。';}
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
   const messages={401:'请重新设置原设备的同步密钥。',403:'当前存储编号未开通。请确认使用原设备的同步密钥，或把存储编号提供给管理员。',409:'另一台设备正在同步，请稍后重试。',412:'云端已有新版本，请稍后重试。',413:'同步包超过云端允许的大小。'};
   return Object.assign(Error(messages[response.status]||'云端同步未完成，请检查网络后重试。'),{retryable:[409,412].includes(response.status)});
  }
  async function uploadCloud(){
   const epoch=edits,snapshots=await snapshotsFor('');
   const practice=practiceSnapshot();
   if(!snapshots.length&&!practice)throw Error('这台设备没有可备份的 PDF 或练习记录。');
   const baseline=await core.signatures(snapshots,account);
   const body=await core.pack(snapshots,account,cryptoKeys.key,practice);
   const conditions=settings.etag?{'If-Match':settings.etag}:{'If-None-Match':'*'};
   const response=await cloudRequest('PUT',{body,headers:{...conditions,'Content-Type':'application/octet-stream'}});
   if(!response.ok)throw cloudError(response);
   const etag=response.headers.get('etag');
   if(!etag)throw Error('文件已上传，但未读取到云端版本。下次请先下载再上传。');
   writeSettings({...settings,etag,baseline,practiceEtag:etag,pending:epoch!==edits});
   savedEdits=epoch;
   return true;
  }
  async function readCloud(force=false){
   const response=await cloudRequest('GET');
   if(response.status===404){
    if(settings.etag)writeSettings({...settings,etag:'',practiceEtag:'',baseline:{}});
    return {empty:true,summary:'云端还没有文件。请在原设备打开网站完成备份。'};
   }
   if(!response.ok)throw cloudError(response);
   const etag=response.headers.get('etag');
   if(!etag)throw Error('无法确认云端文件版本，请稍后重试。');
   if(!force&&etag===settings.etag&&settings.baseline&&(!practiceSync||etag===settings.practiceEtag)){
    await response.body?.cancel();return {summary:'云端资料已是最新。'};
   }
   const {snapshots,practice}=await core.unpackBundle(await response.blob(),account,cryptoKeys.key);
   let result;
   try{result=await core.mergeCloud(store,account,snapshots,settings.baseline,canReplace);}
   catch(error){await reloadViews().catch(()=>{});throw error;}
   const needsUpload=practiceSync?.receive(practice)??false;
   writeSettings({...settings,etag,baseline:result.baseline,practiceEtag:etag,pending:settings.pending||needsUpload});
   if(result.added||result.updated)await reloadViews();
   const summary=`云端同步完成：新增 ${result.added} 份，更新 ${result.updated} 份 PDF。${practice?'错题和练习记录也已合并。':''}${result.conflicts?`已保留 ${result.conflicts} 份不同版本。`:''}`;
   return {summary};
  }
  async function syncAutomatically(){
   if(busy){autoRequested=true;return;}
   lastCheck=Date.now();
   return task('正在检查云端资料…',async()=>{
    try{
     await initialize();await loadEndpoint();
     if(!endpointChecked){activity('暂时连不上云端，资料仍在本机。');status.textContent='恢复联网后会重试。';return;}
     if(!endpoint){activity('');status.textContent='可使用坚果云或同步包迁移资料。';return;}
     if(!cryptoKeys){activity('换设备时，在「文件同步」填写原来的密钥即可自动恢复。');status.textContent='请填入原设备的同步密钥，或首次使用时生成。';return;}
     activity('正在读取云端资料…');
     const remote=await readCloud();
     if((settings.pending||edits>savedEdits||remote.empty)&&(practiceSnapshot()||(await store.list(account)).length)){
      activity('正在加密备份到云端…');
      await uploadCloud();
      status.textContent='云端备份完成，可在另一台设备查看。';
     }else status.textContent=remote.summary;
     activity(status.textContent);retries=0;
    }catch(error){
     if(error.retryable&&retries++<3){activity('等待另一台设备同步完成…');queueAuto(1800);}
     else activity(error.name==='TimeoutError'||error instanceof TypeError?'暂时连不上云端，资料仍在本机。':error.message);
     throw error;
    }
   });
  }
  function queueAuto(delay=1500){
   root.clearTimeout(timer);timer=root.setTimeout(syncAutomatically,delay);
  }
  function changed(){
   edits++;
   if(!cryptoKeys||(endpointChecked&&!endpoint))return;
   try{if(!settings.pending)writeSettings({...settings,pending:true});}
   catch{settings={...settings,pending:true};}
   retries=0;activity('本机已保存，等待备份…');queueAuto();
  }
  upload.onclick=()=>task('正在加密并上传…',async()=>{
   await readCloud();await uploadCloud();
   status.textContent='云端上传完成，可在另一台设备查看。';activity(status.textContent);
  });
  pull.onclick=()=>task('正在下载并解密…',async()=>{
   status.textContent=(await readCloud(true)).summary;activity(status.textContent);
  });
  dialog.addEventListener('close',()=>{keyInput.type='password';});
  let started=false;
  function start(){
   if(started)return;started=true;
   root.addEventListener('online',()=>{retries=0;queueAuto(300);});
   root.document.addEventListener('visibilitychange',()=>{
    if(!root.document.hidden&&(settings.pending||Date.now()-lastCheck>30000))queueAuto(300);
   });
   queueAuto(0);
  }
  return {start,changed};
 }
 root.ChapterLabFileSync={create};
})(globalThis);

import {readFile, writeFile, rename} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {REGISTRY_TOPIC} from './sync-account-index.mjs';
const {validEvent} = createRequire(import.meta.url)('../docs/login-activity.js');
export function parseLoginEvents(text) {
  const events=[];
  for (const line of String(text || '').split(/\r?\n/)) {
    try {
      const relay=JSON.parse(line);
      const event=relay.event==='message' ? JSON.parse(relay.message) : null;
      if(validEvent(event)) events.push(event);
    } catch {}
  }
  return events;
}
export function mergeLoginEvents(existing, incoming) {
  const map=new Map();
  for(const event of [...(existing?.events || []), ...incoming]) {
    if(validEvent(event) && !map.has(event.id)) map.set(event.id,event);
  }
  return {version:1, events:[...map.values()].sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id))};
}
if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file=new URL('../docs/login-events.json',import.meta.url);
  let existing={version:1,events:[]};
  try {existing=JSON.parse(await readFile(file,'utf8'));} catch(error) {if(error.code!=='ENOENT') throw error;}
  const response=await fetch(`https://ntfy.sh/${REGISTRY_TOPIC}/json?poll=1&since=all`);
  if(!response.ok) throw new Error(`Login relay HTTP ${response.status}`);
  const merged=mergeLoginEvents(existing,parseLoginEvents(await response.text()));
  if(JSON.stringify(existing)!==JSON.stringify(merged)) {
    const temporary=fileURLToPath(file)+'.tmp';
    await writeFile(temporary,JSON.stringify(merged,null,2)+'\n');
    await rename(temporary,file);
  }
  console.log(JSON.stringify({encryptedLoginEvents:merged.events.length}));
}

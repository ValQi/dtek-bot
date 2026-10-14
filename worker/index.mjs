import crypto from 'node:crypto';
import format from '../src/format.cjs';
import statePackage from '../src/state.cjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length>0&&x.length===y.length&&crypto.timingSafeEqual(x,y);};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export default {
 async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/health'&&request.method==='GET')return json({service:'dtek-telegram',ready:!!(env.TELEGRAM_BOT_TOKEN&&env.WORKER_SECRET&&env.WEBHOOK_SECRET&&env.GITHUB_DISPATCH_TOKEN&&env.DTEK_ADDRESSES_JSON&&env.STATE_KEY)});
  if(request.method!=='POST')return json({error:'not found'},404);
  if(path==='/telegram'){
   if(!equal(request.headers.get('X-Telegram-Bot-Api-Secret-Token'),env.WEBHOOK_SECRET))return json({error:'unauthorized'},403);
  }else if(['/results','/admin/import','/admin/status','/admin/refresh'].includes(path)){
   if(!equal(request.headers.get('X-Worker-Key'),env.WORKER_SECRET))return json({error:'unauthorized'},403);
  }else return json({error:'not found'},404);
  const text=await request.text();if(text.length>256000)return json({error:'too large'},413);
  const id=env.BOT.idFromName('bot');
  return env.BOT.get(id).fetch(new Request('https://internal'+path,{method:'POST',body:text,headers:{'Content-Type':'application/json'}}));
 },
 async scheduled(controller,env,ctx){ctx.waitUntil(env.BOT.get(env.BOT.idFromName('bot')).fetch(new Request('https://internal/admin/refresh',{method:'POST',body:'{}'})).then(r=>{if(!r.ok)throw Error('Scheduled refresh failed');}));}
};
export class BotState {
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.queue=Promise.resolve();ctx.blockConcurrencyWhile(async()=>{this.saved=await ctx.storage.get('state')||null;this.lastDispatch=await ctx.storage.get('lastDispatch')||0;});}
 async api(method,body){
  for(let attempt=0;attempt<2;attempt++){
   let data;
   try{const r=await fetch('https://api.telegram.org/bot'+this.env.TELEGRAM_BOT_TOKEN+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});data=await r.json();}
   catch{if(attempt===0){await sleep(500);continue;}throw Error('Telegram unavailable');}
   if(data.ok)return data.result;
   if(data.error_code===429&&attempt===0){await sleep(Math.min(data.parameters?.retry_after||1,15)*1000);continue;}
   const e=Error('Telegram rejected operation');e.blocked=data.error_code===403;e.expired=/query is too old|query id is invalid/i.test(data.description||'');e.unchanged=/message is not modified/i.test(data.description||'');throw e;
  }
 }
 async init(){
  if(this.bot)return;
  const {Subscriptions}=(await import('../src/subscriptions.cjs')).default;
  this.addresses=(await import('../src/addresses.js')).default;
  const send=async(text,id,options={})=>{let message;for(const chunk of String(text).match(/[\s\S]{1,3800}/g)||['']){message=await this.api('sendMessage',{chat_id:id,text:chunk,...options});}return message;};
  this.bot=new Subscriptions(null,null,send,format,()=>{this.refreshRequested=true;},this.env.BOT_USERNAME,{
   immediate:true,
   answer:async(id,text)=>{try{await this.api('answerCallbackQuery',{callback_query_id:id,text});}catch(e){if(!e.expired)throw e;}},
   edit:async(id,message,text,markup)=>{try{await this.api('editMessageText',{chat_id:id,message_id:message,text,reply_markup:markup});}catch(e){if(!e.unchanged)throw e;}}
  },this.saved);
 }
 async dispatch(){
  if(Date.now()-this.lastDispatch<30000)return;
  const r=await fetch('https://api.github.com/repos/'+this.env.GITHUB_REPOSITORY+'/actions/workflows/monitor.yml/dispatches',{method:'POST',headers:{Authorization:'Bearer '+this.env.GITHUB_DISPATCH_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'DTEK-Worker'},body:JSON.stringify({ref:'main'}),signal:AbortSignal.timeout(20000)});
  if(!r.ok){this.dispatchError='HTTP '+r.status;await this.ctx.storage.put('dispatchError',this.dispatchError);throw Error('GitHub refresh unavailable');}
  this.lastDispatch=Date.now();this.dispatchError=null;await this.ctx.storage.put('lastDispatch',this.lastDispatch);await this.ctx.storage.delete('dispatchError');
 }
 fetch(request){const task=this.queue.catch(()=>{}).then(()=>this.handle(request));this.queue=task;return task;}
 async handle(request){
  await this.init();let failure=false;
  try{
   const path=new URL(request.url).pathname,data=await request.json();
   if(path==='/admin/import'){
    const imported=statePackage.open(JSON.stringify(data),statePackage.key(this.env.STATE_KEY));
    if(imported.version!==2||!imported.subscribers||!imported.latest)throw Error('Invalid import');
    if(await this.ctx.storage.get('imported'))return json({error:'already imported'},409);
    this.bot.state=imported;await this.ctx.storage.put('imported',true);
   }else if(path==='/telegram'){
    if(!Number.isSafeInteger(data.update_id))return json({error:'invalid update'},400);
    await this.bot.update(data);
   }else if(path==='/results'){
    if(!Array.isArray(data.results)||data.results.length>this.addresses.length)return json({error:'invalid results'},400);
    for(const result of data.results){
     const a=this.addresses.find(a=>a.id===result.id);
     if(!a||a.label!==result.label||typeof result.status!=='string'||!Number.isFinite(Date.parse(result.checked))||Math.abs(Date.now()-Date.parse(result.checked))>15*60000)return json({error:'invalid result'},400);
    }
    for(const result of data.results){
     const previous=this.bot.state.latest[result.id];
     if(previous&&Date.parse(result.checked)<Date.parse(previous.checked))continue;
     try{await this.bot.publish(result);}catch{failure=true;}
    }
   }else if(path==='/admin/refresh')this.refreshRequested=true;
   else if(path==='/admin/status')return json({latestChecks:this.addresses.map(a=>({id:a.id,checked:this.bot.state.latest[a.id]?.checked||null})),privateSubscribers:Object.keys(this.bot.state.subscribers).filter(id=>!id.startsWith('-')).length,groups:Object.keys(this.bot.state.subscribers).filter(id=>id.startsWith('-')).length,lastDispatch:this.lastDispatch,dispatchError:await this.ctx.storage.get('dispatchError')||null});
   else return json({error:'not found'},404);
  }catch{failure=true;}
  finally{await this.ctx.storage.put('state',this.bot.state);}
  if(this.refreshRequested){this.refreshRequested=false;try{await this.dispatch();}catch{failure=true;}}
  return json({ok:!failure},failure?503:200);
 }
}

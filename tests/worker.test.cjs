const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.DTEK_ADDRESSES_JSON=JSON.stringify([{id:'one',label:'Example',street:'Example',house:'1',url:'https://www.dtek-kem.com.ua/ua/shutdowns'}]);
test('gateway requires secrets before forwarding webhook or results',async()=>{
 const {default:worker}=await import('../worker/index.mjs');let calls=0;
 const env={WEBHOOK_SECRET:'telegram-secret',WORKER_SECRET:'worker-secret',BOT:{idFromName:()=>1,get:()=>({fetch:async()=>{calls++;return new Response('{}');}})}};
 for(const path of ['/telegram','/results','/admin/import','/admin/status','/admin/refresh']){
  assert.equal((await worker.fetch(new Request('https://example.com'+path,{method:'POST',body:'{}'}),env)).status,403);
 }
 assert.equal(calls,0);
 assert.equal((await worker.fetch(new Request('https://example.com/telegram',{method:'POST',body:'{}',headers:{'X-Telegram-Bot-Api-Secret-Token':'telegram-secret'}}),env)).status,200);
 assert.equal(calls,1);
 assert.equal((await (await worker.fetch(new Request('https://example.com/health'),env)).json()).ready,false);
});
test('worker preserves group selections, answers callbacks, deduplicates and rejects stale results',async()=>{
 const {BotState}=await import('../worker/index.mjs');const store=new Map(),sent=[],answers=[],dispatches=[];
 let ready;const ctx={storage:{get:async k=>store.get(k),put:async(k,v)=>store.set(k,structuredClone(v)),delete:async k=>store.delete(k)},blockConcurrencyWhile:fn=>{ready=fn();}};
 const env={BOT_USERNAME:'test_bot',TELEGRAM_BOT_TOKEN:'fake',GITHUB_REPOSITORY:'example/test',GITHUB_DISPATCH_TOKEN:'fake'};
 const bot=new BotState(ctx,env);await ready;
 const original=global.fetch;
 global.fetch=async(url,options)=>{
  const data=JSON.parse(options.body);
  if(url.includes('api.github.com')){dispatches.push(data);return new Response(null,{status:204});}
  if(url.endsWith('/sendMessage'))sent.push(data);
  if(url.endsWith('/answerCallbackQuery'))answers.push(data);
  return Response.json({ok:true,result:{message_id:sent.length}});
 };
 const request=(path,data)=>bot.fetch(new Request('https://internal'+path,{method:'POST',body:JSON.stringify(data)}));
 try{
  await request('/telegram',{update_id:1,message:{chat:{id:-100,type:'supergroup'},from:{id:10},text:'/start@test_bot'}});
  const menu=bot.bot.state.menus[-100];assert.match(sent[0].text,/сразу/);
  const callback=(update,action)=>request('/telegram',{update_id:update,callback_query:{id:String(update),from:{id:10},message:{chat:{id:-100},message_id:menu.messageId},data:`addr:${menu.nonce}:${action}`}});
  await callback(2,'one');await callback(3,'save');assert.deepEqual(bot.bot.selected(-100),['one']);assert.equal(answers.length,2);assert.equal(dispatches.length,1);
  const result={id:'one',label:'Example',mode:'schedule',status:'По графику — свет предусмотрен',cells:Array(24).fill('cell-non-scheduled'),date:'13.10.2026',checked:new Date(Date.now()+10).toISOString()};
  await request('/results',{results:[result]});const count=sent.length;
  await request('/results',{results:[result]});assert.equal(sent.length,count);
  await request('/results',{results:[{...result,status:'Outage',checked:new Date(Date.now()-1000).toISOString()}]});assert.equal(sent.length,count);assert.equal(bot.bot.state.latest.one.status,result.status);
  await request('/telegram',{update_id:4,message:{chat:{id:-100,type:'supergroup'},from:{id:10},text:'/status@test_bot'}});assert.ok(sent.length>count);assert.ok(sent.every(m=>String(m.chat_id)==='-100'));assert.equal(dispatches.length,1,'refreshes are throttled');
  const restored=new BotState(ctx,env);await ready;await restored.init();assert.deepEqual(restored.bot.selected(-100),['one']);assert.equal(restored.bot.state.offset,5);
 }finally{global.fetch=original;}
});

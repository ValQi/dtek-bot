const {StateStore}=require('./state.cjs'),{Subscriptions}=require('./subscriptions.cjs'),format=require('./format.cjs'),addresses=require('./addresses.js');
const {collect}=require('./collector.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const token=process.env.TELEGRAM_BOT_TOKEN;if(!token)throw Error('Configure TELEGRAM_BOT_TOKEN');
 const store=new StateStore(),state=await store.load();console.log('Encrypted state loaded.');
 async function api(method,body={}){
  let result;
  for(let attempt=0;attempt<2;attempt++){
   try{const r=await fetch('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});result=await r.json();}
   catch(e){console.warn('Telegram '+method+' transport failure: '+(['TypeError','TimeoutError','AbortError','SyntaxError'].includes(e.name)?e.name:'NETWORK'));if(attempt===0){await sleep(1500);continue;}throw Error('Telegram transport unavailable');}
   if(result.ok)return result.result;
   if(result.error_code===429&&attempt===0){await sleep(Math.min(result.parameters?.retry_after||3,60)*1000);continue;}break;
  }
  const e=Error('Telegram operation failed');console.warn('Telegram '+method+' HTTP '+Number(result.error_code));e.blocked=result.error_code===403;e.expired=/query is too old|query id is invalid/i.test(result.description||'');e.unchanged=/message is not modified/i.test(result.description||'');throw e;
 }
 const me=await api('getMe'),hook=await api('getWebhookInfo');console.log('Telegram credentials verified.');
 if(hook.url)throw Error('Webhook is active: remove it before switching to Actions polling');
 const send=async(text,id,options={})=>{const r=await api('sendMessage',{chat_id:id,text,...options});await sleep(1100);return r;};
 const subscriptions=new Subscriptions(null,null,send,format,()=>{},me.username,{
  answer:async(id,text)=>{try{await api('answerCallbackQuery',{callback_query_id:id,text});}catch(e){if(!e.expired)throw e;}},
  edit:async(id,message,text,markup)=>{try{await api('editMessageText',{chat_id:id,message_id:message,text,reply_markup:markup});}catch(e){if(!e.unchanged)throw e;}}
 },state);
 let browser,failed=false;
 try{
  // Drain up to 1,000 updates. The offset is encrypted together with subscriptions.
  for(let batch=0;batch<10;batch++){
   const updates=await api('getUpdates',{offset:subscriptions.state.offset,timeout:0,limit:100,allowed_updates:['message','callback_query']});
   for(const u of updates)await subscriptions.update(u);if(updates.length<100)break;
  }
  console.log('Telegram updates processed. Starting DTEK checks.');browser=await require('playwright').chromium.launch({headless:true});
  // Two addresses at a time, avoiding a burst of requests against DTEK.
  for(let i=0;i<addresses.length;i+=2){
   const results=await Promise.all(addresses.slice(i,i+2).map(a=>collect(browser,a)));
   for(const r of results){try{await subscriptions.publish(r);}catch{console.warn('Telegram delivery failed for '+r.id);failed=true;}if(r.error)failed=true;else console.log('DTEK '+r.id+' received');}
  }
 }finally{
  try{await store.save(subscriptions.state);console.log('Encrypted state saved.');}finally{if(browser)await browser.close();}
 }
 if(failed)throw Error('Some DTEK checks or Telegram deliveries failed; state was saved');
 console.log('DTEK checks completed; encrypted state saved.');
}
if(require.main===module)main().catch(e=>{console.error(['Configure TELEGRAM_BOT_TOKEN','Webhook is active: remove it before switching to Actions polling'].includes(e.message)?e.message:'Run failed. Check Secrets, Actions permissions and DTEK availability. No credentials are logged.');process.exitCode=1;});
module.exports={main};


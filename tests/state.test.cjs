const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {seal,open,key}=require('../src/state.cjs');
test('state hides subscribers and authenticates ciphertext',()=>{
 const k=crypto.randomBytes(32),data={offset:10,subscribers:{'123456':{selected:['one']}}};
 const encrypted=seal(data,k);assert.ok(!encrypted.includes('123456'));assert.deepEqual(open(encrypted,k),data);
 assert.throws(()=>open(encrypted,crypto.randomBytes(32)));
 const modified=JSON.parse(encrypted);const b=Buffer.from(modified.body,'base64');b[0]^=1;modified.body=b.toString('base64');assert.throws(()=>open(JSON.stringify(modified),k));
 assert.throws(()=>key('bad'));assert.deepEqual(key(k.toString('base64')),k);
});
test('subscription selection, persistence, deduplication and emergency latch',async()=>{
 process.env.DTEK_ADDRESSES_JSON=JSON.stringify([{id:'one',label:'Example',street:'Example',house:'1',url:'https://www.dtek-kem.com.ua/ua/shutdowns'}]);
 const {Subscriptions}=require('../src/subscriptions.cjs'),format=require('../src/format.cjs');
 const messages=[],send=async(text,id)=>{messages.push({text,id});return {message_id:messages.length};};
 {
  const bot=new Subscriptions(null,null,send,format,()=>{},'test_bot',{answer:async()=>{},edit:async()=>{}});
  await bot.update({update_id:1,message:{chat:{id:10,type:'private'},from:{id:10},text:'/start'}});
  let menu=bot.state.menus[10];
  const callback=(id,action)=>bot.update({update_id:id,callback_query:{id:String(id),from:{id:10},message:{chat:{id:10},message_id:menu.messageId},data:`addr:${menu.nonce}:${action}`}});
  await callback(2,'one');await callback(3,'save');assert.deepEqual(bot.selected(10),['one']);
  const r={id:'one',label:'Example',mode:'emergency',status:'Экстренные отключения',checked:new Date(Date.now()+1).toISOString()};
  await bot.publish(r);const count=messages.length;await bot.publish(r);assert.equal(messages.length,count);
  await bot.publish({...r,mode:'unknown',error:'No data'});assert.equal(bot.state.latest.one.mode,'emergency');
  const cells=Array(24).fill('cell-non-scheduled');
  await bot.publish({...r,mode:'schedule',status:'По графику — свет предусмотрен',cells,date:'13.10.2026'});
  assert.equal(bot.state.latest.one.mode,'schedule');assert.equal(bot.state.latest.one.resumed,true);assert.match(messages.at(-1).text,/возвращении к графикам/);
  const restored=new Subscriptions(null,null,send,format,()=>{},'',{},structuredClone(bot.state));assert.deepEqual(restored.selected(10),['one']);assert.equal(restored.state.offset,4);
  await bot.update({update_id:4,message:{chat:{id:-100,type:'supergroup'},from:{id:10},text:'/start'}});
  menu=bot.state.menus[-100];assert.ok(menu,'plain group commands must be accepted');
  const groupCallback=(id,action)=>bot.update({update_id:id,callback_query:{id:String(id),from:{id:10},message:{chat:{id:-100},message_id:menu.messageId},data:`addr:${menu.nonce}:${action}`}});
  await groupCallback(5,'one');await groupCallback(6,'save');assert.deepEqual(bot.selected(-100),['one']);
  const before=messages.length;await bot.update({update_id:7,message:{chat:{id:-100,type:'supergroup'},from:{id:10},text:'/status@another_bot'}});assert.equal(messages.length,before);
  await bot.update({update_id:8,message:{chat:{id:-100,type:'supergroup'},from:{id:10},text:'/status'}});assert.ok(messages.slice(before).every(m=>m.id==='-100'));assert.match(messages[before].text,/Example/);assert.ok(bot.state.subscribers[-100].pending);
 }
});


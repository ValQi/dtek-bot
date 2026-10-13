const fs=require('node:fs'),crypto=require('node:crypto');
const addresses=require('./addresses.js'),addressIds=addresses.map(a=>a.id);
const fingerprint=r=>JSON.stringify([r.mode,r.status,r.cells,r.date,r.error]);
class Subscriptions{
 constructor(file,owner,send,format,requestRefresh=()=>{},botUsername='',ui={},initialState=null){
  Object.assign(this,{file,send,format,requestRefresh,ui});this.botUsername=botUsername.toLowerCase();this.queue=Promise.resolve();
  this.state=initialState||{version:2,offset:0,subscribers:{},latest:{},menus:{}};
  if(file)try{this.state=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  this.state.menus??={};
  if(this.state.version!==2){
   for(const s of Object.values(this.state.subscribers)){s.selected=['village','kyiv','kyiv21'];delete s.pending;}
   this.state.version=2;this.save();
  }
 }
 save(){if(!this.file)return;const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.state));fs.renameSync(tmp,this.file);}
 serial(fn){const p=this.queue.catch(()=>{}).then(fn);this.queue=p;return p;}
 selected(id){return (this.state.subscribers[id]?.selected||[]).filter(k=>addressIds.includes(k));}
 snapshot(ids){return addresses.filter(a=>ids.includes(a.id)).map(({id,label})=>{
  const r=this.state.latest[id];if(!r)return label+': ожидаем свежую проверку ДТЭК.';
  return (Date.now()-Date.parse(r.checked)>12*60000?'⚠ Данные устарели, актуальный статус неизвестен.\n':'')+this.format(r);
 }).join('\n\n');}
 markup(menu){return {inline_keyboard:[...addresses.map(a=>[{text:(menu.selected.includes(a.id)?'✅ ':'⬜ ')+a.label,callback_data:`addr:${menu.nonce}:${a.id}`}]),[{text:'Сохранить выбор',callback_data:`addr:${menu.nonce}:save`},{text:'Отмена',callback_data:`addr:${menu.nonce}:cancel`}]]};}
 menuText(menu){return (menu.group?'Выбор адресов для всей группы.\n':'Выберите адреса для ваших уведомлений.\n')+'1. Нажмите кнопки нужных адресов ниже — можно выбрать несколько. Отмеченные адреса имеют ✅.\n2. Нажмите «Сохранить выбор». Бот запомнит список и будет присылать уведомления только по нему.\n\nВыбранные: '+menu.selected.length+'. Проверка по расписанию примерно раз в 5 минут, возможны задержки GitHub. Команды и кнопки обрабатываются при следующем запуске. Нажмите одну кнопку и дождитесь обновления перед следующим нажатием. Уведомления только при изменениях.\nИзменить выбор позже: /addresses'+(menu.group?'@'+this.botUsername:'')+'. Адрес текстом или через слеш вводить не нужно.';}
 async showMenu(id,actor,group){
  const menu={nonce:crypto.randomBytes(6).toString('hex'),actor:String(actor),group,selected:[...this.selected(id)]};
  this.state.menus[id]=menu;this.save();
  const message=await this.send(this.menuText(menu),id,{reply_markup:this.markup(menu)});
  menu.messageId=message.message_id;this.save();
 }
 request(id){const s=this.state.subscribers[id];s.pending={since:Date.now(),ids:[...this.selected(id)]};this.requestRefresh();this.save();}
 async callback(q){
  const id=String(q.message?.chat?.id),menu=this.state.menus[id];
  const [prefix,nonce,action]=String(q.data||'').split(':');
  if(prefix!=='addr'||!menu||menu.nonce!==nonce||menu.messageId!==q.message?.message_id){await this.ui.answer(q.id,'Меню устарело. Откройте /addresses заново.');return;}
  if(menu.actor!==String(q.from?.id)){await this.ui.answer(q.id,'Это меню другого участника. Откройте своё через /addresses@'+this.botUsername);return;}
  if(action==='cancel'){
   await this.ui.answer(q.id,'Выбор отменён');delete this.state.menus[id];this.save();
   await this.ui.edit(id,menu.messageId,'Выбор отменён. Сохранённые настройки не изменились.',{inline_keyboard:[]});return;
  }
  if(action==='save'){
   const selected=menu.selected.filter(k=>addressIds.includes(k));
   const s=this.state.subscribers[id]??={sent:{}};s.selected=[...selected];s.sent={};delete s.pending;
   delete this.state.menus[id];this.save();if(selected.length)this.request(id);
   await this.ui.answer(q.id,'Выбор сохранён');
   const labels=addresses.filter(a=>selected.includes(a.id)).map(a=>a.label).join('\n');
   await this.ui.edit(id,menu.messageId,selected.length?'Выбор сохранён:\n'+labels+'\n\nЗапросил свежую проверку. Далее — только изменения. /addresses — изменить выбор.':'Выбор сохранён: уведомления отключены, адреса не выбраны. /addresses — выбрать адреса.',{inline_keyboard:[]});return;
  }
  if(!addressIds.includes(action)){await this.ui.answer(q.id,'Неизвестный адрес');return;}
  if(menu.lastCallback!==q.id){menu.selected=menu.selected.includes(action)?menu.selected.filter(k=>k!==action):[...menu.selected,action];menu.lastCallback=q.id;this.save();}
  await this.ui.answer(q.id,menu.selected.includes(action)?'Адрес отмечен':'Адрес снят');
  await this.ui.edit(id,menu.messageId,this.menuText(menu),this.markup(menu));
 }
 update(u){return this.serial(async()=>{
  if(u.update_id<this.state.offset)return;
  if(u.callback_query)await this.callback(u.callback_query);
  else{
   const m=u.message,[command,target]=(m?.text||'').trim().split(/\s/)[0].toLowerCase().split('@');
   const group=['group','supergroup'].includes(m?.chat?.type);
   if(m?.chat?.type==='private'||group&&this.botUsername&&target===this.botUsername){
    const id=String(m.chat.id);
    try{
     if(command==='/start'||command==='/addresses')await this.showMenu(id,m.from?.id??m.chat.id,group);
     else if(command==='/stop'){
      delete this.state.subscribers[id];delete this.state.menus[id];this.save();
      await this.send('Уведомления отключены. /start'+(group?'@'+this.botUsername:'')+' — выбрать адреса заново.',id);
     }else if(command==='/status'){
      if(!this.selected(id).length)await this.showMenu(id,m.from?.id??m.chat.id,group);
      else{this.request(id);await this.send('Запросил свежие данные по выбранным адресам. Результаты придут отдельными сообщениями.',id);}
     }
    }catch(e){if(e.blocked){delete this.state.subscribers[id];delete this.state.menus[id];this.save();}else throw e;}
   }
  }
  this.state.offset=u.update_id+1;this.save();
 });}
 publish(r){return this.serial(async()=>{
  const previous=this.state.latest[r.id];
  if(['emergency','suspended'].includes(previous?.mode)&&!['emergency','suspended','schedule'].includes(r.mode)){
   r={...r,mode:previous.mode,status:previous.status,scope:previous.scope,unconfirmed:true};delete r.cells;delete r.date;
  }else if(['emergency','suspended'].includes(previous?.mode)&&r.mode==='schedule')r={...r,resumed:true};
  this.state.latest[r.id]=r;this.save();let failed=false;
  for(const [id,s] of Object.entries(this.state.subscribers)){
   if(!this.selected(id).includes(r.id))continue;
   const requested=s.pending?.ids.includes(r.id)&&Date.parse(r.checked)>=s.pending.since;
   const fp=fingerprint(r);if(s.sent[r.id]===fp&&!requested)continue;
   try{
    await this.send(this.format(r),id);s.sent[r.id]=fp;
    if(requested){s.pending.ids=s.pending.ids.filter(k=>k!==r.id);if(!s.pending.ids.length)delete s.pending;}
    this.save();
   }catch(e){if(e.blocked){delete this.state.subscribers[id];this.save();}else failed=true;}
  }
  if(failed)throw Error('Some deliveries failed');
 });}
 checkPending(browserConnected){return this.serial(async()=>{
  for(const [id,s] of Object.entries(this.state.subscribers)){
   if(!s.pending||s.pending.warned||Date.now()-s.pending.since<90000)continue;
   try{
    await this.send(browserConnected?'ДТЭК пока не предоставил свежие результаты для выбранных адресов. Проверка продолжится.':'Нет связи с расширением на ноутбуке. Откройте браузер и нажмите «Запустить» в расширении ДТЭК.',id);
    s.pending.warned=true;this.save();
   }catch(e){if(e.blocked){delete this.state.subscribers[id];this.save();}}
  }
 });}
}
module.exports={Subscriptions};



const path=require('node:path');
async function collect(browser,address){
 const context=await browser.newContext({locale:'uk-UA',timezoneId:'Europe/Kyiv'});
 const page=await context.newPage();
 const base={id:address.id,label:address.label,source:new URL(address.url).origin+'/ua/shutdowns'};
 try{
  await page.goto(base.source,{waitUntil:'domcontentloaded',timeout:45000});
  await page.addScriptTag({path:path.join(__dirname,'core.js')});
  const data=await page.evaluate(async a=>{
   const sleep=ms=>new Promise(r=>setTimeout(r,ms));
   async function wait(fn){for(let i=0;i<80;i++){const v=fn();if(v)return v;await sleep(250);}throw Error('ДТЭК не предоставил данные: защита сайта, сеть или изменение страницы');}
   const mode=()=>DtekCore.mode([...document.querySelectorAll('.m-attention__container, #showCurOutage.active, #discon-fact .discon-fact-table.active .discon-info-message')].map(e=>e.textContent));
   const emergency=()=>['emergency','suspended'].includes(mode().mode);
   const invalid=()=>({...mode(),scope:'region',status:mode().mode==='emergency'?'⚠️ ДТЭК сообщает об экстренных отключениях':'⚠️ ДТЭК сообщает, что график не действует'});
   await wait(()=>document.querySelector('#discon_form')||emergency());
   if(emergency())return invalid();
   async function choose(field,value){
    const input=await wait(()=>{const e=document.querySelector('#'+field);return e&&!e.disabled?e:null;});
    input.focus();input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));
    const option=await wait(()=>[...document.querySelectorAll('#'+field+'autocomplete-list > div')].find(e=>DtekCore.normalize(e.querySelector('input')?.value||e.textContent)===DtekCore.normalize(value)));
    input.blur();option.click();await wait(()=>DtekCore.normalize(input.value)===DtekCore.normalize(value));
   }
   const expected={...(a.city?{city:a.city}:{}),street:a.street,house_num:a.house};
   for(const [key,value] of Object.entries(expected))await choose(key,value);
   function verify(){for(const [key,value] of Object.entries(expected))if(DtekCore.normalize(document.querySelector('#'+key)?.value||'')!==DtekCore.normalize(value))throw Error('ДТЭК сбросил поле адреса');}
   verify();
   const block=await wait(()=>{if(emergency())return {emergency:true};const e=document.querySelector('#discon-fact .discon-fact-table.active');return e&&e.querySelectorAll('td[class^="cell-"]').length===24?e:null;});
   if(block.emergency)return invalid();
   verify();
   const cells=[...block.querySelectorAll('td[class^="cell-"]')].map(e=>[...e.classList].find(c=>c.startsWith('cell-')));
   const date=document.querySelector('#discon-fact .date.active [rel="date"]')?.textContent.trim();
   const status=DtekCore.status(cells,date);
   if(['Нет актуального графика','Неизвестный статус графика'].includes(status))throw Error(status);
   return {...mode(),cells,date,status,updated:block.querySelector('.update')?.textContent};
  },address);
  return {...base,...data,checked:new Date().toISOString()};
 }catch{return {...base,status:'Данные недоступны',error:'ДТЭК не предоставил актуальные данные. Проверка продолжится.',checked:new Date().toISOString()};}
 finally{await context.close();}
}
module.exports={collect};

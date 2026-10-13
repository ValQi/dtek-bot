function format(r){
 if(['emergency','suspended'].includes(r.mode))return r.label+'\n'+(r.mode==='emergency'?'⚠️ ДТЭК сообщает об экстренных отключениях.':'⚠️ ДТЭК сообщает, что график не действует.')+'\nОбычный график сейчас не используется для прогноза.\nНаличие света по этому адресу и время восстановления неизвестны.'+(r.unconfirmed?'\nОтмена ранее объявленного режима пока не подтверждена.':'')+'\n'+(r.scope==='region'?'Объявление относится к региону обслуживания ДТЭК.\n':'')+'Проверено: '+new Date(r.checked).toLocaleString('ru-RU',{timeZone:'Europe/Kyiv'});
 let text=(r.resumed?'✅ ДТЭК сообщил о возвращении к графикам.\n':'')+r.label+'\n'+r.status;
 if(r.error)text+='\n'+r.error;
 else{
  const ranges=[];let start=null;const time=n=>String(Math.floor(n/2)).padStart(2,'0')+':'+(n%2?'30':'00');
  for(let i=0;i<=48;i++){const c=r.cells?.[Math.floor(i/2)];const off=i<48&&(c==='cell-scheduled'||c==='cell-first-half'&&i%2===0||c==='cell-second-half'&&i%2===1);if(off&&start===null)start=i;if(!off&&start!==null){ranges.push(`С ${time(start)} до ${time(i)} свет не предусмотрен.`);start=null;}}
  text+=`\nГрафик ДТЭК на ${r.date}:\n${ranges.length?ranges.join('\n'):'По графику свет предусмотрен весь день.'}\nОбновлено ДТЭК: ${r.updated||'не указано'}\nПо данным ДТЭК; фактическое наличие света может отличаться.`;
 }
 return text+'\nПроверено: '+new Date(r.checked).toLocaleString('ru-RU',{timeZone:'Europe/Kyiv'});
}
module.exports=format;

const DtekCore = {
  normalize: s => s.replace(/\s+/g, '').toLowerCase(),
  mode: texts => {
    const clauses=texts.flatMap(text=>String(text).toLowerCase().replace(/\s+/g,' ').split(/[.!?\n]+/)).map(s=>s.trim()).filter(Boolean);
    let normal=false;
    for(const s of clauses){
      if(/якщо|если|імовірно|вероятно|можлив|можуть|могут|уникнути|избежать|(?:^|\s)або(?:\s|$)|(?:^|\s)или(?:\s|$)/.test(s))continue;
      if(/(?:екстрен|экстрен|аварійн|аварийн).{0,50}(?:скасован|скасовано|припинен|отменен|отменён|отменены)/.test(s)){normal=true;continue;}
      const active=/(?:діють|діє|введено|введені|застосовуються|застосовано|тривають|запроваджено|действуют|введены|применяются).{0,90}(?:екстрен|экстрен|аварійн|аварийн).{0,35}(?:відключ|отключ)/.test(s)||/(?:екстрен|экстрен|аварійн|аварийн).{0,35}(?:відключ|отключ).{0,60}(?:діють|введено|застосовуються|запроваджен|действуют|введены)/.test(s);
      if(active||/^(?:екстрені|экстренные|аварійні|аварийные) (?:відключення|отключения)$/.test(s))return {mode:'emergency',notice:s};
      if(/(?:графік|график).{0,70}(?:не діють|не діє|не застосовуються|не застосовується|не действуют|недійсн|недействител|скасован)/.test(s))return {mode:'suspended',notice:s};
      if(/(?:діють|застосовуються|повертаємось до|повертаємося до|повернулися до|действуют|возвращаемся к).{0,80}(?:стабілізаційн|стабилизацион|графік|график)/.test(s)||/(?:графік|график).{0,50}(?:відновлено|знову діють|действуют снова)/.test(s))normal=true;
    }
    return {mode:normal?'schedule':'unknown'};
  },
  clock: (date = new Date()) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Kyiv', day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
    return {date:`${p.day}.${p.month}.${p.year}`, hour:Number(p.hour), minute:Number(p.minute)};
  },
  status: (cells, date, now = new Date()) => {
    const t = DtekCore.clock(now);
    if (date !== t.date || cells.length !== 24) return 'Нет актуального графика';
    const c = cells[t.hour];
    if (!['cell-scheduled','cell-non-scheduled','cell-first-half','cell-second-half'].includes(c)) return 'Неизвестный статус графика';
    const off = c === 'cell-scheduled' || c === 'cell-first-half' && t.minute < 30 || c === 'cell-second-half' && t.minute >= 30;
    return off ? 'По графику — отключение' : 'По графику — свет предусмотрен';
  }
};
if (typeof module !== 'undefined') module.exports = DtekCore;

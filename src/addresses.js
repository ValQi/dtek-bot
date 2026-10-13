const allowed=new Set(['www.dtek-kem.com.ua','www.dtek-krem.com.ua']);
const addresses=JSON.parse(process.env.DTEK_ADDRESSES_JSON||'[]');
if(!Array.isArray(addresses)||!addresses.length||addresses.length>10)throw Error('Configure DTEK_ADDRESSES_JSON');
const ids=new Set();
for(const a of addresses){
 if(!a||!['id','label','street','house','url'].every(k=>typeof a[k]==='string'&&a[k].length&&a[k].length<300)||!/^\w+$/.test(a.id)||ids.has(a.id))throw Error('Invalid address configuration');
 const u=new URL(a.url);if(u.protocol!=='https:'||!allowed.has(u.hostname)||u.username||u.password||u.port)throw Error('Invalid DTEK host');ids.add(a.id);
}
module.exports=addresses;

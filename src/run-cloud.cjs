const {collect}=require('./collector.cjs'),addresses=require('./addresses.js');
async function main(){
 const target=process.env.WORKER_URL,secret=process.env.WORKER_SECRET;
 if(!target||!secret||!target.startsWith('https://'))throw Error('Configure Worker Secrets');
 const browser=await require('playwright').chromium.launch({headless:true});let failed=false;
 try{
  for(let i=0;i<addresses.length;i+=2){
   const results=await Promise.all(addresses.slice(i,i+2).map(a=>collect(browser,a)));
   const response=await fetch(new URL('/results',target),{method:'POST',headers:{'Content-Type':'application/json','X-Worker-Key':secret},body:JSON.stringify({results}),signal:AbortSignal.timeout(60000)});
   if(!response.ok)throw Error('Worker delivery failed');
   if(results.some(r=>r.error))failed=true;
  }
 }finally{await browser.close();}
 if(failed)throw Error('Some DTEK checks failed');
 console.log('DTEK results delivered to Worker.');
}
if(require.main===module)main().catch(()=>{console.error('DTEK cloud check failed. No credentials logged.');process.exitCode=1;});
module.exports={main};
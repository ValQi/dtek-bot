const crypto=require('node:crypto');
function key(value){const k=Buffer.from(value||'','base64');if(k.length!==32)throw Error('STATE_KEY must be 32 random bytes in base64');return k;}
function seal(data,k){const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',k,nonce);const body=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);return JSON.stringify({v:1,nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),body:body.toString('base64')});}
function open(raw,k){const data=JSON.parse(raw);if(data.v!==1)throw Error('Unknown state version');const decipher=crypto.createDecipheriv('aes-256-gcm',k,Buffer.from(data.nonce,'base64'));decipher.setAuthTag(Buffer.from(data.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.body,'base64')),decipher.final()]).toString('utf8'));}
class StateStore{
 constructor(){this.repo=process.env.GITHUB_REPOSITORY;this.token=process.env.GITHUB_TOKEN;this.key=key(process.env.STATE_KEY);this.sha=null;}
 async api(path,method='GET',body){const r=await fetch('https://api.github.com/repos/'+this.repo+'/'+path,{method,headers:{Authorization:'Bearer '+this.token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});if(r.status===404)return null;if(!r.ok)throw Error('GitHub state storage failed ('+r.status+')');return r.json();}
 async load(){
  const ref=await this.api('git/ref/heads/bot-state');
  if(!ref){const main=await this.api('git/ref/heads/'+encodeURIComponent(process.env.GITHUB_DEFAULT_BRANCH||'main'));if(!main)throw Error('Default branch missing');await this.api('git/refs','POST',{ref:'refs/heads/bot-state',sha:main.object.sha});}
  const file=await this.api('contents/bot.enc?ref=bot-state');if(!file)return null;
  this.sha=file.sha;return open(Buffer.from(file.content,'base64').toString('utf8'),this.key);
 }
 async save(state){const r=await this.api('contents/bot.enc','PUT',{message:'Save encrypted bot state',branch:'bot-state',content:Buffer.from(seal(state,this.key)).toString('base64'),...(this.sha?{sha:this.sha}:{})});if(!r)throw Error('State write rejected');this.sha=r.content.sha;}
}
module.exports={key,seal,open,StateStore};

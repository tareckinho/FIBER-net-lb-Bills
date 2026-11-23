'use strict';
const fs=require('node:fs'),path=require('node:path');
const FILE='accounting-bandwidth-baseline.json',FORMAT='FIBERNETLB-ACCOUNTING-BANDWIDTH-BASELINE-1',MAX_BYTES=4*1024*1024,MAX_PURCHASES=20000;
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function validateBaseline(value){
 if(value==null)return null;
 const fields=['format','year','sourceSha256','cutoverAt','purchases'];
 if(!plain(value)||Reflect.ownKeys(value).length!==fields.length||Reflect.ownKeys(value).some(k=>typeof k!=='string'||!fields.includes(k))||fields.some(k=>!Object.hasOwn(value,k))||value.format!==FORMAT||!Number.isInteger(value.year)||value.year<2000||value.year>2099||typeof value.sourceSha256!=='string'||!/^[a-f0-9]{64}$/i.test(value.sourceSha256)||typeof value.cutoverAt!=='string'||!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.cutoverAt)||!Number.isFinite(Date.parse(value.cutoverAt))||new Date(value.cutoverAt).toISOString()!==value.cutoverAt||!Array.isArray(value.purchases)||value.purchases.length>MAX_PURCHASES)throw Error('Choose a valid private future-purchase baseline.');
 const seen=new Set(),purchases=[];
 for(const p of value.purchases){if(!plain(p)||Reflect.ownKeys(p).length!==2||!Object.hasOwn(p,'requestId')||!Object.hasOwn(p,'fingerprint')||typeof p.requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(p.requestId)||typeof p.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(p.fingerprint)||seen.has(p.requestId))throw Error('The future-purchase baseline contains an invalid or repeated receipt.');seen.add(p.requestId);purchases.push(Object.freeze({requestId:p.requestId,fingerprint:p.fingerprint}));}
 return Object.freeze({format:FORMAT,year:value.year,sourceSha256:value.sourceSha256.toLowerCase(),cutoverAt:value.cutoverAt,purchases:Object.freeze(purchases)});
}
function readBaseline(file){
 if(typeof file!=='string'||!path.isAbsolute(file))throw Error('The private future-purchase baseline requires an absolute path.');
 let before;try{before=fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')return null;throw Error('The private future-purchase baseline could not be read.');}
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>MAX_BYTES)throw Error('The private future-purchase baseline must be a bounded regular file without links.');
 let fd;
 try{fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const opened=fs.fstatSync(fd);if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino||opened.size>MAX_BYTES)throw Error('changed');const bytes=Buffer.alloc(MAX_BYTES+1);let length=0,count;do{count=fs.readSync(fd,bytes,length,bytes.length-length,null);length+=count;}while(count&&length<bytes.length);const after=fs.fstatSync(fd);if(length>MAX_BYTES||length!==opened.size||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs)throw Error('changed');const parsed=JSON.parse(bytes.subarray(0,length).toString('utf8').replace(/^\uFEFF/,''));if(parsed===null)throw Error('shape');return validateBaseline(parsed);}catch{throw Error('The private future-purchase baseline is invalid or could not be read.');}finally{if(fd!==undefined)fs.closeSync(fd);}
}
module.exports={FILE,FORMAT,MAX_BYTES,MAX_PURCHASES,validateBaseline,readBaseline};

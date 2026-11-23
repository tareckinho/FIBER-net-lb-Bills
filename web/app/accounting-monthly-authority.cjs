'use strict';
const fs=require('node:fs'),path=require('node:path');
const FILE='accounting-monthly-authority.json',FORMAT='FIBERNETLB-ACCOUNTING-MONTHLY-AUTHORITY-1',MAX_BYTES=64*1024;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function validateAuthority(value){
 if(value==null)return null;
 const fields=['format','year','sourceSha256','mode','activatedAt','resellerAddedBasis','resellerPaymentBasis'];
 if(!plain(value)||Reflect.ownKeys(value).length!==fields.length||Reflect.ownKeys(value).some(key=>typeof key!=='string'||!fields.includes(key))||fields.some(key=>!Object.hasOwn(value,key))||value.format!==FORMAT||!Number.isInteger(value.year)||value.year<2000||value.year>2099||typeof value.sourceSha256!=='string'||!/^[a-f0-9]{64}$/i.test(value.sourceSha256)||!['program_months','program_only'].includes(value.mode)||value.resellerAddedBasis!=='net_credit'||value.resellerPaymentBasis!=='admin_paybill'||typeof value.activatedAt!=='string'||!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.activatedAt)||!Number.isFinite(Date.parse(value.activatedAt))||new Date(value.activatedAt).toISOString()!==value.activatedAt)throw Error('Choose a valid private monthly accounting authority profile.');
 return Object.freeze({format:FORMAT,year:value.year,sourceSha256:value.sourceSha256.toLowerCase(),mode:value.mode,activatedAt:value.activatedAt,resellerAddedBasis:'net_credit',resellerPaymentBasis:'admin_paybill'});
}
const regular=stat=>stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1n&&stat.size<=BigInt(MAX_BYTES);
const unchanged=(first,last)=>regular(last)&&first.dev===last.dev&&first.ino===last.ino&&first.size===last.size&&first.mtimeNs===last.mtimeNs&&first.ctimeNs===last.ctimeNs;
function readAuthority(file){
 if(typeof file!=='string'||!path.isAbsolute(file))throw Error('The private monthly accounting authority profile requires an absolute path.');
 let before;try{before=fs.lstatSync(file,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw Error('The private monthly accounting authority profile could not be read.');}
 if(!regular(before))throw Error('The private monthly accounting authority profile must be a bounded regular file without links.');
 let descriptor;
 try{
  descriptor=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const opened=fs.fstatSync(descriptor,{bigint:true});
  if(!unchanged(before,opened))throw Error('changed');
  const bytes=Buffer.alloc(MAX_BYTES+1);let length=0,count;
  do{count=fs.readSync(descriptor,bytes,length,bytes.length-length,null);length+=count;}while(count&&length<bytes.length);
  const after=fs.fstatSync(descriptor,{bigint:true}),current=fs.lstatSync(file,{bigint:true});
  if(length>MAX_BYTES||length!==Number(opened.size)||!unchanged(opened,after)||!unchanged(opened,current))throw Error('changed');
  const parsed=JSON.parse(bytes.subarray(0,length).toString('utf8').replace(/^\uFEFF/,''));if(parsed===null)throw Error('shape');return validateAuthority(parsed);
 }catch{throw Error('The private monthly accounting authority profile is invalid or could not be read.');}finally{if(descriptor!==undefined)fs.closeSync(descriptor);}
}
module.exports={FILE,FORMAT,MAX_BYTES,validateAuthority,readAuthority};

'use strict';
const crypto=require('node:crypto');

// Only pure calculation results belong here. Callers must freshly authorize and
// verify every source before consulting this per-backend, single-entry cache.
function fingerprint(inputs){
 const hash=crypto.createHash('sha256'),parents=new Set();let chunks=[],characters=0;
 function emit(text){chunks.push(text);characters+=text.length;if(characters>=65536){hash.update(chunks.join(''));chunks=[];characters=0;}}
 function visit(value){
  if(value===null){emit('null;');return;}
  const type=typeof value;
  if(type==='undefined'){emit('undefined;');return;}
  if(type==='string'){emit('string:'+JSON.stringify(value)+';');return;}
  if(type==='number'){emit('number:'+(Object.is(value,-0)?'-0':String(value))+';');return;}
  if(type==='boolean'){emit(value?'true;':'false;');return;}
  if(type!=='object'||(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))||Object.getOwnPropertySymbols(value).length||parents.has(value))throw Error('Accounting cache inputs must be acyclic plain data.');
  parents.add(value);emit(Array.isArray(value)?'array{':'object{');
  for(const key of Object.getOwnPropertyNames(value).sort()){
   const property=Object.getOwnPropertyDescriptor(value,key);
   if(!Object.hasOwn(property,'value'))throw Error('Accounting cache inputs cannot contain accessors.');
   emit((property.enumerable?'enumerable:':'hidden:')+JSON.stringify(key)+':');visit(property.value);
  }
  emit('};');parents.delete(value);
 }
 visit(inputs);if(chunks.length)hash.update(chunks.join(''));return hash.digest('hex');
}
function freeze(value,seen=new Set()){
 if(value===null||typeof value!=='object'||seen.has(value))return value;
 seen.add(value);for(const item of Object.values(value))freeze(item,seen);return Object.freeze(value);
}
class ProjectionCache{
 #entry=null;
 get(inputs,calculate){
  if(typeof calculate!=='function')throw Error('A pure Accounting calculation is required.');
  const key=fingerprint(inputs);
  if(this.#entry?.key===key)return this.#entry.value;
  const result=calculate();
  if(!result||typeof result!=='object'||typeof result.then==='function')throw Error('Accounting projections must complete synchronously.');
  if(fingerprint(inputs)!==key)throw Error('Accounting projection inputs changed during calculation.');
  // Clone before freezing: pure projections share original cells and styles,
  // while neither their inputs nor an API caller may own our cached copy.
  const value=freeze(structuredClone(result));
  this.#entry={key,value};return value;
 }
}
module.exports={ProjectionCache};

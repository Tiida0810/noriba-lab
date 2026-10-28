(function(global){
  'use strict';
  function model(){if(!global.FieldStopCatalog)throw Error('停留所一覧の部品を読み込めません。');return global.FieldStopCatalog;}
  function empty(){return {schemaVersion:1,revision:0,catalog:null};}
  function validateState(raw){if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['schemaVersion','revision','catalog'].includes(k))||raw.schemaVersion!==1||!Number.isSafeInteger(raw.revision)||raw.revision<0)throw Error('保存した停留所一覧の形式を確認してください。');return {schemaVersion:1,revision:raw.revision,catalog:raw.catalog===null?null:model().validate(raw.catalog)};}
  function create(options={}){
    const factory=options.indexedDB===undefined?global.indexedDB:options.indexedDB,name=options.name===undefined?'field-stop-catalog-1':options.name;
    if(typeof name!=='string'||!name.trim()||name.length>120||['field-capture-1','mp-field-registry-1'].includes(name))throw Error('停留所一覧専用の保存先を指定してください。');
    let opening=null,db=null;
    function open(){if(db)return Promise.resolve(db);if(opening)return opening;opening=new Promise((resolve,reject)=>{
      if(!factory||typeof factory.open!=='function'){reject(Error('この環境では停留所一覧を端末保存できません。'));return;}
      let request,settled=false;const fail=message=>{if(settled)return;settled=true;reject(Error(message));};
      try{request=factory.open(name,1);}catch(error){fail('停留所一覧の保存先を開けません。');return;}
      request.onupgradeneeded=()=>{try{if(!request.result.objectStoreNames.contains('catalogs'))request.result.createObjectStore('catalogs');}catch(error){fail('停留所一覧の保存先を準備できません。');}};
      request.onerror=()=>fail('停留所一覧の保存先を開けません。');request.onblocked=()=>fail('別の画面が一覧の保存先を使用しています。画面を閉じて再試行してください。');
      request.onsuccess=()=>{if(settled){request.result.close();return;}settled=true;db=request.result;db.onversionchange=()=>{db.close();db=null;opening=null;};resolve(db);};
    }).catch(error=>{opening=null;throw error;});return opening;}
    async function load(){const db=await open();return new Promise((resolve,reject)=>{let tx,result;try{tx=db.transaction('catalogs','readonly');const request=tx.objectStore('catalogs').get('main');request.onsuccess=()=>{try{result=request.result===undefined?empty():validateState(request.result);}catch(error){reject(error);}};request.onerror=()=>reject(Error('保存した停留所一覧を読めません。'));tx.oncomplete=()=>{if(result!==undefined)resolve(result);};tx.onerror=tx.onabort=()=>reject(Error('保存した停留所一覧を読めません。'));}catch(error){reject(Error('保存した停留所一覧を読めません。'));}});}
    async function save(catalog,options={}){
      const value=model().validate(catalog),expected=options.expectedRevision;if(!Number.isSafeInteger(expected)||expected<0)throw Error('一覧の更新番号を確認してください。');const db=await open();
      return new Promise((resolve,reject)=>{let tx,next;const fail=error=>{try{if(tx)tx.abort();}catch(ignore){}reject(error);};try{
        tx=db.transaction('catalogs','readwrite');const items=tx.objectStore('catalogs'),request=items.get('main');request.onsuccess=()=>{try{const current=request.result===undefined?empty():validateState(request.result);if(current.revision!==expected){const error=Error('別の画面で停留所一覧が変わりました。一覧を読み直してから再度選んでください。');error.name='StopCatalogConflictError';throw error;}if(current.catalog&&model().stringify(current.catalog)===model().stringify(value)){next=current;return;}if(current.revision===Number.MAX_SAFE_INTEGER)throw Error('一覧の更新回数の上限です。別の保存先を使ってください。');next={schemaVersion:1,revision:current.revision+1,catalog:value};items.put(next,'main');}catch(error){fail(error);}};request.onerror=()=>fail(Error('一覧の更新番号を確認できません。'));tx.oncomplete=()=>next?resolve(validateState(next)):reject(Error('停留所一覧を保存できません。'));tx.onerror=tx.onabort=()=>reject(Error('端末の容量・設定により停留所一覧を保存できません。'));
      }catch(error){fail(Error('停留所一覧を端末へ保存できません。'));}});
    }
    return Object.freeze({open,load,save});
  }
  const api=Object.freeze({version:'1.0.0',empty,validateState,create});global.FieldStopCatalogStore=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

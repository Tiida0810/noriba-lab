(function(global){
  'use strict';
  function model(){if(!global.FieldCaptureModel)throw Error('現地メモの保存部品を読み込めません。');return global.FieldCaptureModel;}
  function create(options={}){
    const factory=options.indexedDB===undefined?global.indexedDB:options.indexedDB,name=options.name===undefined?'field-capture-1':options.name;
    if(typeof name!=='string'||!name.trim()||name.length>120||name==='mp-field-registry-1')throw Error('現地メモ専用の保存先を指定してください。');
    let opening=null,db=null;
    function open(){if(db)return Promise.resolve(db);if(opening)return opening;opening=new Promise((resolve,reject)=>{
      if(!factory||typeof factory.open!=='function'){reject(Error('この環境では端末保存を使えません。現地メモをJSON保存してください。'));return;}
      let request,settled=false;const fail=message=>{if(settled)return;settled=true;reject(Error(message));};
      try{request=factory.open(name,1);}catch(e){fail('端末の保存先を開けません。JSONで控えを保存してください。');return;}
      request.onupgradeneeded=()=>{try{if(!request.result.objectStoreNames.contains('collections'))request.result.createObjectStore('collections');}catch(e){fail('端末の保存先を準備できません。');}};
      request.onerror=()=>fail('端末の保存先を開けません。JSONで控えを保存してください。');request.onblocked=()=>fail('別の画面が保存先を使用しています。画面を閉じて再試行してください。');
      request.onsuccess=()=>{if(settled){request.result.close();return;}settled=true;db=request.result;db.onversionchange=()=>{db.close();db=null;opening=null;};resolve(db);};
    }).catch(e=>{opening=null;throw e;});return opening;}
    async function load(){const store=await open();return new Promise((resolve,reject)=>{let tx,result;try{tx=store.transaction('collections','readonly');const request=tx.objectStore('collections').get('main');request.onsuccess=()=>{try{result=request.result===undefined?model().empty():model().validateBundle(request.result);}catch(e){reject(e);}};request.onerror=()=>reject(Error('保存した現地メモを読めません。JSONの控えを開いてください。'));tx.oncomplete=()=>{if(result!==undefined)resolve(result);};tx.onerror=tx.onabort=()=>reject(Error('保存した現地メモを読めません。JSONの控えを開いてください。'));}catch(e){reject(Error('端末の保存先を読めません。JSONの控えを開いてください。'));}});}
    async function save(bundle,options={}){
      const next=model().validateBundle(bundle),expected=options.expectedRevision;if(!Number.isSafeInteger(expected)||expected<0)throw Error('保存前の更新番号を確認してください。');
      const store=await open();return new Promise((resolve,reject)=>{let tx,accepted=false;const fail=error=>{try{if(tx)tx.abort();}catch(e){}reject(error);};
        try{tx=store.transaction('collections','readwrite');const items=tx.objectStore('collections'),request=items.get('main');request.onsuccess=()=>{try{const current=request.result===undefined?model().empty():model().validateBundle(request.result);if(current.revision!==expected){const error=Error('別の画面で現地メモが更新されました。JSONで控えを保存し、読み直してください。');error.name='CaptureConflictError';fail(error);return;}if(next.revision<expected||next.revision===expected&&model().stringify(next)!==model().stringify(current))throw Error('保存する現地メモの更新番号が古くなっています。');if(next.revision!==current.revision)items.put(next,'main');accepted=true;}catch(e){fail(e);}};request.onerror=()=>fail(Error('保存済みの更新番号を確認できません。JSONで控えを保存してください。'));tx.oncomplete=()=>accepted?resolve(model().validateBundle(next)):reject(Error('現地メモを保存できませんでした。'));tx.onerror=tx.onabort=()=>reject(Error('端末の容量・設定により保存できません。JSONで控えを保存してください。'));}catch(e){fail(Error('端末へ保存できません。JSONで控えを保存してください。'));}
      });
    }
    return Object.freeze({open,load,save});
  }
  const api=Object.freeze({version:'1.0.0',create});global.FieldCaptureStore=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

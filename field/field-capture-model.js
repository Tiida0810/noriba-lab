(function(global){
  'use strict';
  const FORMAT='noriba-field-capture',FIELDS=['municipality','service','mpId','name','lat','lon','elevationM','address','observedAt','coordinateBasis','confirmation','notes','photo','additionalPhotos','video'];
  const LIMITS=Object.freeze({entries:500,photosPerEntry:6,bundleBytes:64*1024*1024});
  const copy=x=>JSON.parse(JSON.stringify(x));
  function core(){if(!global.MPFieldRegistry)throw Error('写真台帳の検証部品を読み込めません。');return global.MPFieldRegistry;}
  function object(x,label){if(!x||typeof x!=='object'||Array.isArray(x))throw Error(label+'の形式を確認してください。');}
  function keys(x,allowed,label){if(Object.keys(x).some(k=>!allowed.includes(k)))throw Error(label+'に未対応の項目があります。');}
  function bytes(s){if(global.TextEncoder)return new global.TextEncoder().encode(s).length;let n=0;for(const c of s){const p=c.codePointAt(0);n+=p<128?1:p<2048?2:p<65536?3:4;}return n;}
  function timestamp(value){if(typeof value!=='string'||!value)throw Error('記録の日時を確認してください。');return core().validateWorkspace({schemaVersion:2,records:[],updatedAt:value}).updatedAt;}
  function identifier(id){if(typeof id!=='string'||!id||id.length>120||/[\u0000-\u0020\u007f]/.test(id))throw Error('現地メモの識別番号を確認してください。');return id;}
  function photos(f){return (f.photo?[f.photo]:[]).concat(f.additionalPhotos||[]);}
  function fields(raw,complete){
    object(raw,'入力内容');keys(raw,FIELDS,'入力内容');
    const blank={},input={...raw};
    for(const k of ['municipality','service','mpId','name']){blank[k]=raw[k]==null||typeof raw[k]==='string'&&!raw[k].trim();if(blank[k])input[k]='下書き';}
    if(raw.confirmation!==undefined&&!['unconfirmed','field'].includes(raw.confirmation))throw Error('確認状況は未確認・現地で確認から選んでください。');
    const normalized=core().normalizeRecord(input),out={};
    for(const k of FIELDS)out[k]=normalized[k];
    for(const k of Object.keys(blank))if(blank[k])out[k]='';
    if(complete&&Object.values(blank).some(Boolean))throw Error('本登録には自治体・サービス・MP番号・乗り場名を入力してください。');
    if(photos(out).length>LIMITS.photosPerEntry)throw Error('現地メモの写真は1件6枚までです。');
    if(photos(out).some(p=>!p.url.startsWith('data:')))throw Error('現地メモの写真は端末から選んだ添付データで保存してください。');
    if(!out.notes&&!photos(out).length)throw Error('写真または観察メモを入れてから保存してください。');
    return out;
  }
  function empty(){return {format:FORMAT,schemaVersion:1,revision:0,entries:[]};}
  function validateBundle(raw){
    object(raw,'現地メモ');keys(raw,['format','schemaVersion','revision','entries'],'現地メモ');
    if(raw.format!==FORMAT||raw.schemaVersion!==1||!Number.isSafeInteger(raw.revision)||raw.revision<0)throw Error('対応する現地メモファイルを選んでください。');
    if(!Array.isArray(raw.entries)||raw.entries.length>LIMITS.entries)throw Error('現地メモは500件までです。');
    const ids=new Set(),registeredKeys=new Set();
    const entries=raw.entries.map(e=>{
      object(e,'現地メモ');keys(e,['id','status','createdAt','updatedAt','registeredAt','fields'],'現地メモ');
      const id=identifier(e.id);if(ids.has(id))throw Error('現地メモの識別番号が重複しています。');ids.add(id);
      if(!['draft','registered'].includes(e.status))throw Error('仮登録・本登録の状態を確認してください。');
      const createdAt=timestamp(e.createdAt),updatedAt=timestamp(e.updatedAt),registeredAt=e.status==='registered'?timestamp(e.registeredAt):'';
      if(e.status==='draft'&&e.registeredAt!=null&&e.registeredAt!=='')throw Error('編集中の現地メモに本登録日時は残せません。');
      if(Date.parse(updatedAt)<Date.parse(createdAt)||registeredAt&&(Date.parse(registeredAt)<Date.parse(createdAt)||Date.parse(registeredAt)>Date.parse(updatedAt)))throw Error('現地メモの日時の順番を確認してください。');
      const normalized=fields(e.fields,e.status==='registered');
      if(e.status==='registered'){const key=core().keyOf(normalized);if(registeredKeys.has(key))throw Error('本登録の自治体・サービス・MP番号が重複しています。');registeredKeys.add(key);}
      return {id,status:e.status,createdAt,updatedAt,registeredAt,fields:normalized};
    });
    const out={format:FORMAT,schemaVersion:1,revision:raw.revision,entries};if(bytes(JSON.stringify(out))>LIMITS.bundleBytes)throw Error('現地メモファイルは写真を含め64MiBまでです。');return out;
  }
  function parse(text){if(typeof text!=='string'||bytes(text)>LIMITS.bundleBytes)throw Error('現地メモファイルは64MiB以内で選んでください。');let raw;try{raw=JSON.parse(text.replace(/^\uFEFF/,''));}catch(e){throw Error('現地メモのJSONを読めませんでした。');}return validateBundle(raw);}
  function stringify(bundle){return JSON.stringify(validateBundle(bundle));}
  function nextRevision(bundle){if(bundle.revision===Number.MAX_SAFE_INTEGER)throw Error('記録の更新回数の上限です。新しい現地メモへ分けてください。');bundle.revision++;return validateBundle(bundle);}
  function now(options){return timestamp(options&&options.now||new Date().toISOString());}
  function newId(bundle){let id;do{id='capture-'+(global.crypto&&global.crypto.randomUUID?global.crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));}while(bundle.entries.some(e=>e.id===id));return id;}
  function saveDraft(bundle,raw,options={}){
    const out=validateBundle(bundle),value=fields(raw,false),at=now(options),id=options.id===undefined?newId(out):identifier(options.id),index=out.entries.findIndex(e=>e.id===id);
    if(options.id!==undefined&&index<0)throw Error('編集する現地メモが見つかりません。');
    const before=index>=0?out.entries[index]:null;if(before&&Date.parse(at)<Date.parse(before.updatedAt))throw Error('前の記録より古い日時では保存できません。');
    if(before&&before.status==='draft'&&JSON.stringify(before.fields)===JSON.stringify(value))return out;
    const entry={id,status:'draft',createdAt:before?before.createdAt:at,updatedAt:at,registeredAt:'',fields:value};if(index<0)out.entries.push(entry);else out.entries[index]=entry;return nextRevision(out);
  }
  function register(bundle,id,options={}){
    if(options.reviewed!==true)throw Error('写真とメモを確認してから本登録してください。');
    const out=validateBundle(bundle),entry=out.entries.find(e=>e.id===identifier(id));if(!entry)throw Error('本登録する現地メモが見つかりません。');if(entry.status==='registered')return out;
    const at=now(options);if(Date.parse(at)<Date.parse(entry.updatedAt))throw Error('前の記録より古い日時では本登録できません。');entry.fields=fields(entry.fields,true);entry.status='registered';entry.registeredAt=at;entry.updatedAt=at;return nextRevision(out);
  }
  function reopen(bundle,id,options={}){
    const out=validateBundle(bundle),entry=out.entries.find(e=>e.id===identifier(id));if(!entry)throw Error('編集する現地メモが見つかりません。');if(entry.status==='draft')return out;
    const at=now(options);if(Date.parse(at)<Date.parse(entry.updatedAt))throw Error('前の記録より古い日時では編集を始められません。');entry.status='draft';entry.registeredAt='';entry.updatedAt=at;return nextRevision(out);
  }
  function toRegistry(bundle){const value=validateBundle(bundle),entries=value.entries.filter(e=>e.status==='registered');return core().validateWorkspace({schemaVersion:2,records:entries.map(e=>e.fields),updatedAt:entries.reduce((at,e)=>!at||Date.parse(e.updatedAt)>Date.parse(at)?e.updatedAt:at,'')});}
  function fingerprint(value){const s=JSON.stringify(value);let a=2166136261,b=2246822519;for(let i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b^s.charCodeAt(i),3266489917);}return s.length+':'+(a>>>0).toString(16)+':'+(b>>>0).toString(16);}
  const NOTE_SEPARATOR='【スマホの現地メモ】';
  function appendNotes(existing,incoming){if(!incoming||existing===incoming)return {value:existing,added:false};const section=NOTE_SEPARATOR+'\n'+incoming;if(existing===section||existing.endsWith('\n\n'+section)||existing.includes('\n\n'+section+'\n\n'+NOTE_SEPARATOR+'\n'))return {value:existing,added:false};return {value:existing?existing+'\n\n'+section:section,added:true};}
  function buildImport(workspace,bundle,options={}){
    const C=core(),base=C.validateWorkspace(workspace),value=validateBundle(bundle),mode=options.duplicateMode===undefined?'skip':options.duplicateMode;
    if(!['skip','append'].includes(mode))throw Error('重複時の扱いを選んでください。');
    let next=base;const importAt=new Date().toISOString(),rows=[],summary={registered:0,draftsIgnored:0,added:0,appended:0,skipped:0,photosAdded:0,notesAdded:0};
    for(const entry of value.entries){if(entry.status==='draft'){summary.draftsIgnored++;continue;}summary.registered++;const record=C.normalizeRecord(entry.fields),key=record.key,previous=next.records.find(r=>r.key===key);let row={id:entry.id,key,mpId:record.mpId,name:record.name,action:'skip',photosAdded:0,notesAdded:false,reason:''};
      if(!previous){next=C.upsert(next,record,{now:importAt});row={...row,action:'add',photosAdded:photos(record).length,notesAdded:!!record.notes,reason:'新しい番号として追加します。'};summary.added++;}
      else if(mode==='skip'){row.reason='同じ自治体・サービス・MP番号があるため、既存登録を保ちます。';summary.skipped++;}
      else{
        const gallery=photos(previous).map(copy);let added=0;
        for(const photo of photos(record)){const same=gallery.find(p=>p.url===photo.url);if(same){if(JSON.stringify(same.capturePosition||null)!==JSON.stringify(photo.capturePosition||null))throw Error('同じ写真の位置記録が異なります。写真を確認してから取り込んでください。');continue;}gallery.push(copy(photo));added++;}
        const note=appendNotes(previous.notes,record.notes);
        if(added||note.added){const raw={...previous,photo:gallery[0]||null,additionalPhotos:gallery.slice(1),notes:note.value};next=C.upsert(next,raw,{previousKey:key,now:importAt});row={...row,action:'append',photosAdded:added,notesAdded:note.added,reason:'写真と観察メモだけを追記します。既存の名称・座標・確認状況は保ちます。'};summary.appended++;}
        else{row.reason='この写真・メモは登録済みです。変更しません。';summary.skipped++;}
      }
      summary.photosAdded+=row.photosAdded;if(row.notesAdded)summary.notesAdded++;rows.push(row);
    }
    return {plan:{format:'noriba-field-capture-import',schemaVersion:1,duplicateMode:mode,workspaceFingerprint:fingerprint(base),bundleFingerprint:fingerprint(value),summary,rows},next};
  }
  function planImport(workspace,bundle,options={}){return buildImport(workspace,bundle,options).plan;}
  function applyImport(workspace,bundle,plan){object(plan,'取込プレビュー');const built=buildImport(workspace,bundle,{duplicateMode:plan.duplicateMode});if(JSON.stringify(plan)!==JSON.stringify(built.plan))throw Error('台帳か現地メモが変わりました。取込内容を確認し直してください。');return built.next;}
  const api=Object.freeze({version:'1.0.0',LIMITS,empty,validateBundle,parse,stringify,saveDraft,register,reopen,toRegistry,planImport,applyImport});global.FieldCaptureModel=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

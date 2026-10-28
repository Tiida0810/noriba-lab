(function(global){
  'use strict';
  const FORMAT='noriba-stop-catalog',LIMITS=Object.freeze({entries:10000,catalogBytes:8*1024*1024});
  const ENTRY_FIELDS=['municipality','service','mpId','name','lat','lon','elevationM','address'];
  const CAPTURE_FIELDS=['municipality','service','mpId','name','lat','lon','elevationM','address','observedAt','coordinateBasis','confirmation','notes','photo','additionalPhotos','video'];
  const REFERENCE_NOTICE='停留所一覧から選んだ参考情報。座標・標高・住所は現地で未照合です。';
  function core(){if(!global.MPFieldRegistry)throw Error('停留所一覧の検証部品を読み込めません。');return global.MPFieldRegistry;}
  function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.prototype.toString.call(value)!=='[object Object]')throw Error(label+'の形式を確認してください。');}
  function keys(value,allowed,label){if(Object.keys(value).some(key=>!allowed.includes(key)))throw Error(label+'に未対応の項目があります。写真や観察メモを含まない停留所一覧を選んでください。');}
  function bytes(text){if(global.TextEncoder)return new global.TextEncoder().encode(text).length;let size=0;for(const c of text){const n=c.codePointAt(0);size+=n<128?1:n<2048?2:n<65536?3:4;}return size;}
  function timestamp(value){if(typeof value!=='string'||!value)throw Error('停留所一覧の書出し日時を確認してください。');return core().validateWorkspace({schemaVersion:2,records:[],updatedAt:value}).updatedAt;}
  function now(options){return timestamp(options&&options.now!==undefined?options.now:new Date().toISOString());}
  function normalizeEntry(raw){
    object(raw,'停留所');keys(raw,ENTRY_FIELDS,'停留所');
    for(const key of ['municipality','service','mpId','name'])if(typeof raw[key]!=='string')throw Error('自治体・サービス・番号・名前は文字で指定してください。番号001と1は区別します。');
    for(const key of ['lat','lon','elevationM'])if(raw[key]!==undefined&&raw[key]!==null&&(typeof raw[key]!=='number'||!Number.isFinite(raw[key])))throw Error('参考位置と標高は有限の数値か未入力で指定してください。');
    if(raw.address!==undefined&&raw.address!==null&&typeof raw.address!=='string')throw Error('住所は文字で指定してください。');
    const normalized=core().normalizeRecord(raw),entry={};for(const key of ENTRY_FIELDS)entry[key]=normalized[key];return entry;
  }
  function keyOf(raw){return core().keyOf(normalizeEntry(raw));}
  function empty(options={}){return {format:FORMAT,schemaVersion:1,exportedAt:now(options),entries:[]};}
  function validate(raw){
    object(raw,'停留所一覧');keys(raw,['format','schemaVersion','exportedAt','entries'],'停留所一覧');
    if(raw.format!==FORMAT||raw.schemaVersion!==1)throw Error('対応する停留所一覧JSONを選んでください。現地メモとは別のファイルです。');
    if(!Array.isArray(raw.entries)||raw.entries.length>LIMITS.entries)throw Error('停留所一覧は10,000件までです。');
    for(let index=0;index<raw.entries.length;index++)if(!Object.prototype.hasOwnProperty.call(raw.entries,index))throw Error('停留所一覧に空の行があります。');
    const exportedAt=timestamp(raw.exportedAt),seen=new Set(),entries=raw.entries.map(row=>{const entry=normalizeEntry(row),key=core().keyOf(entry);if(seen.has(key))throw Error('同じ自治体・サービス・MP番号が重複しています。');seen.add(key);return entry;});
    const result={format:FORMAT,schemaVersion:1,exportedAt,entries};if(bytes(JSON.stringify(result))>LIMITS.catalogBytes)throw Error('停留所一覧JSONは8MiBまでです。自治体やサービスごとに分けてください。');return result;
  }
  function parse(text){
    if(typeof text!=='string'||bytes(text)>LIMITS.catalogBytes)throw Error('停留所一覧は8MiB以内のJSONで選んでください。');
    let value;try{value=JSON.parse(text.replace(/^\uFEFF/,''));}catch(error){throw Error('停留所一覧JSONを読めませんでした。PCから書き出した一覧を選んでください。');}return validate(value);
  }
  function stringify(catalog){return JSON.stringify(validate(catalog));}
  function fromRegistry(raw,options={}){
    const workspace=core().validateWorkspace(raw),catalog=empty(options);
    catalog.entries=workspace.records.filter((record,index)=>record.active!==false&&!record.archived&&raw.records[index].archived!==true).map(record=>{const entry={};for(const key of ENTRY_FIELDS)entry[key]=record[key];return entry;});
    return validate(catalog);
  }
  function localDay(at){const date=new Date(at),pad=n=>String(n).padStart(2,'0');return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate());}
  function createCaptureFields(raw,options={}){
    const entry=normalizeEntry(raw),at=now(options),record=core().normalizeRecord({...entry,observedAt:localDay(at),coordinateBasis:REFERENCE_NOTICE,confirmation:'unconfirmed',notes:'',photo:null,additionalPhotos:[],video:null}),fields={};
    for(const key of CAPTURE_FIELDS)fields[key]=record[key];return fields;
  }
  const api=Object.freeze({version:'1.0.0',FORMAT,LIMITS,REFERENCE_NOTICE,empty,validate,parse,stringify,fromRegistry,keyOf,createCaptureFields});
  global.FieldStopCatalog=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

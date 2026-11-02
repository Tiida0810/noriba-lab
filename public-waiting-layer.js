(function(global){
'use strict';
const BASE='https://noriba-public-waiting.berry-crown-1982.chatgpt.site';
const MAX_LIST_BYTES=2*1024*1024,MAX_DETAIL_BYTES=12*1024*1024,MAX_STOPS=5000;
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/,SVG='http://www.w3.org/2000/svg';
let api=null,ui=null,stops=[],enabled=true,lastDraw=null,loadToken=0,photoToken=0,photoAbort=null,photoRecord=null,photoStage=null,returnFocus=null,controlKey='',initializing=null;
const markers=new Map();
function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))throw Error(label+'の形式を確認してください。');return value;}
function text(value,label,max,required){if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(value)||required&&!value.trim())throw Error(label+'の形式を確認してください。');return value;}
function day(value){text(value,'撮影日',10,false);if(value==='')return '';if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error('撮影日を確認してください。');return value;}
function baseURL(raw){const url=new URL(raw);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('公開案内の接続先を確認してください。');return url.href.replace(/\/+$/,'');}
function summary(raw){
 object(raw,'公開案内');if(raw.schemaVersion!==undefined&&raw.schemaVersion!==1)throw Error('公開案内の形式に対応していません。');
 const id=text(raw.id,'乗り場番号',80,true);if(!ID.test(id))throw Error('乗り場番号を確認してください。');
 if(typeof raw.lat!=='number'||typeof raw.lon!=='number'||!Number.isFinite(raw.lat)||!Number.isFinite(raw.lon)||Math.abs(raw.lat)>90||Math.abs(raw.lon)>180)throw Error('参考位置を確認してください。');
 if(!['unconfirmed','recorded'].includes(raw.confirmation))throw Error('待つ範囲の確認状況を確認してください。');
 const publishedAt=text(raw.publishedAt,'公開日時',40,true);if(!Number.isFinite(Date.parse(publishedAt)))throw Error('公開日時を確認してください。');
 if(!Number.isSafeInteger(raw.revision)||raw.revision<1)throw Error('公開案内の版を確認してください。');
 return {schemaVersion:1,id,municipality:text(raw.municipality,'自治体',120,true),service:text(raw.service,'運行サービス',120,true),name:text(raw.name,'乗り場名',240,true),lat:raw.lat,lon:raw.lon,photoDate:day(raw.photoDate),landmark:text(raw.landmark,'目印',160,false),confirmation:raw.confirmation,publishedAt,revision:raw.revision,coordinateBasis:raw.coordinateBasis===undefined?'':text(raw.coordinateBasis,'位置の根拠',1000,false)};
}
function validateList(raw){object(raw,'公開案内一覧');if(raw.schemaVersion!==1||!Array.isArray(raw.stops)||raw.stops.length>MAX_STOPS)throw Error('公開案内一覧の形式を確認してください。');const ids=new Set();return raw.stops.map(value=>{const stop=summary(value);if(ids.has(stop.id))throw Error('公開案内の番号が重複しています。');ids.add(stop.id);return stop;});}
function cross(a,b,c){return(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
function on(a,b,p){return Math.abs(cross(a,b,p))<1e-9&&p.x>=Math.min(a.x,b.x)-1e-9&&p.x<=Math.max(a.x,b.x)+1e-9&&p.y>=Math.min(a.y,b.y)-1e-9&&p.y<=Math.max(a.y,b.y)+1e-9;}
function intersects(a,b,c,d){return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);}
function validPolygon(points){if(points.length<3||Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0))/2<.0002)return false;for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){if(j===i+1||i===0&&j===points.length-1)continue;if(intersects(points[i],points[(i+1)%points.length],points[j],points[(j+1)%points.length]))return false;}return true;}
function validateDetail(raw,expectedId){
 const result=summary(raw);if(result.id!==expectedId)throw Error('選んだ乗り場と公開案内が一致しません。');
 const p=object(raw.photo,'写真'),match=typeof p.dataUrl==='string'?p.dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/):null;
 if(!match||p.dataUrl.length>MAX_DETAIL_BYTES||match[2].length%4!==0||!Number.isInteger(p.width)||!Number.isInteger(p.height)||p.width<1||p.height<1||p.width>4096||p.height>4096)throw Error('公開写真の形式またはサイズを確認してください。');
 let bytes;try{bytes=global.atob(match[2]);}catch(_){throw Error('公開写真を読み込めません。');}
 const imageOK=match[1]==='jpeg'?bytes.startsWith('\xff\xd8\xff'):match[1]==='png'?bytes.startsWith('\x89PNG\r\n\x1a\n'):bytes.startsWith('RIFF')&&bytes.slice(8,12)==='WEBP';if(!imageOK)throw Error('公開写真の形式を確認してください。');
 const polygon=object(raw.polygon,'待つ範囲');if(polygon.closed!==true||polygon.space!=='normalized-photo'||!Array.isArray(polygon.points)||polygon.points.length>12||!polygon.points.every(q=>q&&typeof q==='object'&&Number.isFinite(q.x)&&Number.isFinite(q.y)&&q.x>=0&&q.x<=1&&q.y>=0&&q.y<=1)||!validPolygon(polygon.points))throw Error('公開された範囲の形を確認してください。');
 result.photo={dataUrl:p.dataUrl,width:p.width,height:p.height};result.polygon={space:'normalized-photo',closed:true,points:polygon.points.map(q=>({x:q.x,y:q.y}))};return result;
}
function el(tag,attrs,label){const node=global.document.createElement(tag);for(const [key,value]of Object.entries(attrs||{})){if(key==='class')node.className=value;else node.setAttribute(key,String(value));}if(label!==undefined)node.textContent=label;return node;}
function svg(tag,attrs){const node=global.document.createElementNS(SVG,tag);for(const [key,value]of Object.entries(attrs||{}))node.setAttribute(key,String(value));return node;}
function message(value,error){if(!ui)return;ui.status.textContent=value;ui.status.setAttribute('role',error?'alert':'status');}
async function readJSON(path,maxBytes,signal){
 const url=new URL(baseURL(BASE)+path);if(url.origin!==new URL(BASE).origin)throw Error('公開案内の接続先を確認してください。');
 const response=await global.fetch(url.href,{method:'GET',mode:'cors',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'},signal});
 if(!response.ok)throw Error(response.status===404?'この乗り場の公開案内はまだありません。':'公開案内を読み込めませんでした。少し待って再試行してください。');
 if(!response.headers.get('content-type')?.includes('application/json'))throw Error('公開案内の応答形式を確認してください。');
 const declared=Number(response.headers.get('content-length')||0);if(declared>maxBytes)throw Error('公開案内のデータが大きすぎます。');
 const reader=response.body&&response.body.getReader();let body;
 if(reader){const chunks=[];let total=0;while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes){await reader.cancel();throw Error('公開案内のデータが大きすぎます。');}chunks.push(value);}const all=new Uint8Array(total);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}body=new TextDecoder().decode(all);}
 else{body=await response.text();if(new TextEncoder().encode(body).byteLength>maxBytes)throw Error('公開案内のデータが大きすぎます。');}
 try{return JSON.parse(body);}catch(_){throw Error('公開案内を読み取れませんでした。');}
}
function currentRegion(){if(lastDraw&&lastDraw.region)return lastDraw.region;try{const r=api.getRegionSummary();return {key:r.key,label:r.label};}catch(_){return {key:'',label:''};}}
function inRegion(stop){const r=currentRegion();return stop.municipality===r.label||(r.key==='nakama'&&stop.municipality==='中間市');}
function controls(force){
 if(!ui)return;const region=currentRegion(),visible=stops.filter(inRegion),key=region.key+'|'+enabled+'|'+visible.map(s=>s.id+':'+s.revision).join(',');
 if(!force&&key===controlKey)return;controlKey=key;ui.list.replaceChildren();
 if(!visible.length){ui.count.textContent=region.label+'の公開案内はまだありません。';return;}
 ui.count.textContent=region.label+'の公開案内 '+visible.length+'件。赤枠の「公開案内」は配置案のMPと別の参考位置です。';
 for(const stop of visible.slice(0,100)){const button=el('button',{type:'button',class:'pwl-list-button'},stop.id+' '+stop.name+'の写真を見る');button.addEventListener('click',()=>show(stop.id,{focusMap:true,trigger:button}));ui.list.appendChild(button);}
 if(visible.length>100)ui.list.appendChild(el('p',{class:'pwl-note'},'一覧は先頭100件です。他の案内は地図の赤枠から開けます。'));
}
function draw(context){
 if(!ui)return;if(context)lastDraw={map:context.map,xy:context.xy,region:{key:context.region.key,label:context.region.label}};
 controls(false);const shown=new Set(),ctx=lastDraw;if(!ctx||!ctx.map||!ctx.xy||!enabled){for(const button of markers.values())button.hidden=true;return;}
 const canvas=global.document.getElementById('planner-map');if(!canvas||!canvas.parentElement)return;const parent=canvas.parentElement,box=canvas.getBoundingClientRect(),host=parent.getBoundingClientRect();ui.overlay.style.left=(box.left-host.left-parent.clientLeft)+'px';ui.overlay.style.top=(box.top-host.top-parent.clientTop)+'px';ui.overlay.style.width=box.width+'px';ui.overlay.style.height=box.height+'px';
 for(const stop of stops.filter(inRegion)){const point=ctx.xy({lon:stop.lon,lat:stop.lat});if(!Array.isArray(point)||!point.every(Number.isFinite)||point[0]<0||point[1]<0||point[0]>ctx.map.width||point[1]>ctx.map.height)continue;shown.add(stop.id);let button=markers.get(stop.id);
 if(!button){button=el('button',{type:'button',class:'pwl-marker','aria-label':'公開案内 '+stop.id+' '+stop.name+'の写真と待つ範囲の候補を見る'},'公開案内 '+stop.id);button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();show(stop.id,{trigger:button});});markers.set(stop.id,button);ui.overlay.appendChild(button);}
 button.hidden=false;button.style.left=point[0]+'px';button.style.top=point[1]+'px';}
 for(const [id,button]of markers)if(!shown.has(id))button.hidden=true;
}
function photoOverlay(){
 if(!photoRecord||!photoStage)return;const overlay=photoStage.querySelector('svg'),photo=photoRecord.photo,w=photo.width,h=photo.height,scale=w/Math.max(photoStage.clientWidth,1),spacing=12*scale;
 overlay.replaceChildren();overlay.setAttribute('viewBox','0 0 '+w+' '+h);const defs=svg('defs',{}),pattern=svg('pattern',{id:'pwl-red-hatch',patternUnits:'userSpaceOnUse',width:spacing,height:spacing,patternTransform:'rotate(45)'});pattern.appendChild(svg('path',{d:'M '+spacing/2+' 0 V '+spacing,fill:'none',stroke:'#dc2626','stroke-width':2*scale}));defs.appendChild(pattern);overlay.appendChild(defs);
 const points=photoRecord.polygon.points.map(p=>(p.x*w)+','+(p.y*h)).join(' ');overlay.appendChild(svg('polygon',{points,fill:'#dc2626','fill-opacity':'.18'}));overlay.appendChild(svg('polygon',{points,fill:'url(#pwl-red-hatch)',stroke:'#dc2626','stroke-width':3,'vector-effect':'non-scaling-stroke','stroke-linejoin':'round'}));
}
function close(){photoToken++;if(photoAbort)photoAbort.abort();photoAbort=null;photoRecord=null;photoStage=null;ui.content.replaceChildren();if(ui.dialog.open&&typeof ui.dialog.close==='function')ui.dialog.close();else ui.dialog.removeAttribute('open');ui.dialog.hidden=true;if(returnFocus&&returnFocus.isConnected)returnFocus.focus({preventScroll:true});}
async function reveal(stop){
 let summary;try{summary=api.getRegionSummary();}catch(_){return false;}
 if(summary.label!==stop.municipality&&!(summary.key==='nakama'&&stop.municipality==='中間市')){
 const select=global.document.getElementById('municipality-select'),option=select&&Array.from(select.options).find(o=>stop.municipality==='中間市'&&o.value==='nakama'||o.textContent.replace(/（[^）]*）$/,'')===stop.municipality);
 if(!option){message('この案内に対応する地域を地図で選べません。写真は開けます。',true);return false;}
 const result=await api.setRegion(option.value);if(result===false){message('入力中の内容を保存・確定してから、この地域の案内を開いてください。',true);return false;}
 summary=api.getRegionSummary();if(summary.key!==option.value){message('地域の切り替えを確認できませんでした。',true);return false;}
 }
 const focused=api.publicWaitingMap&&api.publicWaitingMap.focusReference(stop.lon,stop.lat);if(!focused)message('写真を開きました。参考位置は地図画面で確認できます。');return Boolean(focused);
}
async function show(id,options){
 const settings=options||{},stop=stops.find(s=>s.id===id);if(!stop){message('この番号の公開案内はまだありません。',true);return false;}
 if(settings.focusMap){try{await reveal(stop);}catch(_){message('地域を切り替えられませんでした。入力中の内容を確認してください。',true);}}
 enabled=true;ui.checkbox.checked=true;draw();returnFocus=settings.trigger||global.document.activeElement;photoToken++;const token=photoToken;if(photoAbort)photoAbort.abort();photoAbort=new AbortController();photoRecord=null;photoStage=null;
 ui.title.textContent=stop.id+' '+stop.name;ui.content.replaceChildren(el('p',{},'公開された写真と範囲を読み込んでいます…'));ui.dialog.hidden=false;if(!ui.dialog.open){if(typeof ui.dialog.showModal==='function')ui.dialog.showModal();else ui.dialog.setAttribute('open','');}
 try{const record=validateDetail(await readJSON('/api/stops/'+encodeURIComponent(id),MAX_DETAIL_BYTES,photoAbort.signal),id);if(token!==photoToken)return false;
 const image=el('img',{alt:record.id+' '+record.name+'の公開された現地写真'});await new Promise((resolve,reject)=>{image.onload=()=>image.naturalWidth===record.photo.width&&image.naturalHeight===record.photo.height?resolve():reject(Error('写真の大きさと範囲の記録が一致しません。'));image.onerror=()=>reject(Error('公開写真を表示できませんでした。'));image.src=record.photo.dataUrl;});if(token!==photoToken)return false;
 const index=stops.findIndex(s=>s.id===id);stops[index]=summary(record);photoRecord=record;photoStage=el('div',{class:'pwl-photo-stage'});photoStage.appendChild(image);photoStage.appendChild(svg('svg',{'aria-hidden':'true',preserveAspectRatio:'none'}));
 const status=el('p',{class:'pwl-status '+(record.confirmation==='unconfirmed'?'pwl-unconfirmed':'')},record.confirmation==='unconfirmed'?'待つ範囲の候補・未確認':'待つ範囲の確認記録あり（安全性の認証ではありません）');
 const note=el('p',{class:'pwl-note'},'赤い斜線は写真上の範囲です。地図の点は案内を開くための参考位置で、待機面の正確な位置を示すものではありません。');
 const detail=el('p',{},record.landmark||'目印は未記録です。'),date=el('p',{class:'pwl-note'},'撮影日：'+(record.photoDate||'未記録')+' ／ 公開日：'+new Date(record.publishedAt).toLocaleDateString('ja-JP'));
 ui.content.replaceChildren(status,photoStage,detail,date,note);if(record.coordinateBasis)ui.content.appendChild(el('p',{class:'pwl-note'},'参考位置の記録：'+record.coordinateBasis));
 global.requestAnimationFrame(photoOverlay);draw();return true;
 }catch(error){if(token!==photoToken||error.name==='AbortError')return false;const retry=el('button',{type:'button',class:'pwl-list-button'},'もう一度読み込む');retry.addEventListener('click',()=>show(id,{trigger:returnFocus}));ui.content.replaceChildren(el('p',{role:'alert'},error.message||'公開案内を読み込めませんでした。'),retry);return false;}
}
async function refresh(){
 const token=++loadToken;ui.refresh.disabled=true;message('公開された案内の一覧を読み込んでいます…');
 const controller=new AbortController(),timer=global.setTimeout(()=>controller.abort(),20000);
 try{const records=validateList(await readJSON('/api/stops',MAX_LIST_BYTES,controller.signal));if(token!==loadToken)return false;stops=records;controls(true);draw();message('公開された案内 '+stops.length+'件を読み込みました。');return true;}
 catch(error){if(token!==loadToken)return false;message(error.name==='AbortError'?'公開案内の取得が完了しませんでした。更新ボタンで再試行できます。':error.message||'公開案内を読み込めませんでした。',true);return false;}
 finally{global.clearTimeout(timer);if(token===loadToken)ui.refresh.disabled=false;}
}
function init(planner){
 if(initializing)return initializing;api=planner;const canvas=global.document.getElementById('planner-map');if(!canvas)return Promise.resolve(false);
 const panel=el('details',{class:'pwl-panel','aria-labelledby':'pwl-heading'}),heading=el('summary',{id:'pwl-heading'},'公開された待つ場所の案内'),row=el('div',{class:'pwl-toolbar'}),checkbox=el('input',{type:'checkbox'}),label=el('label',{}),refreshButton=el('button',{type:'button',class:'pwl-list-button'},'公開案内を更新'),status=el('p',{class:'pwl-note',role:'status'}),count=el('p',{class:'pwl-note'}),list=el('div',{class:'pwl-list'});
 checkbox.checked=true;label.append(checkbox,global.document.createTextNode('地図に公開案内を表示'));row.append(label,refreshButton);
 panel.append(heading,row,count,list,status,el('p',{class:'pwl-note'},'「候補・未確認」は、待ってよい範囲かを確認する前の案内です。配置案のMPや人口・道路の計算には加えません。写真は案内を選んだときに外部の公開サーバーから読み込みます。'));
 canvas.parentElement.insertAdjacentElement('beforebegin',panel);const overlay=el('div',{class:'pwl-map-overlay','aria-label':'公開された案内の参考位置'});canvas.parentElement.appendChild(overlay);
 const dialog=el('dialog',{class:'pwl-dialog','aria-labelledby':'pwl-dialog-title'}),title=el('h2',{id:'pwl-dialog-title'}),closeButton=el('button',{type:'button',class:'pwl-list-button'},'閉じる'),header=el('div',{class:'pwl-dialog-header'}),content=el('div',{class:'pwl-dialog-content'});header.append(title,closeButton);dialog.append(header,content);dialog.hidden=true;global.document.body.appendChild(dialog);
 ui={panel,checkbox,refresh:refreshButton,status,count,list,overlay,dialog,title,content};panel.addEventListener('toggle',()=>{if(api.publicWaitingMap&&api.publicWaitingMap.refresh)api.publicWaitingMap.refresh();});
 checkbox.addEventListener('change',()=>{enabled=checkbox.checked;draw();});refreshButton.addEventListener('click',()=>refresh());closeButton.addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('click',event=>{if(event.target===dialog)close();});global.addEventListener('resize',()=>{draw();photoOverlay();});global.document.addEventListener('noriba-pilot-region-changed',()=>{lastDraw=null;controls(true);});
 initializing=(async()=>{const loaded=await refresh();const id=new URL(global.location.href).searchParams.get('publicStop');if(id){if(!ID.test(id))message('公開案内の番号を確認してください。',true);else if(loaded)await show(id,{focusMap:true});}return true;})();return initializing;
}
const exported=Object.freeze({init,draw,show,refresh,validateList,validateDetail,validPolygon,baseURL,base:BASE});
global.PublicWaitingLayer=exported;if(typeof module==='object'&&module.exports)module.exports=exported;
})(typeof window!=='undefined'?window:globalThis);

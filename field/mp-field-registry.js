(function (global) {
  'use strict';
  const VERSION = '1.2.0';
  const LIMITS = Object.freeze({ photoBytes: 12 * 1024 * 1024, videoBytes: 40 * 1024 * 1024, workspaceBytes: 80 * 1024 * 1024, records: 5000, history: 10, photosPerRecord: 20 });
  const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
  const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];
  const FIELDS = ['municipality', 'service', 'mpId', 'name', 'lat', 'lon', 'elevationM', 'address', 'observedAt', 'coordinateBasis', 'confirmation', 'notes', 'photo', 'additionalPhotos', 'video'];
  const CSV_FIELDS = ['municipality', 'service', 'mp_id', 'name', 'latitude', 'longitude', 'elevation_m', 'address', 'observed_at', 'coordinate_basis', 'confirmation', 'notes', 'photo_url', 'video_url'];
  const ALIASES = {
    municipality: ['municipality', '自治体', '自治体名', '市町村', '市町村名'],
    service: ['service', '運行サービス', 'サービス', '運行サービス名', '交通サービス'],
    mpId: ['mpid', 'mp_id', 'id', 'stopid', 'stop_id', 'MP番号', '乗り場番号', '停留所番号'],
    name: ['name', 'stopname', 'stop_name', '名称', 'MP名称', '乗り場名', '停留所名'],
    lat: ['latitude', 'lat', 'stoplat', 'stop_lat', '緯度'],
    lon: ['longitude', 'lon', 'lng', 'stoplon', 'stop_lon', '経度'],
    elevationM: ['elevationm', 'elevation_m', 'elevation', 'z', '標高', '標高m'],
    address: ['address', '住所', '所在地'],
    observedAt: ['observedat', 'observed_at', '撮影日', '確認日', '取得日'],
    coordinateBasis: ['coordinatebasis', 'coordinate_basis', '座標の根拠', '位置の根拠', '座標確認方法'],
    confirmation: ['confirmation', '確認状況', '確認状態'],
    notes: ['notes', '備考', '確認事項', 'メモ'],
    photo: ['photourl', 'photo_url', '写真URL', '写真url'],
    video: ['videourl', 'video_url', '動画URL', '動画url', 'ショートURL']
  };
  function fail(message) { throw new Error(message); }
  function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + 'はオブジェクトで指定してください。'); return value; }
  function string(value, label, max, required) {
    if (value === null || value === undefined) value = '';
    if (typeof value !== 'string' && typeof value !== 'number') fail(label + 'は文字で指定してください。');
    const result = String(value).trim();
    if (required && !result) fail(label + 'を入力してください。');
    if (result.length > max) fail(label + 'は' + max + '文字以内で入力してください。');
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) fail(label + 'に使用できない制御文字があります。');
    return result;
  }
  function byteLength(value) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
    let count = 0; for (const c of value) { const n = c.codePointAt(0); count += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4; } return count;
  }
  function number(value, label, min, max) {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
    if ((typeof value !== 'number' && typeof value !== 'string') || !Number.isFinite(Number(value))) fail(label + 'は数値で入力してください。');
    if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) fail(label + 'は十進数で入力してください。');
    const result = Number(value);
    if (result < min || result > max) fail(label + 'は' + min + '〜' + max + 'の範囲で入力してください。');
    return Object.is(result, -0) ? 0 : result;
  }
  function validDay(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    return year >= 1900 && year <= 2200 && month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
  }
  function day(value) { const result = string(value, '撮影日・確認日', 10); if (result && !validDay(result)) fail('撮影日・確認日は実在する日付をYYYY-MM-DDで入力してください。'); return result; }
  function timestamp(value, optional) {
    if ((value === null || value === undefined || value === '') && optional) return '';
    const s = value instanceof Date ? value.toISOString() : string(value, '更新日時', 40, true);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(s) || !validDay(s.slice(0, 10)) || !Number.isFinite(Date.parse(s))) fail('更新日時が正しくありません。');
    return s;
  }
  function keyOf(record) { return JSON.stringify([string(record.municipality, '自治体名', 120, true), string(record.service, '運行サービス', 120, true), string(record.mpId, 'MP番号', 80, true)]); }
  function decodedBytes(base64) {
    if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) fail('添付ファイルのデータが正しいbase64形式ではありません。');
    return base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  }
  function safeMediaURL(raw, kind) {
    if (!['photo', 'video'].includes(kind)) fail('資料の種類は写真または動画を指定してください。');
    if (raw === null || raw === undefined || raw === '') return '';
    if (typeof raw !== 'string') fail('資料のURLは文字で指定してください。');
    const value = raw.trim();
    if (!value) return '';
    if (/[\u0000-\u0020\u007f]/.test(value)) fail('資料のURLに空白または制御文字があります。');
    if (/^data:/i.test(value)) {
      const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]*)$/.exec(value);
      if (!match) fail('添付ファイルの形式を確認してください。');
      const mime = match[1].toLowerCase();
      if (!(kind === 'photo' ? PHOTO_MIMES : VIDEO_MIMES).includes(mime)) fail(kind === 'photo' ? '写真はJPEG・PNG・WebPを登録してください。' : '動画はMP4・WebM・MOVを登録してください。');
      const bytes = decodedBytes(match[2]);
      if (!bytes) fail('空の添付ファイルは登録できません。');
      const limit = kind === 'photo' ? LIMITS.photoBytes : LIMITS.videoBytes;
      if (bytes > limit) fail((kind === 'photo' ? '写真は12' : '動画は40') + 'MiB以内のファイルを登録してください。');
      return 'data:' + mime + ';base64,' + match[2];
    }
    let url; try { url = new URL(value); } catch (_) { fail('資料のURLを確認してください。'); }
    if (url.protocol !== 'https:' || url.username || url.password) fail('資料には認証情報を含まないhttpsのURLを登録してください。');
    const hostname = url.hostname.toLowerCase();
    if (kind === 'video' && ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(hostname)) {
      let id = null;
      if (hostname.endsWith('youtu.be')) id = url.pathname.slice(1);
      else if (url.pathname === '/watch') id = url.searchParams.get('v');
      else { const m = /^\/(?:shorts|embed)\/([^/]+)\/?$/.exec(url.pathname); if (m) id = m[1]; }
      if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) fail('YouTubeの個別動画URLを登録してください。チャンネルURLでは登録できません。');
      return 'https://www.youtube.com/watch?v=' + id;
    }
    url.hash = '';
    return url.href;
  }
  function normalizeMedia(raw, kind) {
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'string') raw = { url: raw };
    object(raw, '資料');
    const url = safeMediaURL(raw.url || '', kind);
    if (!url) return null;
    let mime = string(raw.mime, '資料の形式', 80).toLowerCase();
    if (url.startsWith('data:')) mime = url.slice(5, url.indexOf(';'));
    else if (/^https:\/\/www\.youtube\.com\/watch\?v=/.test(url)) mime = 'video/youtube';
    else if (!mime) {
      const extension = new URL(url).pathname.split('.').pop().toLowerCase();
      mime = ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' })[extension] || '';
    }
    if (mime && !(kind === 'photo' ? PHOTO_MIMES : [...VIDEO_MIMES, 'video/youtube']).includes(mime)) fail(kind === 'photo' ? '写真の形式はJPEG・PNG・WebPを指定してください。' : '動画の形式はMP4・WebM・MOVまたはYouTubeを指定してください。');
    const result = { url, name: string(raw.name, '資料名', 240), mime };
    if(raw.capturePosition!==undefined&&raw.capturePosition!==null){object(raw.capturePosition,'写真・動画の位置記録');const p=raw.capturePosition;result.capturePosition={lat:number(p.lat,'資料位置の緯度',-90,90),lon:number(p.lon,'資料位置の経度',-180,180),observedAt:day(p.observedAt),basis:string(p.basis,'資料位置の根拠',500)};if((result.capturePosition.lat===null)!==(result.capturePosition.lon===null))fail('資料位置の緯度と経度を両方指定してください。');}
    if (raw.processingNote !== undefined) {
      if (typeof raw.processingNote !== 'string') fail('画像処理の記録は文字で指定してください。');
      const processingNote = string(raw.processingNote, '画像処理の記録', 500);
      if (processingNote) result.processingNote = processingNote;
    }
    return result;
  }
  function normalizeHistory(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) fail('変更履歴は配列で指定してください。');
    return value.slice(-LIMITS.history).map(h => {
      object(h, '変更履歴');
      const action = string(h.action, '変更種別', 20) || 'updated';
      if (!['created', 'updated', 'imported'].includes(action)) fail('変更履歴の種別が正しくありません。');
      const changes = h.changes === undefined ? [] : h.changes;
      if (!Array.isArray(changes) || changes.length > FIELDS.length) fail('変更履歴の項目が正しくありません。');
      return { at: timestamp(h.at, false), action, summary: string(h.summary, '変更履歴の要約', 500), changes: changes.map(v => string(v, '変更項目', 40)) };
    });
  }
  function normalizeRecord(raw) {
    object(raw, 'MP');
    const record = {
      municipality: string(raw.municipality, '自治体名', 120, true),
      service: string(raw.service, '運行サービス', 120, true),
      mpId: string(raw.mpId, 'MP番号', 80, true),
      name: string(raw.name, '乗り場名', 240, true),
      lat: number(raw.lat, '緯度', -90, 90),
      lon: number(raw.lon, '経度', -180, 180),
      elevationM: number(raw.elevationM, '標高', -12000, 10000),
      address: string(raw.address, '住所', 500),
      observedAt: day(raw.observedAt),
      coordinateBasis: string(raw.coordinateBasis, '座標の根拠', 1000),
      confirmation: string(raw.confirmation, '確認状況', 30) || 'unconfirmed',
      notes: string(raw.notes, '備考・確認事項', 5000),
      photo: normalizeMedia(raw.photo, 'photo'),
      additionalPhotos: [],
      video: normalizeMedia(raw.video, 'video'),
      history: normalizeHistory(raw.history)
    };
    if(raw.active!==undefined&&typeof raw.active!=='boolean'||raw.archived!==undefined&&typeof raw.archived!=='boolean')fail('台帳の有効・保管状態を確認してください。');
    record.active=raw.active===undefined?raw.archived!==true:raw.active;record.archived=!record.active;
    if(raw.locationReviewRequired!==undefined&&typeof raw.locationReviewRequired!=='boolean')fail('位置の再確認状態を確認してください。');record.locationReviewRequired=raw.locationReviewRequired===true;
    record.planLink=null;
    if(raw.planLink!=null){object(raw.planLink,'配置案の対応');const p=raw.planLink;record.planLink={municipalityKey:string(p.municipalityKey,'配置自治体',120,true),datasetSignature:string(p.datasetSignature,'配置資料の版',240,true),scenarioId:string(p.scenarioId,'配置案',20,true),scenarioLabel:string(p.scenarioLabel,'配置案名',240),sourceMPId:string(p.sourceMPId,'配置元MP番号',160,true),prototype:p.prototype===true,syncedAt:timestamp(p.syncedAt,false)};}
    const locationHistory=raw.locationHistory||[];if(!Array.isArray(locationHistory)||locationHistory.length>20)fail('位置・保管の履歴は20件以内です。');record.locationHistory=locationHistory.map(h=>{object(h,'位置の履歴');const coordinate=p=>p==null?null:{lat:number(p.lat,'履歴の緯度',-90,90),lon:number(p.lon,'履歴の経度',-180,180)};return {at:timestamp(h.at,false),reason:string(h.reason,'同期の理由',1000,true),action:string(h.action,'同期操作',40,true),from:coordinate(h.from),to:coordinate(h.to),fromState:h.fromState==null?null:{elevationM:number(h.fromState.elevationM,'変更前の標高',-12000,10000),coordinateBasis:string(h.fromState.coordinateBasis,'変更前の位置の根拠',1000),confirmation:string(h.fromState.confirmation,'変更前の確認状況',30),observedAt:day(h.fromState.observedAt),address:string(h.fromState.address,'変更前の住所',500),sourceLink:string(h.fromState.sourceLink,'変更前の対応資料',4000)},scenarioId:string(h.scenarioId,'同期案',20),sourceSignature:string(h.sourceSignature,'同期資料版',240)};});
    if (raw.additionalPhotos !== undefined && !Array.isArray(raw.additionalPhotos)) fail('追加写真は配列で指定してください。');
    record.additionalPhotos = (raw.additionalPhotos || []).map(p => normalizeMedia(p, 'photo'));
    if (record.additionalPhotos.some(p => !p)) fail('追加写真に空の資料があります。');
    if (!record.photo && record.additionalPhotos.length) record.photo = record.additionalPhotos.shift();
    const photos = (record.photo ? [record.photo] : []).concat(record.additionalPhotos);
    if (photos.length > LIMITS.photosPerRecord) fail('1地点の写真は20枚までです。');
    if (new Set(photos.map(p => p.url)).size !== photos.length) fail('同じ写真データが重複しています。');
    if ((record.lat === null) !== (record.lon === null)) fail('緯度と経度は両方を入力するか、両方を空欄にしてください。');
    if (!['unconfirmed', 'document', 'field'].includes(record.confirmation)) fail('確認状況は未確認・資料確認・現地確認から選んでください。');
    record.key = keyOf(record);
    if (raw.key !== undefined && raw.key !== record.key) fail('MPの識別子と自治体・サービス・MP番号が一致しません。');
    return record;
  }
  function empty() { return { schemaVersion: 2, records: [], updatedAt: '' }; }
  function assertSize(workspace) { if (byteLength(JSON.stringify(workspace)) > LIMITS.workspaceBytes) fail('写真・動画を含む保存データは80MiB以内にしてください。添付の文字化による容量増加も含みます。'); return workspace; }
  function validateWorkspace(raw) {
    object(raw, '登録データ');
    if (![1, 2].includes(raw.schemaVersion)) fail('資料登録データの形式が対応するバージョンではありません。');
    if (!Array.isArray(raw.records) || raw.records.length > LIMITS.records) fail('MP一覧は5000地点以内の配列で指定してください。');
    if (raw.schemaVersion === 1 && raw.records.some(r => r && Array.isArray(r.additionalPhotos) && r.additionalPhotos.length)) fail('複数写真を含む資料は形式2で保存してください。');
    const records = raw.records.map(normalizeRecord), keys = new Set();
    for (const r of records) { if (keys.has(r.key)) fail('自治体・サービス・MP番号が重複しています：' + r.mpId + ' ' + r.name); keys.add(r.key); }
    return assertSize({ schemaVersion: 2, records, updatedAt: timestamp(raw.updatedAt, true) });
  }
  function upsert(workspace, raw, options) {
    const current = validateWorkspace(workspace), config = options || {};
    const previousKey = config.previousKey, at = timestamp(config.now || new Date().toISOString(), false);
    const source = Object.assign({}, raw); delete source.key;
    const previousIndex = previousKey === undefined || previousKey === null ? -1 : current.records.findIndex(r => r.key === previousKey);
    if (previousKey !== undefined && previousKey !== null && previousIndex < 0) fail('編集するMPが見つかりません。最新の一覧から選び直してください。');
    if (previousIndex >= 0 && source.additionalPhotos === undefined) source.additionalPhotos = current.records[previousIndex].additionalPhotos;
    if(previousIndex>=0)for(const field of ['active','archived','planLink','locationReviewRequired','locationHistory'])if(source[field]===undefined)source[field]=current.records[previousIndex][field];
    if(previousIndex>=0)for(const field of ['photo','video']){const old=current.records[previousIndex][field],next=source[field];if(old&&next&&typeof next==='object'&&old.url===next.url&&next.capturePosition===undefined&&old.capturePosition)source[field]={...next,capturePosition:old.capturePosition};}
    const record = normalizeRecord(source);
    if (current.records.some((r, i) => i !== previousIndex && r.key === record.key)) fail('同じ自治体・サービス・MP番号が登録済みです。編集する場合は一覧から選んでください。');
    if (previousIndex < 0 && current.records.length >= LIMITS.records) fail('登録は5000地点までです。');
    const before = previousIndex >= 0 ? current.records[previousIndex] : null;
    const changes = before ? FIELDS.filter(field => JSON.stringify(before[field]) !== JSON.stringify(record[field])) : FIELDS.filter(field => record[field] !== null && record[field] !== '');
    record.history = (before ? before.history : []).concat([{ at, action: before ? 'updated' : 'created', summary: before ? (changes.length ? changes.join('、') + 'を変更' : '内容を再確認して保存') : 'MPを登録', changes }]).slice(-LIMITS.history);
    if (before) current.records[previousIndex] = record; else current.records.push(record);
    current.updatedAt = at;
    return assertSize(current);
  }
  function remove(workspace, key) {
    const current = validateWorkspace(workspace);
    if (!current.records.some(r => r.key === key)) fail('削除するMPが見つかりません。');
    current.records = current.records.filter(r => r.key !== key); current.updatedAt = new Date().toISOString(); return current;
  }
  function parseJSON(text) {
    if (typeof text !== 'string') fail('保存データを文字列で読み込んでください。');
    if (byteLength(text) > LIMITS.workspaceBytes) fail('読み込む保存データは80MiB以内にしてください。');
    let parsed; try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (_) { fail('JSONの形式を読み取れませんでした。資料登録用の保存ファイルを選んでください。'); }
    return validateWorkspace(parsed);
  }
  function stringify(workspace) { return JSON.stringify(validateWorkspace(workspace)); }
  function parseCSV(text) {
    if (typeof text !== 'string' || byteLength(text) > LIMITS.workspaceBytes) fail('CSVは80MiB以内の文字データを指定してください。');
    text = text.replace(/^\uFEFF/, '');
    const rows = []; let row = [], cell = '', quoted = false, closed = false;
    function finishCell() { row.push(cell); cell = ''; closed = false; }
    function finishRow() { finishCell(); if (row.some(c => c.trim() !== '')) rows.push(row); row = []; if (rows.length > LIMITS.records + 1) fail('CSVは5000地点以内にしてください。'); }
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } } else cell += c; }
      else if (c === '"') { if (cell !== '' || closed) fail('CSVの引用符の位置を確認してください。'); quoted = true; }
      else if (c === ',') finishCell();
      else if (c === '\r' || c === '\n') { if (c === '\r' && text[i + 1] === '\n') i++; finishRow(); }
      else { if (closed) fail('CSVの引用符を閉じた後に余分な文字があります。'); cell += c; }
    }
    if (quoted) fail('CSVの引用符が閉じられていません。');
    if (cell !== '' || row.length || closed) finishRow();
    return rows;
  }
  function headerKey(value) { return String(value).normalize('NFKC').toLowerCase().replace(/[\s_]/g, ''); }
  function importCSV(text, workspace) {
    const result = validateWorkspace(workspace || empty()), rows = parseCSV(text);
    if (!rows.length) fail('CSVに見出しがありません。');
    const aliasMap = new Map(); for (const [field, names] of Object.entries(ALIASES)) for (const n of names) aliasMap.set(headerKey(n), field);
    const fields = rows.shift().map(name => aliasMap.get(headerKey(name)) || null), recognized = fields.filter(Boolean);
    if (new Set(recognized).size !== recognized.length) fail('CSVの同じ項目を表す見出しが重複しています。');
    for (const required of ['municipality', 'service', 'mpId', 'name']) if (!fields.includes(required)) fail('CSVに自治体名・運行サービス・MP番号・乗り場名の見出しが必要です。');
    if (!rows.length) fail('CSVに登録する地点がありません。');
    const keys = new Set(result.records.map(r => r.key)), at = new Date().toISOString(), added = [];
    rows.forEach((values, index) => {
      try {
        if (values.length > fields.length || values.length < fields.length) fail('見出しと列数が一致しません。');
        const raw = {}; fields.forEach((field, column) => { if (field) raw[field] = values[column]; });
        const confirmationAliases = { '未確認': 'unconfirmed', '資料確認': 'document', '現地確認': 'field' };
        if (confirmationAliases[raw.confirmation]) raw.confirmation = confirmationAliases[raw.confirmation];
        const record = normalizeRecord(raw);
        if (keys.has(record.key)) fail('自治体・サービス・MP番号が重複しています：' + record.mpId);
        keys.add(record.key); record.history = [{ at, action: 'imported', summary: 'CSVから登録', changes: [] }]; added.push(record);
      } catch (error) { fail('CSVの' + (index + 2) + '行目：' + error.message); }
    });
    if (result.records.length + added.length > LIMITS.records) fail('登録は5000地点までです。');
    result.records = result.records.concat(added); result.updatedAt = at; return assertSize(result);
  }
  function csvCell(value) {
    let s = value === null || value === undefined ? '' : String(value);
    // Exported text must remain text when the CSV is opened in a spreadsheet.
    // Numeric coordinates/elevations retain their numeric sign; JSON keeps all source text unchanged.
    if (typeof value === 'string' && /^\s*[=+\-@]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvTemplate() { return '\uFEFF' + CSV_FIELDS.join(',') + '\r\n'; }
  function toCSV(workspace) {
    const current = validateWorkspace(workspace);
    return csvTemplate() + current.records.map(r => [r.municipality, r.service, r.mpId, r.name, r.lat, r.lon, r.elevationM, r.address, r.observedAt, r.coordinateBasis, r.confirmation, r.notes, r.photo && !r.photo.url.startsWith('data:') ? r.photo.url : '', r.video && !r.video.url.startsWith('data:') ? r.video.url : ''].map(csvCell).join(',')).join('\r\n') + (current.records.length ? '\r\n' : '');
  }
  function stats(workspace) {
    const current = validateWorkspace(workspace), r = current.records;
    const coordinates = r.filter(p => p.lat !== null && p.lon !== null).length, photos = r.filter(p => p.photo || p.additionalPhotos.length).length, videos = r.filter(p => p.video).length;
    return { total: r.length, withCoordinates: coordinates, missingCoordinates: r.length - coordinates, withPhoto: photos, missingPhoto: r.length - photos, withVideo: videos, missingVideo: r.length - videos, unconfirmed: r.filter(p => p.confirmation === 'unconfirmed').length };
  }
  function escapeHtml(value) { return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  const api = Object.freeze({ VERSION, LIMITS, empty, keyOf, normalizeRecord, validateWorkspace, upsert, remove, parseJSON, stringify, importCSV, csvTemplate, toCSV, stats, safeMediaURL, escapeHtml });
  global.MPFieldRegistry = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

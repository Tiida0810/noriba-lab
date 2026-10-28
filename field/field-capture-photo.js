(function (global) {
  'use strict';
  const LIMITS = Object.freeze({ sourceBytes: 12 * 1024 * 1024, headerBytes: 256 * 1024, sourcePixels: 24000000, sourceEdge: 12000, outputEdge: 1600, outputBytes: 2 * 1024 * 1024, quality: 0.82, timeoutMs: 20000 });
  let activeJob = null;
  function error(code, message) { const e = new Error(message); e.name = code === 'PHOTO_ABORTED' ? 'AbortError' : 'FieldCapturePhotoError'; e.code = code; return e; }
  function fail(code, message) { throw error(code, message); }
  function bytesOf(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    fail('PHOTO_HEADER', '写真の先頭データを読み取れませんでした。');
  }
  function ascii(b, at, length) { let out = ''; for (let i = 0; i < length; i++) out += String.fromCharCode(b[at + i]); return out; }
  function u16be(b, p) { return b[p] * 256 + b[p + 1]; }
  function u16le(b, p) { return b[p] + b[p + 1] * 256; }
  function u24le(b, p) { return b[p] + b[p + 1] * 256 + b[p + 2] * 65536; }
  function u32le(b, p) { return (b[p] + b[p + 1] * 256 + b[p + 2] * 65536 + b[p + 3] * 16777216) >>> 0; }
  function u32be(b, p) { return b[p] * 16777216 + b[p + 1] * 65536 + b[p + 2] * 256 + b[p + 3]; }
  function dimensions(width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) fail('PHOTO_DIMENSIONS', '写真の縦横の大きさを確認できませんでした。');
    if (width > LIMITS.sourceEdge || height > LIMITS.sourceEdge || width * height > LIMITS.sourcePixels) fail('PHOTO_DIMENSIONS', '写真は2400万画素以内、縦横それぞれ12000px以内にしてください。カメラの解像度を下げるか、小さい写真を選んでください。');
    return { width, height };
  }
  function headerError() { fail('PHOTO_HEADER', '写真の形式・大きさを読み取れませんでした。破損していないJPEG・PNG・WebPの写真を選んでください。'); }
  function inspectHeader(value, totalBytes) {
    const b = bytesOf(value), size = totalBytes === undefined ? b.length : totalBytes;
    if (!Number.isSafeInteger(size) || size < 1 || size > LIMITS.sourceBytes || b.length > size || b.length > LIMITS.headerBytes) headerError();
    if (b.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v)) {
      if (b.length < 33 || u32be(b, 8) !== 13 || ascii(b, 12, 4) !== 'IHDR') headerError();
      return { mime: 'image/png', ...dimensions(u32be(b, 16), u32be(b, 20)) };
    }
    if (b.length >= 2 && b[0] === 255 && b[1] === 216) {
      let p = 2;
      while (p < b.length) {
        if (b[p++] !== 255) headerError();
        while (p < b.length && b[p] === 255) p++;
        if (p >= b.length) headerError();
        const marker = b[p++];
        if (marker === 0 || marker === 216 || marker === 217 || marker === 218) headerError();
        if (marker === 1 || marker >= 208 && marker <= 215) continue;
        if (p + 2 > b.length) headerError();
        const length = u16be(b, p);
        if (length < 2 || p + length > b.length || p + length > size) headerError();
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
          if (length < 8) headerError();
          return { mime: 'image/jpeg', ...dimensions(u16be(b, p + 5), u16be(b, p + 3)) };
        }
        p += length;
      }
      headerError();
    }
    if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
      if (b.length < 25 || u32le(b, 4) + 8 !== size || size < 26) headerError();
      const type = ascii(b, 12, 4), length = u32le(b, 16);
      if (20 + length + (length % 2) > size) headerError();
      if (type === 'VP8X') {
        if (length !== 10 || b.length < 30) headerError();
        return { mime: 'image/webp', ...dimensions(u24le(b, 24) + 1, u24le(b, 27) + 1) };
      }
      if (type === 'VP8L') {
        if (length < 5 || b[20] !== 47 || (b[24] & 224)) headerError();
        const bits = u32le(b, 21);
        return { mime: 'image/webp', ...dimensions((bits & 16383) + 1, ((bits >>> 14) & 16383) + 1) };
      }
      if (type === 'VP8 ') {
        if (length < 10 || b.length < 30 || (b[20] & 1) || b[23] !== 157 || b[24] !== 1 || b[25] !== 42) headerError();
        return { mime: 'image/webp', ...dimensions(u16le(b, 26) & 16383, u16le(b, 28) & 16383) };
      }
      headerError();
    }
    if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp' && /(?:heic|heix|hevc|hevx|mif1|msf1)/.test(ascii(b, 8, Math.min(32, b.length - 8)))) fail('PHOTO_HEIC', 'HEIC・HEIF形式はこの画面では読み込めません。端末でJPEG・PNG・WebPに変換するか、カメラをJPEG保存に設定して撮り直してください。');
    fail('PHOTO_FORMAT', 'JPEG・PNG・WebPの写真を選んでください。HEICは端末でJPEGなどに変換してから選んでください。');
  }
  function jpegWithoutAPP1(b) {
    if (b.length < 4 || b[0] !== 255 || b[1] !== 216) fail('PHOTO_ENCODE', '表示用のJPEG写真を作成できませんでした。');
    let p = 2, copyStart = 0, sawScan = false, sawEnd = false;
    const parts = [];
    while (p < b.length) {
      const start = p;
      if (b[p++] !== 255) fail('PHOTO_ENCODE', '表示用JPEGの形式を確認できませんでした。');
      while (p < b.length && b[p] === 255) p++;
      if (p >= b.length) fail('PHOTO_ENCODE', '表示用JPEGの形式を確認できませんでした。');
      const marker = b[p++];
      if (marker === 217) { sawEnd = true; if (p !== b.length) fail('PHOTO_ENCODE', '表示用JPEGの末尾を確認できませんでした。'); break; }
      if (marker === 0 || marker === 216) fail('PHOTO_ENCODE', '表示用JPEGの形式を確認できませんでした。');
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (p + 2 > b.length) fail('PHOTO_ENCODE', '表示用JPEGの形式を確認できませんでした。');
      const length = u16be(b, p), end = p + length;
      if (length < 2 || end > b.length) fail('PHOTO_ENCODE', '表示用JPEGの形式を確認できませんでした。');
      if (marker === 225) { parts.push(b.subarray(copyStart, start)); copyStart = end; }
      p = end;
      if (marker === 218) {
        sawScan = true;
        while (p < b.length) {
          if (b[p] !== 255) { p++; continue; }
          let q = p + 1; while (q < b.length && b[q] === 255) q++;
          if (q >= b.length) break;
          if (b[q] === 0 || b[q] >= 208 && b[q] <= 215) { p = q + 1; continue; }
          break;
        }
      }
    }
    if (!sawScan || !sawEnd) fail('PHOTO_ENCODE', '表示用JPEGを最後まで確認できませんでした。');
    if (!parts.length) return b;
    parts.push(b.subarray(copyStart));
    const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0)); let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  }
  function outputName(raw) {
    let name = typeof raw === 'string' ? raw.split(/[\\/]/).pop().normalize('NFC') : '';
    name = name.replace(/\.[^.]*$/, '').replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
    if (!name) name = '現地写真';
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = '写真_' + name;
    let bounded = ''; for (const c of name) { if (bounded.length + c.length > 236) break; bounded += c; }
    return bounded + '.jpg';
  }
  function check(job) { if (job.stopped) throw job.stopped; }
  function release(job) {
    if (job.bitmap) { const bitmap = job.bitmap; job.bitmap = null; try { bitmap.close(); } catch (_) {} }
    if (job.image) { const image = job.image; job.image = null; image.onload = image.onerror = null; try { image.src = ''; } catch (_) {} }
    if (job.objectURL) { const url = job.objectURL; job.objectURL = null; try { global.URL.revokeObjectURL(url); } catch (_) {} }
    if (job.canvas) { const canvas = job.canvas; job.canvas = null; try { canvas.width = canvas.height = 1; } catch (_) {} }
  }
  async function decode(job, file) {
    if (typeof global.createImageBitmap === 'function') {
      try { const bitmap = await global.createImageBitmap(file, { imageOrientation: 'from-image' }); job.bitmap = bitmap; check(job); return bitmap; }
      catch (e) {
        check(job);
        if (!e || !['InvalidStateError', 'EncodingError', 'NotSupportedError', 'TypeError'].includes(e.name)) fail('PHOTO_DECODE', '写真を画像として開けませんでした。破損していない小さい写真を選んでください。');
      }
    }
    check(job);
    if (typeof global.Image !== 'function' || !global.URL || typeof global.URL.createObjectURL !== 'function') fail('PHOTO_BROWSER', 'このブラウザーでは写真を開けません。別のブラウザーで写真を選んでください。');
    job.objectURL = global.URL.createObjectURL(file);
    const image = new global.Image(); job.image = image;
    return new Promise((resolve, reject) => {
      const stop = () => { image.onload = image.onerror = null; try { image.src = ''; } catch (_) {} reject(job.stopped); };
      job.stopImage = stop;
      image.onload = () => { job.stopImage = null; image.onload = image.onerror = null; if (job.stopped) reject(job.stopped); else resolve(image); };
      image.onerror = () => { job.stopImage = null; image.onload = image.onerror = null; reject(error('PHOTO_DECODE', '写真を画像として開けませんでした。破損していないJPEG・PNG・WebPを選んでください。')); };
      image.decoding = 'async'; image.src = job.objectURL;
    });
  }
  function encodedBlob(canvas) {
    return new Promise((resolve, reject) => {
      try { canvas.toBlob(blob => blob ? resolve(blob) : reject(error('PHOTO_ENCODE', '表示用の写真を作成できませんでした。')), 'image/jpeg', LIMITS.quality); }
      catch (_) { reject(error('PHOTO_ENCODE', '表示用の写真を作成できませんでした。')); }
    });
  }
  function dataURL(b) {
    if (typeof global.btoa !== 'function') fail('PHOTO_BROWSER', 'このブラウザーでは写真の保存用データを作成できません。');
    const chunks = [];
    for (let p = 0; p < b.length; p += 8192) chunks.push(String.fromCharCode.apply(null, b.subarray(p, Math.min(p + 8192, b.length))));
    return 'data:image/jpeg;base64,' + global.btoa(chunks.join(''));
  }
  async function run(job, file) {
    try {
      check(job);
      const header = new Uint8Array(await file.slice(0, Math.min(file.size, LIMITS.headerBytes)).arrayBuffer()); check(job);
      const source = inspectHeader(header, file.size), image = await decode(job, file); check(job);
      const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height; dimensions(width, height);
      const scale = Math.min(1, LIMITS.outputEdge / Math.max(width, height)), outWidth = Math.max(1, Math.round(width * scale)), outHeight = Math.max(1, Math.round(height * scale));
      if (!global.document || typeof global.document.createElement !== 'function') fail('PHOTO_BROWSER', '表示用の写真を作る機能を使えません。別のブラウザーで選んでください。');
      const canvas = global.document.createElement('canvas'); job.canvas = canvas; canvas.width = outWidth; canvas.height = outHeight;
      const ctx = canvas.getContext('2d'); if (!ctx) fail('PHOTO_BROWSER', '表示用の写真を作る機能を使えません。別のブラウザーで選んでください。');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, outWidth, outHeight); ctx.drawImage(image, 0, 0, outWidth, outHeight);
      // Source metadata is never forwarded to the canvas encoder. Only its oriented pixels are drawn.
      if (job.bitmap) { const bitmap = job.bitmap; job.bitmap = null; bitmap.close(); }
      if (job.image) { const imageNode = job.image; job.image = null; imageNode.onload = imageNode.onerror = null; imageNode.src = ''; }
      if (job.objectURL) { global.URL.revokeObjectURL(job.objectURL); job.objectURL = null; }
      check(job);
      const blob = await encodedBlob(canvas); check(job);
      canvas.width = canvas.height = 1; job.canvas = null;
      if (blob.type !== 'image/jpeg') fail('PHOTO_ENCODE', 'このブラウザーではJPEGの表示用写真を作成できません。別のブラウザーで選んでください。');
      if (!Number.isSafeInteger(blob.size) || !blob.size || blob.size > LIMITS.outputBytes) fail('PHOTO_OUTPUT_SIZE', '表示用の写真が2MiBを超えました。別の小さい写真を選んでください。');
      const encoded = jpegWithoutAPP1(new Uint8Array(await blob.arrayBuffer())); check(job);
      const output = inspectHeader(encoded.subarray(0, Math.min(encoded.length, LIMITS.headerBytes)), encoded.length);
      if (output.mime !== 'image/jpeg' || output.width !== outWidth || output.height !== outHeight) fail('PHOTO_ENCODE', '表示用写真の大きさを確認できませんでした。');
      const media = { url: dataURL(encoded), name: outputName(file.name), mime: 'image/jpeg', processingNote: '端末内で向きを反映した表示用コピー。長辺1600px以内・JPEG品質0.82。元写真のEXIF・位置情報は引き継いでいません。元ファイルは変更していません。' };
      check(job);
      return { media, width: outWidth, height: outHeight, sourceWidth: source.width, sourceHeight: source.height, sourceBytes: file.size, outputBytes: encoded.length };
    } catch (e) {
      check(job);
      if (e && typeof e.code === 'string' && e.code.startsWith('PHOTO_')) throw e;
      throw error('PHOTO_PROCESS', '写真の処理を完了できませんでした。破損していない小さい写真を選ぶか、別のブラウザーで選んでください。');
    } finally { release(job); if (activeJob === job) activeJob = null; }
  }
  async function prepare(file, options) {
    const opts = options || {}, signal = opts.signal;
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) fail('PHOTO_OPTIONS', '写真の読込設定を確認してください。');
    if (signal && signal.aborted) throw error('PHOTO_ABORTED', '写真の読込を取り消しました。');
    if (!file || typeof file.slice !== 'function' || typeof file.arrayBuffer !== 'function' || !Number.isSafeInteger(file.size) || file.size < 1) fail('PHOTO_FILE', '空ではない写真ファイルを選んでください。');
    if (file.size > LIMITS.sourceBytes) fail('PHOTO_SOURCE_SIZE', '元写真は12MiB以内にしてください。カメラの解像度を下げるか、小さい写真を選んでください。');
    if (activeJob) fail('PHOTO_BUSY', '前の写真の処理が終わってから、写真を選び直してください。');
    const job = { stopped: null, bitmap: null, image: null, objectURL: null, canvas: null, stopImage: null }; activeJob = job;
    let rejectStopped, timeout;
    const stopped = new Promise((_, reject) => { rejectStopped = reject; });
    const stop = reason => { if (job.stopped) return; job.stopped = reason; if (job.stopImage) job.stopImage(); release(job); rejectStopped(reason); };
    const abort = () => stop(error('PHOTO_ABORTED', '写真の読込を取り消しました。'));
    if (signal) signal.addEventListener('abort', abort, { once: true });
    timeout = global.setTimeout(() => stop(error('PHOTO_TIMEOUT', '写真の読込に時間がかかっています。小さい写真を選ぶか、この画面を開き直してください。')), LIMITS.timeoutMs);
    try { return await Promise.race([run(job, file), stopped]); }
    finally { global.clearTimeout(timeout); if (signal) signal.removeEventListener('abort', abort); }
  }
  const api = Object.freeze({ version: '1.0.0', LIMITS, inspectHeader, prepare });
  global.FieldCapturePhoto = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

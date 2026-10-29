/* ==========================================================================
   ZIP reader (service worker only; loaded with importScripts from background.js)
   Lists a .zip WITHOUT downloading all of it (only the end of the file is read, with an HTTP Range request),
   and later pulls out one single file of it. Needs no packages: Chrome's built-in DecompressionStream does the unpacking.
   Not supported (the zip is then saved as a normal .zip file): passwords, zip64 (over 4 GB), exotic compression.
   ========================================================================== */
const Zip = (() => {
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const cache = new Map();   // url -> whole zip (only when the server ignored the Range header); cleared after every run
  let cacheBytes = 0;
  const LIMIT = 300 * 1048576;
  const clearCache = () => { cache.clear(); cacheBytes = 0; };

  // bytes start..end (end inclusive) or the last -start bytes when start < 0. -> { data, start, total }
  async function getRange(url, start, end) {
    const whole = cache.get(url);
    if (whole) return start < 0 ? { data: whole.subarray(Math.max(0, whole.length + start)), start: Math.max(0, whole.length + start), total: whole.length } : { data: whole.subarray(start, end + 1), start, total: whole.length };
    const r = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(60000), headers: { Range: start < 0 ? `bytes=${start}` : `bytes=${start}-${end}` } });
    if (r.status === 206) {
      const cr = (r.headers.get('content-range') || '').match(/bytes\s+(\d+)-\d+\/(\d+|\*)/i);
      const data = new Uint8Array(await r.arrayBuffer());
      return { data, start: cr ? +cr[1] : (start < 0 ? 0 : start), total: cr && cr[2] !== '*' ? +cr[2] : 0 };
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if ((r.headers.get('content-type') || '').toLowerCase().startsWith('text/html')) throw new Error('got a web page, not a file (please log in again)');
    const len = Number(r.headers.get('content-length')) || 0;
    if (len > LIMIT) throw new Error('zip too big');
    const data = new Uint8Array(await r.arrayBuffer());   // server sent everything: keep it, so the next requests need no download
    if (cacheBytes + data.length > 2 * LIMIT) clearCache();
    cache.set(url, data); cacheBytes += data.length;
    return getRange(url, start, end);
  }

  async function list(url) {
    const t = await getRange(url, -65536), d = t.data;
    let i = d.length - 22;
    for (; i >= 0; i--) if (u32(d, i) === 0x06054b50) break;
    if (i < 0) throw new Error('not a zip');
    const count = u16(d, i + 10), cdSize = u32(d, i + 12), cdOff = u32(d, i + 16);
    if (count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF) throw new Error('zip64');
    let cd;
    if (cdOff >= t.start) cd = d.subarray(cdOff - t.start, cdOff - t.start + cdSize);
    else { const c = await getRange(url, cdOff, cdOff + cdSize - 1); cd = c.data.subarray(cdOff - c.start, cdOff - c.start + cdSize); }
    const out = [];
    let p = 0;
    while (p + 46 <= cd.length && u32(cd, p) === 0x02014b50) {
      const flags = u16(cd, p + 8), method = u16(cd, p + 10), csize = u32(cd, p + 20), usize = u32(cd, p + 24);
      const nlen = u16(cd, p + 28), elen = u16(cd, p + 30), clen = u16(cd, p + 32), off = u32(cd, p + 42);
      const name = new TextDecoder('utf-8').decode(cd.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      if (name.endsWith('/')) continue;                                   // folder entry
      const base = name.split('/').pop();
      if (!base || /^(\.|~\$)/.test(base) || /(^|\/)__MACOSX\//.test(name) || /^(thumbs\.db|desktop\.ini)$/i.test(base)) continue;
      if ((flags & 1) || (method !== 0 && method !== 8) || csize === 0xFFFFFFFF || usize === 0xFFFFFFFF || off === 0xFFFFFFFF) throw new Error('unsupported zip entry');
      out.push({ path: name, base, method, csize, usize, off, nlen });
    }
    return out;
  }

  // -> reader with read(): { done, value } of the unpacked bytes
  async function open(url, e) {
    let r = await getRange(url, e.off, e.off + 30 + e.nlen + 4096 + e.csize - 1);
    let p = e.off - r.start;
    if (u32(r.data, p) !== 0x04034b50) throw new Error('broken zip');
    const dataStart = e.off + 30 + u16(r.data, p + 26) + u16(r.data, p + 28);
    if (dataStart + e.csize > r.start + r.data.length) { r = await getRange(url, dataStart, dataStart + e.csize - 1); p = dataStart - r.start; }
    else p = dataStart - r.start;
    const comp = r.data.subarray(p, p + e.csize);
    if (comp.length !== e.csize) throw new Error('zip cut short');
    if (e.method === 0) { let done = false; return { read: async () => (done ? { done: true } : (done = true, { done: false, value: comp })) }; }
    return new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  }

  return { list, open, clearCache };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Zip;

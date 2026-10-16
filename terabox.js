// TeraBox Open Platform: OAuth (device QR) + subida por trozos + enlaces.
// Requiere vendor: TERABOX_CLIENT_ID / TERABOX_CLIENT_SECRET / TERABOX_PRIVATE_SECRET.
// Tokens persistentes: tabla kv (pg) o terabox.json local.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TB_FILE = path.join(__dirname, 'data', 'terabox.json');
let pool = null; // se inyecta con attachPool()

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }
function sign(ts) {
  return md5(`${process.env.TERABOX_CLIENT_ID}_${ts}_${process.env.TERABOX_CLIENT_SECRET}_${process.env.TERABOX_PRIVATE_SECRET}`);
}
const configured = () => !!(process.env.TERABOX_CLIENT_ID && process.env.TERABOX_CLIENT_SECRET && process.env.TERABOX_PRIVATE_SECRET);

async function kvGet(k) {
  if (pool) {
    await pool.query('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)');
    const r = await pool.query('SELECT value FROM kv WHERE key=$1', [k]);
    return r.rows[0] ? r.rows[0].value : null;
  }
  try { return (JSON.parse(fs.readFileSync(TB_FILE, 'utf8')) || {})[k] || null; }
  catch { return null; }
}
async function kvSet(k, v) {
  if (pool) {
    await pool.query('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)');
    await pool.query('INSERT INTO kv (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [k, v]);
    return;
  }
  let o = {};
  try { o = JSON.parse(fs.readFileSync(TB_FILE, 'utf8')) || {}; } catch {}
  o[k] = v;
  fs.mkdirSync(path.dirname(TB_FILE), { recursive: true });
  fs.writeFileSync(TB_FILE, JSON.stringify(o));
}
async function tokens() {
  return {
    access: await kvGet('tb_access'),
    refresh: await kvGet('tb_refresh'),
    expiry: Number(await kvGet('tb_expiry') || 0),
    api_domain: await kvGet('tb_api_domain'),
    upload_domain: await kvGet('tb_upload_domain'),
    domain_ts: Number(await kvGet('tb_domain_ts') || 0)
  };
}
async function formPost(url, fields) {
  const body = new URLSearchParams();
  Object.entries(fields).forEach(([k, v]) => body.append(k, v));
  const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, body });
  return r.json();
}

// ---- Auth: device QR ----
async function deviceStart() {
  const cid = process.env.TERABOX_CLIENT_ID;
  const r = await fetch(`https://www.terabox.com/oauth/devicecode?client_id=${encodeURIComponent(cid)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const j = await r.json();
  if (j.errno !== 0 || !j.data) throw new Error('devicecode errno=' + j.errno);
  return { device_code: j.data.device_code, qrcode: j.data.qrcode_url, expires_in: j.data.expires_in, interval: j.data.interval || 3 };
}
async function devicePoll(device_code) {
  const ts = Math.floor(Date.now() / 1000);
  const j = await formPost('https://www.terabox.com/oauth/gettoken', {
    client_id: process.env.TERABOX_CLIENT_ID,
    client_secret: process.env.TERABOX_CLIENT_SECRET,
    grant_type: 'device_code',
    code: device_code,
    timestamp: String(ts),
    sign: sign(ts)
  });
  if (j.errno === 400001) return { pending: true };
  if (j.errno !== 0 || !j.data) throw new Error('gettoken errno=' + j.errno);
  await kvSet('tb_access', j.data.access_token);
  await kvSet('tb_refresh', j.data.refresh_token);
  await kvSet('tb_expiry', String(Date.now() + (j.data.expires_in || 172800) * 1000));
  await kvSet('tb_api_domain', '');
  await kvSet('tb_upload_domain', '');
  await kvSet('tb_domain_ts', '0');
  return { ok: true };
}
async function refresh() {
  const t = await tokens();
  const ts = Math.floor(Date.now() / 1000);
  const j = await formPost('https://www.terabox.com/oauth/refreshtoken', {
    client_id: process.env.TERABOX_CLIENT_ID,
    client_secret: process.env.TERABOX_CLIENT_SECRET,
    refresh_token: t.refresh,
    timestamp: String(ts),
    sign: sign(ts)
  });
  if (j.errno !== 0 || !j.data) throw new Error('refresh errno=' + j.errno);
  await kvSet('tb_access', j.data.access_token);
  await kvSet('tb_refresh', j.data.refresh_token);
  await kvSet('tb_expiry', String(Date.now() + (j.data.expires_in || 172800) * 1000));
  return true;
}
async function domains() {
  const t = await tokens();
  if (Date.now() < t.expiry - 60000 && t.api_domain && (Date.now() - t.domain_ts) < 3600000) {
    return { api_domain: t.api_domain, upload_domain: t.upload_domain };
  }
  if (Date.now() > t.expiry - 60000) await refresh();
  const t2 = await tokens();
  const j = await formPost('https://www.terabox.com/oauth/tokeninfo', { access_token: t2.access });
  if (j.errno !== 0 || !j.data) throw new Error('tokeninfo errno=' + j.errno);
  await kvSet('tb_api_domain', j.data.api_domain);
  await kvSet('tb_upload_domain', j.data.upload_domain);
  await kvSet('tb_domain_ts', String(Date.now()));
  return { api_domain: j.data.api_domain, upload_domain: j.data.upload_domain };
}
async function access() {
  const t = await tokens();
  if (!t.access) throw new Error('TeraBox sin autorizar');
  if (Date.now() > t.expiry - 60000) await refresh();
  return (await tokens()).access;
}

// ---- Subida: precreate -> trozos -> create ----
const CHUNK = 8 * 1024 * 1024;
function splitChunks(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i += CHUNK) out.push(buf.subarray(i, i + CHUNK));
  return out.length ? out : [buf.subarray(0, 0)];
}
async function uploadBuffer(buf, remotePath) {
  const tk = await access();
  const { api_domain, upload_domain } = await domains();
  const chunks = splitChunks(Buffer.from(buf));
  const md5s = chunks.map(c => md5(c));
  const pre = await formPost(`https://${api_domain}/openapi/api/precreate?access_tokens=${encodeURIComponent(tk)}`, {
    path: remotePath, autoinit: '1', block_list: JSON.stringify(md5s)
  });
  if (pre.errno !== 0) throw new Error('precreate errno=' + pre.errno);
  if (pre.return_type === 2) return { path: remotePath, existed: true };
  const need = new Set(pre.block_list || [0]);
  for (const i of need) {
    const fd = new FormData();
    fd.append('file', new Blob([chunks[i]], { type: 'application/octet-stream' }), 'part');
    const u = `https://${upload_domain}/rest/2.0/pcs/superfile2?method=upload&app_id=250528&path=${encodeURIComponent(remotePath)}&uploadid=${encodeURIComponent(pre.uploadid)}&partseq=${i}&access_tokens=${encodeURIComponent(tk)}`;
    const r = await fetch(u, { method: 'POST', headers: { 'User-Agent': 'Mozilla/5.0' }, body: fd });
    const j = await r.json();
    if (j.errno !== 0 && j.errno !== undefined) throw new Error('superfile2 errno=' + j.errno);
  }
  const cr = await formPost(`https://${api_domain}/openapi/api/create?access_tokens=${encodeURIComponent(tk)}`, {
    path: remotePath, size: String(buf.length), uploadid: pre.uploadid, block_list: JSON.stringify(md5s), rtype: '1'
  });
  if (cr.errno !== 0) throw new Error('create errno=' + cr.errno);
  return { path: remotePath, fs_id: cr.fs_id };
}
async function downloadLink(remotePath) {
  const tk = await access();
  const { api_domain } = await domains();
  const u = `https://${api_domain}/openapi/api/filemetas?access_tokens=${encodeURIComponent(tk)}&target=${encodeURIComponent(JSON.stringify([remotePath]))}&dlink=1`;
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const j = await r.json();
  if (j.errno !== 0 || !j.info || !j.info[0]) throw new Error('filemetas errno=' + j.errno);
  return decodeURIComponent(j.info[0].dlink);
}
async function quota() {
  const tk = await access();
  const { api_domain } = await domains();
  const r = await fetch(`https://${api_domain}/openapi/api/quota?access_tokens=${encodeURIComponent(tk)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const j = await r.json();
  if (j.errno !== 0) throw new Error('quota errno=' + j.errno);
  return { total: j.total, used: j.used };
}
async function remove(remotePath) {
  const tk = await access();
  const { api_domain } = await domains();
  await formPost(`https://${api_domain}/openapi/api/filemanager?access_tokens=${encodeURIComponent(tk)}&opera=delete`, {
    filelist: JSON.stringify([remotePath])
  });
}
async function authorized() {
  if (!configured()) return { configured: false };
  const t = await tokens();
  return { configured: true, authorized: !!(t.access && t.refresh) };
}

module.exports = {
  attachPool(p) { pool = p || null; },
  configured, authorized, deviceStart, devicePoll, quota, uploadBuffer, downloadLink, remove, splitChunks, sign, md5
};

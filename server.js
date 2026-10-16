// R.D.B. Club — servidor: login + secciones + foro + radio + chat
// Persistencia: Postgres (DATABASE_URL) + Cloudinary; si faltan, modo local (JSON+disco).
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const terabox = require('./terabox');

const PORT = process.env.PORT || process.env.SERVER_PORT || 3000;
const APP_URL = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || ('http://localhost:' + PORT)).replace(/\/$/, '');
const DATA = path.join(__dirname, 'data', 'db.json');
const UP = path.join(__dirname, 'uploads');
const AVD = path.join(UP, 'avatars');
fs.mkdirSync(path.dirname(DATA), { recursive: true });
fs.mkdirSync(UP, { recursive: true });
fs.mkdirSync(AVD, { recursive: true });

const GENRES = ['remember', 'house', 'trance', 'techno', 'dance', 'sesion', 'otro'];
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').slice(0, 2000);
const okEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));

/* ================= SEED secciones ================= */
function seedSections() {
  const S = [];
  const add = (id, name, desc, parent, kind) => S.push({ id, name, desc: desc || '', parent: parent || null, kind, creator: null });
  add('cat-makina', 'MAKINA', '', null, 'cat');
  add('general', 'Makina General', 'El mundo de la música mákina y remember en general.', 'cat-makina', 'music');
  add('rem90', "Remember 90's", 'La época dorada: entra en cada año.', 'cat-makina', 'music');
  for (let y = 1990; y <= 1999; y++) add('y' + y, 'Sección ' + y, 'Temas y sesiones de ' + y + '.', 'rem90', 'music');
  add('rem2000', 'Remember 2000', 'La generación del nuevo siglo.', 'cat-makina', 'music');
  add('y2000', 'Sección 2000', 'Temas y sesiones del 2000.', 'rem2000', 'music');
  add('lanzamientos', 'Lanzamientos y novedades', 'Novedades discográficas, previas, portadas y noticias.', 'cat-makina', 'music');
  add('cat-djs', "DJ's & Producers Zone", '', null, 'cat');
  add('djsworld', "DJ's World", 'Accesorios, técnicas, consejos y anécdotas de cabina.', 'cat-djs', 'board');
  add('produccion', 'Producción', 'Sube tus maquetas y pregunta sobre producción.', 'cat-djs', 'music');
  add('cat-mercado', 'Mercadillo', '', null, 'cat');
  add('ventas', 'Venta', 'Vende discos, flyers, cds, sesiones y merchandising.', 'cat-mercado', 'board');
  add('compra', 'Compra', 'Compra discos, flyers, cds, sesiones y merchandising.', 'cat-mercado', 'board');
  add('cat-multi', 'Multimedia', '', null, 'cat');
  add('tv', 'RDB TV', 'Vídeos subidos y comentarios.', 'cat-multi', 'board');
  add('radiob', 'RDB Radio', 'Pide temas para la radio del club.', 'cat-multi', 'board');
  add('cat-discos', 'Discotecas', '', null, 'cat');
  add('masia', 'Masia', 'Toda la música de la discoteca Masia.', 'cat-discos', 'music');
  add('cat-club', 'Club', '', null, 'cat');
  add('ruegos', 'Pruebas · Ruegos · Preguntas', 'Pide pruebas, ruega canciones y pregunta.', 'cat-club', 'board');
  add('anecdotas', 'Anécdotas', 'Historias de cabina y de pista.', 'cat-club', 'board');
  return S;
}

/* ================= STORE (local JSON o Postgres) ================= */
let pg = null;
let usePg = false;
async function storeInit() {
  if (!process.env.DATABASE_URL) { console.log('[DB] modo local (JSON)'); return; }
  try {
    const { Pool } = require('pg');
    pg = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pg.query('SELECT 1');
    await pg.query(`CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, pass TEXT, admin BOOLEAN DEFAULT false, mod BOOLEAN DEFAULT false, banned BOOLEAN DEFAULT false, verified BOOLEAN DEFAULT false, vtoken TEXT, date TIMESTAMPTZ)`);
    await pg.query(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, email TEXT, date TIMESTAMPTZ)`);
    await pg.query(`CREATE TABLE IF NOT EXISTS sections (id TEXT PRIMARY KEY, name TEXT, description TEXT, parent TEXT, kind TEXT, creator TEXT)`);
    await pg.query(`CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, sectionid TEXT, title TEXT, body TEXT, genre TEXT, price TEXT, contact TEXT, nick TEXT, author TEXT, file TEXT, public_id TEXT, original TEXT, size BIGINT DEFAULT 0, downloads INT DEFAULT 0, views INT DEFAULT 0, date TIMESTAMPTZ)`);
    await pg.query(`CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, post_id TEXT, nick TEXT, text TEXT, date TIMESTAMPTZ)`);
    await pg.query(`CREATE TABLE IF NOT EXISTS chat (id TEXT PRIMARY KEY, nick TEXT, text TEXT, date TIMESTAMPTZ)`);
    await pg.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT`);
    await pg.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT`);
    const c = await pg.query('SELECT COUNT(*)::int AS n FROM sections');
    if (c.rows[0].n === 0) {
      for (const s of seedSections()) {
        await pg.query('INSERT INTO sections (id,name,description,parent,kind,creator) VALUES ($1,$2,$3,$4,$5,$6)', [s.id, s.name, s.desc, s.parent, s.kind, s.creator]);
      }
      console.log('[DB] secciones iniciales creadas');
    }
    usePg = true;
    console.log('[DB] Postgres OK (persistente)');
  } catch (e) {
    console.log('[DB] Postgres no disponible, uso local:', e.message);
    pg = null;
    usePg = false;
  }
}
// ---- local ----
function lload() {
  let db;
  try { db = JSON.parse(fs.readFileSync(DATA, 'utf8')); }
  catch { db = { posts: [], chat: [] }; }
  db.posts = db.posts || [];
  db.chat = db.chat || [];
  db.users = db.users || [];
  db.sessions = db.sessions || {};
  db.users.forEach(u => { if (u.verified == null) u.verified = true; if (u.mod == null) u.mod = false; if (u.banned == null) u.banned = false; });
  if (!db.sections) { db.sections = seedSections(); db.seedV = 2; }
  else if (db.seedV !== 2) {
    const customs = db.sections.filter(s => s.id && !seedSections().find(x => x.id === s.id) && !['musica902000', 'discotecas'].includes(s.id));
    customs.forEach(s => { s.parent = s.parent === 'musica902000' ? 'rem90' : (s.parent === 'discotecas' ? 'cat-discos' : s.parent); });
    db.sections = seedSections().concat(customs);
    db.posts.forEach(p => {
      if (p.sectionId === 'musica902000') p.sectionId = 'general';
      if (p.sectionId === 'discotecas') p.sectionId = 'masia';
      if (p.section === 'canciones') p.sectionId = 'general';
      if (['ventas', 'ruegos', 'anecdotas'].includes(p.section)) p.sectionId = p.section;
      delete p.section;
    });
    db.seedV = 2;
  }
  return db;
}
function lsave(db) { fs.writeFileSync(DATA, JSON.stringify(db)); }
// ---- API unificada (async) ----
const store = {
  async users() {
    if (!usePg) return lload().users;
    return (await pg.query('SELECT email,pass,admin,mod,banned,verified,vtoken,date,display_name,avatar FROM users')).rows;
  },
  async addUser(u) {
    if (!usePg) { const db = lload(); db.users.push(u); lsave(db); return; }
    await pg.query('INSERT INTO users (email,pass,admin,mod,banned,verified,vtoken,date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [u.email, u.pass, !!u.admin, false, false, !!u.verified, u.vtoken || null, u.date || new Date().toISOString()]);
  },
  async patchUser(email, p) {
    if (!usePg) { const db = lload(); const u = db.users.find(x => x.email === email); if (u) Object.assign(u, p); lsave(db); return; }
    const keys = Object.keys(p);
    if (!keys.length) return;
    await pg.query(`UPDATE users SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE email=$1`, [email, ...keys.map(k => p[k])]);
  },
  async sessionGet(t) {
    if (!usePg) return lload().sessions[t] || null;
    const r = await pg.query('SELECT email,date FROM sessions WHERE token=$1', [t]);
    return r.rows[0] || null;
  },
  async sessionPut(t, email) {
    const d = new Date().toISOString();
    if (!usePg) { const db = lload(); db.sessions[t] = { email, date: d }; lsave(db); return; }
    await pg.query('INSERT INTO sessions (token,email,date) VALUES ($1,$2,$3) ON CONFLICT (token) DO UPDATE SET email=$2,date=$3', [t, email, d]);
  },
  async sessionDel(t) {
    if (!usePg) { const db = lload(); delete db.sessions[t]; lsave(db); return; }
    await pg.query('DELETE FROM sessions WHERE token=$1', [t]);
  },
  async sessionsDelByEmail(email) {
    if (!usePg) { const db = lload(); Object.keys(db.sessions).forEach(k => { if (db.sessions[k].email === email) delete db.sessions[k]; }); lsave(db); return; }
    await pg.query('DELETE FROM sessions WHERE email=$1', [email]);
  },
  async sections() {
    if (!usePg) return lload().sections;
    return (await pg.query('SELECT id,name,description AS "desc",parent,kind,creator FROM sections')).rows;
  },
  async addSection(s) {
    if (!usePg) { const db = lload(); db.sections.push(s); lsave(db); return; }
    await pg.query('INSERT INTO sections (id,name,description,parent,kind,creator) VALUES ($1,$2,$3,$4,$5,$6)', [s.id, s.name, s.desc, s.parent, s.kind, s.creator || null]);
  },
  async delSection(id) {
    if (!usePg) { const db = lload(); db.sections = db.sections.filter(s => s.id !== id); lsave(db); return; }
    await pg.query('DELETE FROM sections WHERE id=$1', [id]);
  },
  async posts(filter) {
    let list;
    if (!usePg) {
      list = lload().posts.map(p => ({ ...p, comments: p.comments || [], views: p.views || 0, downloads: p.downloads || 0 }));
    } else {
      const pr = await pg.query('SELECT * FROM posts');
      const cr = await pg.query('SELECT id,post_id,nick,text,date FROM comments');
      const byPost = {};
      cr.rows.forEach(c => { (byPost[c.post_id] = byPost[c.post_id] || []).push({ id: c.id, nick: c.nick, text: c.text, date: c.date }); });
      list = pr.rows.map(p => ({ id: p.id, sectionId: p.sectionid, title: p.title, body: p.body, genre: p.genre, price: p.price, contact: p.contact, nick: p.nick, author: p.author, file: p.file, public_id: p.public_id, original: p.original, size: Number(p.size || 0), downloads: p.downloads || 0, views: p.views || 0, date: p.date, comments: (byPost[p.id] || []).sort((a, b) => new Date(a.date) - new Date(b.date) || (a.id < b.id ? -1 : 1)) }));
    }
    list.sort((a, b) => new Date(b.date) - new Date(a.date) || (a.id < b.id ? -1 : 1));
    if (filter) {
      if (filter.sectionId) list = list.filter(p => p.sectionId === filter.sectionId);
      if (filter.genre) list = list.filter(p => p.genre === filter.genre);
      if (filter.q) list = list.filter(p => (p.title + ' ' + (p.body || '')).toLowerCase().includes(String(filter.q).toLowerCase()));
    }
    return list;
  },
  async addPost(p) {
    if (!usePg) { const db = lload(); db.posts.push({ ...p, comments: [] }); lsave(db); return; }
    await pg.query('INSERT INTO posts (id,sectionid,title,body,genre,price,contact,nick,author,file,public_id,original,size,downloads,views,date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
      [p.id, p.sectionId, p.title, p.body, p.genre || null, p.price || null, p.contact || null, p.nick, p.author, p.file || null, p.public_id || null, p.original || null, p.size || 0, 0, 0, p.date]);
  },
  async findPost(id) {
    return (await store.posts()).find(p => p.id === id) || null;
  },
  async delPost(id) {
    if (!usePg) { const db = lload(); const p = db.posts.find(x => x.id === id); db.posts = db.posts.filter(x => x.id !== id); lsave(db); return p || null; }
    const p = await store.findPost(id);
    await pg.query('DELETE FROM comments WHERE post_id=$1', [id]);
    await pg.query('DELETE FROM posts WHERE id=$1', [id]);
    return p;
  },
  async incPost(id, field) {
    if (!usePg) { const db = lload(); const p = db.posts.find(x => x.id === id); if (p) { p[field] = (p[field] || 0) + 1; lsave(db); return p[field]; } return 0; }
    const r = await pg.query(`UPDATE posts SET ${field}=COALESCE(${field},0)+1 WHERE id=$1 RETURNING ${field}`, [id]);
    return r.rows[0] ? r.rows[0][field] : 0;
  },
  async addComment(postId, c) {
    const id = uid();
    if (!usePg) { const db = lload(); const p = db.posts.find(x => x.id === postId); if (!p) return null; p.comments = p.comments || []; p.comments.push({ id, ...c }); lsave(db); return; }
    await pg.query('INSERT INTO comments (id,post_id,nick,text,date) VALUES ($1,$2,$3,$4,$5)', [id, postId, c.nick, c.text, c.date]);
  },
  async delComment(postId, idx) {
    if (!usePg) {
      const db = lload(); const p = db.posts.find(x => x.id === postId);
      if (!p || !p.comments || !p.comments[idx]) return null;
      const [c] = p.comments.splice(idx, 1); lsave(db); return c;
    }
    const p = await store.findPost(postId);
    if (!p || !p.comments[idx]) return null;
    await pg.query('DELETE FROM comments WHERE id=$1', [p.comments[idx].id]);
    return p.comments[idx];
  },
  async chat() {
    if (!usePg) return lload().chat.slice(-50);
    const r = await pg.query('SELECT nick,text,date FROM chat ORDER BY date DESC, id DESC LIMIT 50');
    return r.rows.reverse();
  },
  async chatPush(item) {
    const id = uid();
    if (!usePg) { const db = lload(); db.chat.push(item); db.chat = db.chat.slice(-50); lsave(db); return; }
    await pg.query('INSERT INTO chat (id,nick,text,date) VALUES ($1,$2,$3,$4)', [id, item.nick, item.text, item.date]);
    await pg.query('DELETE FROM chat WHERE id NOT IN (SELECT id FROM chat ORDER BY date DESC, id DESC LIMIT 50)');
  }
};

function rankFor(n) {
  if (n >= 400) return 'Leyenda';
  if (n >= 150) return 'Veterano';
  if (n >= 50) return 'Habitual';
  if (n >= 10) return 'Socio';
  return 'Novato';
}
function avatarUrl(u) {
  if (!u || !u.avatar) return null;
  if (/^https?:\/\//.test(u.avatar)) return u.avatar;
  return '/avatars/' + u.avatar;
}
function dispName(u) {
  return (u.display_name || u.email.split('@')[0]);
}
let cloud = null;
let useCloud = false;
function filesInit() {
  const cn = process.env.CLOUDINARY_URL;
  const trio = process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET;
  if (cn || trio) {
    try {
      cloud = require('cloudinary').v2;
      if (cn) cloud.config({ secure: true });
      else cloud.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });
      useCloud = true;
      console.log('[FILES] Cloudinary OK (persistente)');
    } catch (e) { console.log('[FILES] Cloudinary fallo, uso disco:', e.message); }
  } else console.log('[FILES] disco local');
}
function uploadToCloud(buffer) {
  return new Promise((resolve, reject) => {
    const up = cloud.uploader.upload_stream({ resource_type: 'auto', folder: 'rdb-club' }, (err, r) => {
      if (err) reject(err);
      else resolve(r);
    });
    up.end(buffer);
  });
}
const diskUpload = multer({
  storage: multer.diskStorage({ destination: UP, filename: (req, file, cb) => cb(null, uid() + path.extname(file.originalname)) }),
  fileFilter: audioFilter, limits: { fileSize: 150 * 1024 * 1024 }
});
const memUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: audioFilter, limits: { fileSize: 150 * 1024 * 1024 }
});
function audioFilter(req, file, cb) {
  const ok = /\.(mp3|wav|ogg|oga|m4a|flac|webm)$/i.test(file.originalname);
  cb(ok ? null : new Error('Solo audio'), ok);
}
async function storeFile(reqFile) {
  if (!useCloud) {
    const name = uid() + path.extname(reqFile.originalname);
    fs.writeFileSync(path.join(UP, name), reqFile.buffer);
    return { file: name, public_id: null, size: reqFile.size };
  }
  const r = await uploadToCloud(reqFile.buffer);
  return { file: r.secure_url, public_id: r.public_id, size: r.bytes || reqFile.size };
}
async function deleteFile(post) {
  try {
    if (post.public_id === 'terabox') { await terabox.remove(post.file); return; }
    if (post.public_id && useCloud) await cloud.uploader.destroy(post.public_id, { resource_type: 'video' }).catch(() => cloud.uploader.destroy(post.public_id));
    else if (post.file && !/^https?:\/\//.test(post.file)) fs.rm(path.join(UP, post.file), { force: true }, () => {});
  } catch {}
}

/* ================= EMAIL ================= */
const SMTP = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 587),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || ''
};
let mailer = null;
if (SMTP.host && SMTP.user && SMTP.pass) {
  mailer = nodemailer.createTransport({ host: SMTP.host, port: SMTP.port, secure: SMTP.port === 465, auth: { user: SMTP.user, pass: SMTP.pass } });
}
async function sendVerifyEmail(email, token, base) {
  const link = `${(base || APP_URL).replace(/\/$/, '')}/verificar.html?t=${token}`;
  if (!mailer) { console.log(`[SIN SMTP] Enlace para ${email}: ${link}`); return false; }
  await mailer.sendMail({
    from: SMTP.from || SMTP.user, to: email,
    subject: 'R.D.B. Club — valida tu email',
    text: `Bienvenido al club. Valida tu cuenta aquí:\n${link}\nSi no te registraste, ignora este correo.`,
    html: `<p>Bienvenido al club.</p><p><a href="${link}">Pulsa aquí para validar tu cuenta</a></p><p>Si no te registraste, ignora este correo.</p>`
  });
  return true;
}

/* ================= APP ================= */
function parseCookies(req) {
  const o = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const i = c.indexOf('=');
    if (i > 0) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return o;
}
async function setSession(res, email) {
  const token = crypto.randomBytes(24).toString('hex');
  await store.sessionPut(token, email);
  res.setHeader('Set-Cookie', `rdb_sess=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`);
}
async function me(req) {
  const t = parseCookies(req).rdb_sess;
  if (!t) return null;
  const s = await store.sessionGet(t);
  if (!s) return null;
  const users = await store.users();
  const u = users.find(x => x.email === s.email);
  return u ? { email: u.email, admin: !!u.admin } : null;
}
const needAuth = async (req, res, next) => {
  const u = await me(req);
  if (!u) return res.status(401).json({ error: 'Entra con tu cuenta' });
  const users = await store.users();
  const full = users.find(x => x.email === u.email);
  if (!full || full.banned) return res.status(403).json({ error: 'Cuenta bloqueada. Contacta con el dueño.' });
  req.user = { email: full.email, admin: !!full.admin };
  next();
};
const needAdmin = async (req, res, next) => {
  const u = await me(req);
  if (!u || !u.admin) return res.status(403).json({ error: 'Solo el dueño' });
  req.user = u;
  next();
};

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
process.on('unhandledRejection', e => console.log('[ERR]', (e && e.message) || e));

// ---- Auth ----
app.post('/api/register', async (req, res) => {
  const { email, pass } = req.body || {};
  const em = String(email || '').trim().toLowerCase();
  if (!okEmail(em)) return res.status(400).json({ error: 'Email inválido' });
  if (!pass || String(pass).length < 6) return res.status(400).json({ error: 'Clave mínima 6 caracteres' });
  const users = await store.users();
  if (users.find(u => u.email === em)) return res.status(400).json({ error: 'Ese email ya está registrado' });
  const admin = users.length === 0 || ADMIN_EMAILS.includes(em);
  await store.addUser({ email: em, pass: bcrypt.hashSync(String(pass), 10), admin, verified: false, vtoken: crypto.randomBytes(24).toString('hex'), date: new Date().toISOString() });
  const created = (await store.users()).find(u => u.email === em);
  const base = `${req.protocol}://${req.get('host')}`;
  const sent = await sendVerifyEmail(em, created.vtoken, base).catch(e => { console.log('[SMTP ERROR]', e.message); return false; });
  res.json({ ok: true, email: em, sent });
});
app.post('/api/verify', async (req, res) => {
  const { token } = req.body || {};
  const users = await store.users();
  const u = users.find(x => x.vtoken === token);
  if (!u) return res.status(400).json({ error: 'Enlace inválido o ya usado' });
  await store.patchUser(u.email, { verified: true, vtoken: null });
  await setSession(res, u.email);
  res.json({ ok: true, email: u.email });
});
app.post('/api/resend', async (req, res) => {
  const em = String((req.body || {}).email || '').trim().toLowerCase();
  const users = await store.users();
  const u = users.find(x => x.email === em);
  if (!u) return res.json({ ok: true });
  if (u.verified) return res.json({ ok: true, already: true });
  const vtoken = crypto.randomBytes(24).toString('hex');
  await store.patchUser(em, { vtoken });
  const base = `${req.protocol}://${req.get('host')}`;
  await sendVerifyEmail(em, vtoken, base).catch(() => {});
  res.json({ ok: true });
});
app.post('/api/validate', needAdmin, async (req, res) => {
  const em = String((req.body || {}).email || '').trim().toLowerCase();
  const users = await store.users();
  if (!users.find(x => x.email === em)) return res.status(404).json({ error: 'No existe' });
  await store.patchUser(em, { verified: true, vtoken: null });
  res.json({ ok: true });
});
app.post('/api/login', async (req, res) => {
  const { email, pass } = req.body || {};
  const em = String(email || '').trim().toLowerCase();
  const users = await store.users();
  const u = users.find(x => x.email === em);
  if (!u || !bcrypt.compareSync(String(pass || ''), u.pass)) return res.status(401).json({ error: 'Email o clave mal' });
  if (!u.verified) return res.status(403).json({ error: 'Valida tu email primero. Revisa tu correo.', needVerify: true });
  if (u.banned) return res.status(403).json({ error: 'Cuenta bloqueada. Contacta con el dueño.' });
  await setSession(res, em);
  res.json({ ok: true, email: em, admin: !!u.admin });
});
app.post('/api/logout', async (req, res) => {
  const t = parseCookies(req).rdb_sess;
  if (t) await store.sessionDel(t);
  res.setHeader('Set-Cookie', 'rdb_sess=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/me', async (req, res) => {
  const u = await me(req);
  if (!u) return res.json({ email: null });
  const users = await store.users();
  const f = users.find(x => x.email === u.email) || {};
  res.json({ email: u.email, admin: u.admin, name: dispName({ ...f, email: u.email }), avatar: avatarUrl(f) });
});
app.get('/api/nicks', needAuth, async (req, res) => {
  const users = await store.users();
  const posts = await store.posts();
  res.json(users.filter(u => !u.banned).map(u => {
    const disp = dispName(u);
    const pref = u.email.split('@')[0];
    let m = 0;
    posts.forEach(p => {
      if (p.author === u.email) m++;
      (p.comments || []).forEach(c => { if (c.nick === disp || c.nick === pref) m++; });
    });
    return { email: u.email, nick: disp, avatar: avatarUrl(u), messages: m, rank: rankFor(m) };
  }));
});
app.post('/api/profile', needAuth, async (req, res) => {
  const name = String((req.body || {}).name || '').trim().slice(0, 30);
  if (name.length < 2) return res.status(400).json({ error: 'Nombre de 2 a 30 caracteres' });
  await store.patchUser(req.user.email, { display_name: name });
  res.json({ ok: true, name });
});
const imgUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ok = /\.(png|jpe?g|gif|webp)$/i.test(file.originalname) && /^image\//.test(file.mimetype);
    cb(ok ? null : new Error('Solo imagen png/jpg/gif/webp'), ok);
  },
  limits: { fileSize: 2 * 1024 * 1024 }
});
app.post('/api/avatar', needAuth, (req, res, next) => {
  imgUpload.single('avatar')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message || 'Fallo la subida' });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Elige una imagen' });
  const users = await store.users();
  const old = users.find(x => x.email === req.user.email);
  let ref;
  if (useCloud) {
    const r = await uploadToCloud(req.file.buffer).catch(() => null);
    if (!r) return res.status(500).json({ error: 'No se pudo subir' });
    ref = r.secure_url;
  } else {
    const ext = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' })[req.file.mimetype] || '.png';
    ref = uid() + ext;
    fs.writeFileSync(path.join(AVD, ref), req.file.buffer);
  }
  if (old && old.avatar && !/^https?:\/\//.test(old.avatar)) fs.rm(path.join(AVD, old.avatar), { force: true }, () => {});
  await store.patchUser(req.user.email, { avatar: ref });
  res.json({ ok: true, avatar: useCloud ? ref : '/avatars/' + ref });
});
app.use('/avatars', express.static(AVD));

// ---- Moderación y usuarios ----
app.get('/api/users', needAdmin, async (req, res) => {
  res.json((await store.users()).map(u => ({ email: u.email, admin: !!u.admin, mod: !!u.mod, banned: !!u.banned, verified: !!u.verified, date: u.date })));
});
app.get('/api/staff', needAuth, async (req, res) => {
  res.json((await store.users()).filter(u => u.admin || u.mod).map(u => ({ nick: dispName(u), email: u.email, admin: !!u.admin, mod: !!u.mod })));
});
app.post('/api/mods', needAdmin, async (req, res) => {
  const em = String((req.body || {}).email || '').trim().toLowerCase();
  const users = await store.users();
  const u = users.find(x => x.email === em);
  if (!u) return res.status(404).json({ error: 'No existe' });
  if (u.admin) return res.status(400).json({ error: 'Es dueño, no se toca' });
  await store.patchUser(em, { mod: !!((req.body || {}).mod) });
  res.json({ ok: true });
});
app.post('/api/ban', needAuth, async (req, res) => {
  const em = String((req.body || {}).email || '').trim().toLowerCase();
  const banned = !!((req.body || {}).banned);
  const users = await store.users();
  const actor = users.find(x => x.email === req.user.email);
  const t = em.includes('@') ? users.find(x => x.email === em) : users.find(x => x.email.split('@')[0] === em);
  if (!actor || (!actor.admin && !actor.mod)) return res.status(403).json({ error: 'Solo moderación' });
  if (!t) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (t.admin) return res.status(400).json({ error: 'No se puede banear al dueño' });
  if (t.mod && !actor.admin) return res.status(403).json({ error: 'Solo el dueño toca moderadores' });
  if (t.email === actor.email) return res.status(400).json({ error: 'No te puedes banear' });
  await store.patchUser(t.email, { banned });
  if (banned) await store.sessionsDelByEmail(t.email);
  res.json({ ok: true });
});
app.get('/api/stats', needAuth, async (req, res) => {
  const users = await store.users();
  const posts = await store.posts();
  res.json({
    users: users.length,
    posts: posts.length,
    messages: posts.reduce((a, p) => a + 1 + (p.comments || []).length, 0),
    newest: users.length ? users[users.length - 1].email.split('@')[0] : '—'
  });
});

// ---- TeraBox (admin) ----
app.get('/api/terabox/status', needAdmin, async (req, res) => {
  try {
    const a = await terabox.authorized();
    let quota = null;
    if (a.authorized) quota = await terabox.quota().catch(() => null);
    res.json({ ...a, quota });
  } catch (e) { res.json({ configured: terabox.configured(), authorized: false, error: e.message }); }
});
app.post('/api/terabox/device', needAdmin, async (req, res) => {
  try { res.json({ ok: true, ...(await terabox.deviceStart()) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/terabox/poll', needAdmin, async (req, res) => {
  try { res.json(await terabox.devicePoll((req.body || {}).device_code)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// ---- Secciones ----
app.get('/api/sections', needAuth, async (req, res) => {
  res.json(await store.sections());
});
app.post('/api/sections', needAuth, async (req, res) => {
  const { name, parent, kind } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Falta nombre' });
  const sections = await store.sections();
  if (parent && !sections.find(s => s.id === parent)) return res.status(400).json({ error: 'Padre inválido' });
  const mine = sections.filter(s => s.creator === req.user.email).length;
  if (!req.user.admin && mine >= 10) return res.status(400).json({ error: 'Límite: 10 secciones por usuario' });
  const sec = { id: uid(), name: esc(name).slice(0, 80), desc: '', parent: parent || null, kind: kind === 'board' ? 'board' : 'music', creator: req.user.email };
  await store.addSection(sec);
  res.json({ ok: true, section: sec });
});
app.delete('/api/sections/:id', needAdmin, async (req, res) => {
  const sections = await store.sections();
  if (!sections.find(s => s.id === req.params.id)) return res.status(404).json({ error: 'No existe' });
  if (sections.some(s => s.parent === req.params.id)) return res.status(400).json({ error: 'Tiene subsecciones dentro' });
  if ((await store.posts({})).some(p => p.sectionId === req.params.id)) return res.status(400).json({ error: 'Tiene temas, bórralos antes' });
  await store.delSection(req.params.id);
  res.json({ ok: true });
});

// ---- Foro (login obligatorio) ----
app.get('/foro.html', async (req, res, next) => {
  if (!(await me(req))) return res.redirect('/login.html');
  next();
});
app.get('/api/meta', needAuth, async (req, res) => res.json({ genres: GENRES }));
app.get('/api/posts', needAuth, async (req, res) => {
  const { sectionId, genre, q } = req.query;
  const list = await store.posts({ sectionId: sectionId || undefined, genre: genre || undefined, q: q || undefined });
  res.json(list.map(p => ({
    ...p,
    file: p.file ? (useCloud ? p.file : '/dl/' + p.id) : undefined,
    stream: p.file ? (useCloud ? p.file : '/stream/' + p.id) : undefined
  })));
});
const up = () => memUpload;
app.post('/api/posts', needAuth, (req, res, next) => {
  up().single('audio')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message || 'Fallo la subida' });
    next();
  });
}, async (req, res) => {
  const sections = await store.sections();
  const { sectionId, title, body, genre, price, contact } = req.body;
  const sec = sections.find(s => s.id === sectionId);
  if (!sec) return res.status(400).json({ error: 'Sección inválida' });
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Falta título' });
  if (sec.kind === 'music' && !req.file) return res.status(400).json({ error: 'Sube el audio (mp3/wav/ogg/m4a)' });  let stored = {};
  try {
    if (req.file) {
      const buf = req.file.buffer;
      let tbOn = false;
      try { tbOn = (await terabox.authorized()).authorized; } catch {}
      if (tbOn) {
        const safe = req.file.originalname.replace(/[^\w.\-() ]+/g, '_').slice(0, 80);
        const rp = '/RDB Club/' + Date.now() + '-' + safe;
        await terabox.uploadBuffer(buf, rp);
        stored = { file: rp, public_id: 'terabox', size: req.file.size };
      } else if (useCloud) {
        const r = await storeFile(req.file);
        stored = { file: r.file, public_id: r.public_id, size: r.size };
      } else {
        const name = uid() + path.extname(req.file.originalname);
        fs.writeFileSync(path.join(UP, name), buf);
        stored = { file: name, public_id: null, size: req.file.size };
      }
    }
  } catch (e) { return res.status(500).json({ error: 'No se pudo guardar el audio' }); }
  const postAuthor = ((await store.users()).find(x => x.email === req.user.email)) || { email: req.user.email };
  const post = {
    id: uid(), sectionId, title: esc(title), body: esc(body),
    genre: req.file ? (GENRES.includes(genre) ? genre : 'otro') : undefined,
    price: ['ventas', 'compra'].includes(sec.id) ? esc(price) : undefined,
    contact: ['ventas', 'compra'].includes(sec.id) ? esc(contact) : undefined,
    nick: dispName(postAuthor),
    author: req.user.email,
    file: stored.file, public_id: stored.public_id, original: req.file ? req.file.originalname : undefined,
    size: stored.size || 0,
    downloads: 0, views: 0, date: new Date().toISOString()
  };
  await store.addPost(post);
  res.json({ ok: true, id: post.id });
});
app.post('/api/posts/:id/view', needAuth, async (req, res) => {
  const p = await store.findPost(req.params.id);
  if (!p) return res.status(404).json({ error: 'No existe' });
  const views = await store.incPost(req.params.id, 'views');
  res.json({ ok: true, views });
});
app.post('/api/comments', needAuth, async (req, res) => {
  const { postId, text } = req.body || {};
  const p = await store.findPost(postId);
  if (!p || !text || !String(text).trim()) return res.status(400).json({ error: 'Datos inválidos' });
  const commenter = ((await store.users()).find(x => x.email === req.user.email)) || { email: req.user.email };
  await store.addComment(postId, { nick: dispName(commenter), text: esc(text).slice(0, 500), date: new Date().toISOString() });
  res.json({ ok: true });
});
app.delete('/api/comments', needAuth, async (req, res) => {
  const { postId, idx } = req.body || {};
  const p = await store.findPost(postId);
  if (!p || !p.comments || !p.comments[idx]) return res.status(404).json({ error: 'No existe' });
  const users = await store.users();
  const u = users.find(x => x.email === req.user.email);
  const own = u && (p.comments[idx].nick === dispName(u) || p.comments[idx].nick === u.email.split('@')[0]);
  if (!u || (!u.admin && !u.mod && !own)) return res.status(403).json({ error: 'Sin permiso' });
  await store.delComment(postId, idx);
  res.json({ ok: true });
});
app.delete('/api/posts/:id', needAuth, async (req, res) => {
  const p = await store.findPost(req.params.id);
  if (!p) return res.status(404).json({ error: 'No existe' });
  const users = await store.users();
  const u = users.find(x => x.email === req.user.email);
  const own = p.author === req.user.email || (!p.author && p.nick === req.user.email.split('@')[0]);
  if (!u || (!u.admin && !u.mod && !own)) return res.status(403).json({ error: 'Solo el autor o moderación' });
  await store.delPost(req.params.id);
  await deleteFile(p);
  res.json({ ok: true });
});
app.get('/dl/:id', needAuth, async (req, res) => {
  const p = await store.findPost(req.params.id);
  if (!p || !p.file) return res.status(404).send('No existe');
  await store.incPost(req.params.id, 'downloads');
  if (p.public_id === 'terabox') {
    try { return res.redirect(await terabox.downloadLink(p.file)); }
    catch { return res.status(502).send('TeraBox no disponible'); }
  }
  if (useCloud) return res.redirect(p.file);
  res.download(path.join(UP, p.file), p.original || p.file);
});
app.get('/stream/:id', async (req, res) => {
  const p = await store.findPost(req.params.id);
  if (!p || !p.file) return res.status(404).send('No existe');
  if (p.public_id === 'terabox') {
    try { return res.redirect(await terabox.downloadLink(p.file)); }
    catch { return res.status(502).send('TeraBox no disponible'); }
  }
  if (useCloud) return res.redirect(p.file);
  res.sendFile(path.join(UP, p.file));
});
app.get('/api/radio', async (req, res) => {
  const sections = await store.sections();
  const musicIds = new Set(sections.filter(s => s.kind === 'music').map(s => s.id));
  res.json((await store.posts()).filter(p => p.file && musicIds.has(p.sectionId))
    .map(p => ({ id: p.id, title: p.title, genre: p.genre, url: useCloud ? p.file : '/stream/' + p.id })));
});

// Radios remember online (verificadas). Proxy propio para http/contenido-mixto.
const RADIOS = [
  { id: 'remember-radio', name: 'Remember Radio', url: 'https://sm2.streamingmovil.com/proxy/webrr?mp=/WEBRR' },
  { id: 'java-radio', name: 'Java Radio Remember', url: 'https://stream.zeno.fm/6t6bmeznwtzuv', direct: true },
  { id: 'makina-fm', name: 'Makina FM', url: 'https://stream.zeno.fm/roqewn7dp4gtv', direct: true },
  { id: 'remember-vip', name: 'Remember Vip Dance', url: 'https://stream.zeno.fm/471az1pu2nhvv', direct: true },
  { id: 'mdt', name: 'MDT Radio', url: 'https://streams1.mdtradio.com:8443/mdtnewapp' },
  { id: 'loca', name: 'Loca FM Remember', url: 'https://s2.we4stream.com/listen/loca_remember/live' },
  { id: 'efecto', name: 'Efecto FM', url: 'http://directo.efectofm.es:19000/;stream.nsv' },
  { id: 'bikini', name: 'Bikini FM', url: 'https://stream.emisorasmusicales.net/listen/bikini_fm/bikinifm.mp3' }
];
app.get('/api/radios', (req, res) => res.json(RADIOS.map(r => r.direct ? { id: r.id, name: r.name, url: r.url } : { id: r.id, name: r.name })));
app.get('/api/radio-stream/:id', (req, res) => {
  const r = RADIOS.find(x => x.id === req.params.id);
  if (!r || r.direct) return res.status(404).send('No existe');
  const lib = r.url.startsWith('https') ? require('https') : require('http');
  const proxy = lib.get(r.url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Icy-MetaData': '0' } }, upstream => {
    if (upstream.statusCode !== 200) { res.status(502).send('Radio no disponible'); upstream.resume(); return; }
    res.writeHead(200, { 'Content-Type': upstream.headers['content-type'] || 'audio/mpeg', 'Cache-Control': 'no-cache', 'Connection': 'close' });
    upstream.pipe(res);
  });
  proxy.on('error', () => { if (!res.headersSent) res.status(502).send('Radio no disponible'); else res.end(); });
  req.on('close', () => proxy.destroy());
});

app.use(express.static(path.join(__dirname, 'public')));

// ---- Chat en directo (solo socios: token de un uso) ----
const server = http.createServer(app);
const chatTokens = new Map();
app.get('/api/chat-token', needAuth, (req, res) => {
  const token = crypto.randomBytes(16).toString('hex');
  chatTokens.set(token, { email: req.user.email, date: Date.now() });
  res.json({ ok: true, token });
});
const wss = new WebSocket.Server({ server, path: '/chat' });
let chatHistory = [];
wss.on('connection', async (ws, req) => {
  let t = null;
  try { t = new URL(req.url, 'http://x').searchParams.get('t'); } catch {}
  const rec = t && chatTokens.get(t);
  if (!rec) { try { ws.send(JSON.stringify({ type: 'denied' })); } catch {} ws.close(); return; }
  chatTokens.delete(t);
  const users = await store.users();
  const u = users.find(x => x.email === rec.email);
  if (!u || u.banned || !u.verified) { try { ws.send(JSON.stringify({ type: 'denied' })); } catch {} ws.close(); return; }
  ws.nick = dispName(u);
  ws.send(JSON.stringify({ type: 'history', items: chatHistory }));
  broadcast({ type: 'online', n: wss.clients.size });
  ws.on('message', async raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'msg' && m.text && String(m.text).trim()) {
      const item = { nick: ws.nick, text: esc(m.text).slice(0, 500), date: new Date().toISOString() };
      chatHistory.push(item);
      if (chatHistory.length > 50) chatHistory.shift();
      await store.chatPush(item);
      broadcast({ type: 'msg', ...item });
    }
  });
  ws.on('close', () => broadcast({ type: 'online', n: wss.clients.size }));
});
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

(async () => {
  await storeInit();
  terabox.attachPool(usePg ? pg : null);
  filesInit();
  chatHistory = await store.chat();
  server.listen(PORT, () => console.log('RDB Club en puerto ' + PORT + (usePg ? ' [PG]' : ' [local]') + (useCloud ? ' [cloud]' : '')));
})();

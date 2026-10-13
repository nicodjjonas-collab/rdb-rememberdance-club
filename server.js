// R.D.B. Club — servidor: login + secciones anidadas + foro + radio + chat
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const APP_URL = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || ('http://localhost:' + PORT)).replace(/\/$/, '');
const SMTP = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 587),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || ''
};
let mailer = null;
if (SMTP.host && SMTP.user && SMTP.pass) {
  mailer = nodemailer.createTransport({
    host: SMTP.host, port: SMTP.port, secure: SMTP.port === 465,
    auth: { user: SMTP.user, pass: SMTP.pass }
  });
}
async function sendVerifyEmail(email, token) {
  const link = `${APP_URL}/verificar.html?t=${token}`;
  if (!mailer) {
    console.log(`[SIN SMTP] Enlace de verificación para ${email}: ${link}`);
    return false;
  }
  await mailer.sendMail({
    from: SMTP.from || SMTP.user,
    to: email,
    subject: 'R.D.B. Club — valida tu email',
    text: `Bienvenido al club. Valida tu cuenta aquí:\n${link}\nSi no te registraste, ignora este correo.`,
    html: `<p>Bienvenido al club.</p><p><a href="${link}">Pulsa aquí para validar tu cuenta</a></p><p>Si no te registraste, ignora este correo.</p>`
  });
  return true;
}
const DATA = path.join(__dirname, 'data', 'db.json');
const UP = path.join(__dirname, 'uploads');
fs.mkdirSync(path.dirname(DATA), { recursive: true });
fs.mkdirSync(UP, { recursive: true });

const GENRES = ['remember', 'house', 'trance', 'techno', 'dance', 'sesion', 'otro'];
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function load() {
  let db;
  try { db = JSON.parse(fs.readFileSync(DATA, 'utf8')); }
  catch { db = { posts: [], chat: [] }; }
  db.posts = db.posts || [];
  db.chat = db.chat || [];
  db.users = db.users || [];
  db.users.forEach(u => { if (u.verified == null) u.verified = true; if (u.mod == null) u.mod = false; if (u.banned == null) u.banned = false; }); // cuentas anteriores, validadas
  db.sessions = db.sessions || {};
  if (!db.sections) { db.sections = seedSections(); migratePosts(db); db.seedV = 2; save(db); }
  else if (db.seedV !== 2) { upgradeSeed(db); db.seedV = 2; save(db); }
  return db;
}
function save(db) { fs.writeFileSync(DATA, JSON.stringify(db)); }

function seedSections() {
  // v2 estilo clásico: categorías + tablones + subsecciones
  const S = [];
  const add = (id, name, desc, parent, kind) => S.push({ id, name, desc: desc || '', parent: parent || null, kind });
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
const OLD_SEED_IDS = ['musica902000', 'discotecas', 'masia', 'general', 'ventas', 'ruegos', 'anecdotas',
  'y1990', 'y1991', 'y1992', 'y1993', 'y1994', 'y1995', 'y1996', 'y1997', 'y1998', 'y1999', 'y2000'];
function upgradeSeed(db) {
  const customs = db.sections.filter(s => !OLD_SEED_IDS.includes(s.id));
  const remapParent = p => (p === 'musica902000' ? 'rem90' : (p === 'discotecas' ? 'cat-discos' : p));
  customs.forEach(s => { s.parent = remapParent(s.parent); });
  db.sections = seedSections().concat(customs);
  db.posts.forEach(p => {
    if (p.sectionId === 'musica902000') p.sectionId = 'general';
    if (p.sectionId === 'discotecas') p.sectionId = 'masia';
  });
}
function migratePosts(db) {
  const map = { canciones: 'general', ventas: 'ventas', ruegos: 'ruegos', anecdotas: 'anecdotas' };
  db.posts.forEach(p => {
    p.sectionId = (map[p.section] || 'general');
    delete p.section;
  });
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').slice(0, 2000);
const okEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));
function parseCookies(req) {
  const o = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const i = c.indexOf('=');
    if (i > 0) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return o;
}
function setSession(res, email) {
  const db = load();
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { email, date: new Date().toISOString() };
  save(db);
  res.setHeader('Set-Cookie', `rdb_sess=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`);
}
function me(req) {
  const t = parseCookies(req).rdb_sess;
  if (!t) return null;
  const db = load();
  const s = db.sessions[t];
  if (!s) return null;
  const u = db.users.find(x => x.email === s.email);
  return u ? { email: u.email, admin: !!u.admin } : null;
}
const needAuth = (req, res, next) => {
  const u = me(req);
  if (!u) return res.status(401).json({ error: 'Entra con tu cuenta' });
  const db = load();
  const full = db.users.find(x => x.email === u.email);
  if (!full || full.banned) return res.status(403).json({ error: 'Cuenta bloqueada. Contacta con el dueño.' });
  req.user = { email: full.email, admin: !!full.admin };
  next();
};
const needAdmin = (req, res, next) => {
  const u = me(req);
  if (!u || !u.admin) return res.status(403).json({ error: 'Solo admin' });
  req.user = u;
  next();
};

const audioFilter = (req, file, cb) => {
  const ok = /\.(mp3|wav|ogg|oga|m4a|flac|webm)$/i.test(file.originalname);
  cb(ok ? null : new Error('Solo audio'), ok);
};
const upload = multer({
  storage: multer.diskStorage({
    destination: UP,
    filename: (req, file, cb) => cb(null, uid() + path.extname(file.originalname))
  }),
  fileFilter: audioFilter,
  limits: { fileSize: 150 * 1024 * 1024 }
});

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---- Auth ----
app.post('/api/register', async (req, res) => {
  const { email, pass } = req.body || {};
  const em = String(email || '').trim().toLowerCase();
  if (!okEmail(em)) return res.status(400).json({ error: 'Email inválido' });
  if (!pass || String(pass).length < 6) return res.status(400).json({ error: 'Clave mínima 6 caracteres' });
  const db = load();
  if (db.users.find(u => u.email === em)) return res.status(400).json({ error: 'Ese email ya está registrado' });
  const admin = db.users.length === 0 || ADMIN_EMAILS.includes(em);
  db.users.push({ email: em, pass: bcrypt.hashSync(String(pass), 10), admin, verified: false, vtoken: crypto.randomBytes(24).toString('hex'), date: new Date().toISOString() });
  save(db);
  const sent = await sendVerifyEmail(em, db.users.find(u => u.email === em).vtoken).catch(e => {
    console.log('[SMTP ERROR]', e.message);
    return false;
  });
  res.json({ ok: true, email: em, sent });
});
app.post('/api/verify', (req, res) => {
  const { token } = req.body || {};
  const db = load();
  const u = db.users.find(x => x.vtoken === token);
  if (!u) return res.status(400).json({ error: 'Enlace inválido o ya usado' });
  u.verified = true;
  delete u.vtoken;
  save(db);
  setSession(res, u.email);
  res.json({ ok: true, email: u.email });
});
app.post('/api/resend', async (req, res) => {
  const em = String((req.body || {}).email || '').trim().toLowerCase();
  const db = load();
  const u = db.users.find(x => x.email === em);
  if (!u) return res.json({ ok: true });
  if (u.verified) return res.json({ ok: true, already: true });
  u.vtoken = crypto.randomBytes(24).toString('hex');
  save(db);
  await sendVerifyEmail(em, u.vtoken).catch(() => {});
  res.json({ ok: true });
});
app.post('/api/login', (req, res) => {
  const { email, pass } = req.body || {};
  const em = String(email || '').trim().toLowerCase();
  const db = load();
  const u = db.users.find(x => x.email === em);
  if (!u || !bcrypt.compareSync(String(pass || ''), u.pass)) return res.status(401).json({ error: 'Email o clave mal' });
  if (!u.verified) return res.status(403).json({ error: 'Valida tu email primero. Revisa tu correo.', needVerify: true });
  if (u.banned) return res.status(403).json({ error: 'Cuenta bloqueada. Contacta con el dueño.' });
  setSession(res, em);
  res.json({ ok: true, email: em, admin: !!u.admin });
});
app.post('/api/logout', (req, res) => {
  const t = parseCookies(req).rdb_sess;
  if (t) { const db = load(); delete db.sessions[t]; save(db); }
  res.setHeader('Set-Cookie', 'rdb_sess=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => {
  const u = me(req);
  res.json(u || { email: null });
});
app.get('/api/stats', needAuth, (req, res) => {
  const db = load();
  const posts = db.posts.length;
  const messages = db.posts.reduce((a, p) => a + 1 + (p.comments || []).length, 0);
  const newest = db.users.length ? db.users[db.users.length - 1].email.split('@')[0] : '—';
  res.json({ users: db.users.length, posts, messages, newest });
});

// ---- Moderación y usuarios ----
app.get('/api/users', needAdmin, (req, res) => {
  res.json(load().users.map(u => ({ email: u.email, admin: !!u.admin, mod: !!u.mod, banned: !!u.banned, verified: !!u.verified, date: u.date })));
});
app.get('/api/staff', needAuth, (req, res) => {
  res.json(load().users.filter(u => u.admin || u.mod).map(u => ({ nick: u.email.split('@')[0], admin: !!u.admin, mod: !!u.mod })));
});
app.post('/api/mods', needAdmin, (req, res) => {
  const em = String((req.body || {}).email || '').trim().toLowerCase();
  const db = load();
  const u = db.users.find(x => x.email === em);
  if (!u) return res.status(404).json({ error: 'No existe' });
  if (u.admin) return res.status(400).json({ error: 'Es dueño, no se toca' });
  u.mod = !!((req.body || {}).mod);
  save(db);
  res.json({ ok: true });
});
app.post('/api/ban', needAuth, (req, res) => {
  const em = String((req.body || {}).email || '').trim().toLowerCase();
  const banned = !!((req.body || {}).banned);
  const db = load();
  const actor = db.users.find(x => x.email === req.user.email);
  const t = em.includes('@')
    ? db.users.find(x => x.email === em)
    : db.users.find(x => x.email.split('@')[0] === em);
  if (!actor || (!actor.admin && !actor.mod)) return res.status(403).json({ error: 'Solo moderación' });
  if (!t) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (t.admin) return res.status(400).json({ error: 'No se puede banear al dueño' });
  if (t.mod && !actor.admin) return res.status(403).json({ error: 'Solo el dueño toca moderadores' });
  if (t.email === actor.email) return res.status(400).json({ error: 'No te puedes banear' });
  t.banned = banned;
  if (banned) Object.keys(db.sessions).forEach(k => { if (db.sessions[k].email === t.email) delete db.sessions[k]; });
  save(db);
  res.json({ ok: true });
});
// ---- Secciones ----
app.get('/api/sections', needAuth, (req, res) => {
  res.json(load().sections);
});
app.post('/api/sections', needAuth, (req, res) => {
  const { name, parent, kind } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Falta nombre' });
  const db = load();
  if (parent && !db.sections.find(s => s.id === parent)) return res.status(400).json({ error: 'Padre inválido' });
  const mine = db.sections.filter(s => s.creator === req.user.email).length;
  if (!req.user.admin && mine >= 10) return res.status(400).json({ error: 'Límite: 10 secciones por usuario' });
  const sec = { id: uid(), name: esc(name).slice(0, 80), parent: parent || null, kind: kind === 'board' ? 'board' : 'music', creator: req.user.email };
  db.sections.push(sec);
  save(db);
  res.json({ ok: true, section: sec });
});
app.delete('/api/sections/:id', needAdmin, (req, res) => {
  const db = load();
  const i = db.sections.findIndex(s => s.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'No existe' });
  if (db.sections.some(s => s.parent === req.params.id)) return res.status(400).json({ error: 'Tiene subsecciones dentro' });
  if (db.posts.some(p => p.sectionId === req.params.id)) return res.status(400).json({ error: 'Tiene temas, muévelos o bórralos antes' });
  db.sections.splice(i, 1);
  save(db);
  res.json({ ok: true });
});

// ---- Foro (login obligatorio) ----
app.get('/foro.html', (req, res, next) => {
  if (!me(req)) return res.redirect('/login.html');
  next();
});
app.get('/api/meta', needAuth, (req, res) => res.json({ genres: GENRES }));

app.get('/api/posts', needAuth, (req, res) => {
  const db = load();
  const { sectionId, genre, q } = req.query;
  let list = db.posts.slice().reverse();
  if (sectionId) list = list.filter(p => p.sectionId === sectionId);
  if (genre) list = list.filter(p => p.genre === genre);
  if (q) list = list.filter(p => (p.title + ' ' + (p.body || '')).toLowerCase().includes(String(q).toLowerCase()));
  res.json(list.map(p => ({ ...p, file: p.file ? ('/dl/' + p.id) : undefined, stream: p.file ? ('/stream/' + p.id) : undefined })));
});

app.post('/api/posts', needAuth, upload.single('audio'), (req, res) => {
  const db = load();
  const { sectionId, title, body, genre, price, contact } = req.body;
  const sec = db.sections.find(s => s.id === sectionId);
  if (!sec) return res.status(400).json({ error: 'Sección inválida' });
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Falta título' });
  if (sec.kind === 'music' && !req.file) return res.status(400).json({ error: 'Sube el audio (mp3/wav/ogg/m4a)' });
  const post = {
    id: uid(), sectionId, title: esc(title), body: esc(body),
    genre: req.file ? (GENRES.includes(genre) ? genre : 'otro') : undefined,
    price: ['ventas', 'compra'].includes(sec.id) ? esc(price) : undefined,
    contact: ['ventas', 'compra'].includes(sec.id) ? esc(contact) : undefined,
    nick: req.user.email.split('@')[0],
    author: req.user.email,
    file: req.file ? req.file.filename : undefined,
    original: req.file ? req.file.originalname : undefined,
    size: req.file ? req.file.size : 0,
    downloads: 0, views: 0, comments: [], date: new Date().toISOString()
  };
  db.posts.push(post);
  save(db);
  res.json({ ok: true, id: post.id });
});

app.post('/api/posts/:id/view', needAuth, (req, res) => {
  const db = load();
  const p = db.posts.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'No existe' });
  p.views = (p.views || 0) + 1;
  save(db);
  res.json({ ok: true, views: p.views });
});
app.post('/api/comments', needAuth, (req, res) => {  const db = load();
  const { postId, text } = req.body || {};
  const post = db.posts.find(p => p.id === postId);
  if (!post || !text || !String(text).trim()) return res.status(400).json({ error: 'Datos inválidos' });
  post.comments.push({ nick: req.user.email.split('@')[0], text: esc(text).slice(0, 500), date: new Date().toISOString() });
  save(db);
  res.json({ ok: true });
});
app.delete('/api/comments', needAuth, (req, res) => {
  const { postId, idx } = req.body || {};
  const db = load();
  const p = db.posts.find(x => x.id === postId);
  if (!p || !p.comments || !p.comments[idx]) return res.status(404).json({ error: 'No existe' });
  const u = db.users.find(x => x.email === req.user.email);
  const own = p.comments[idx].nick === req.user.email.split('@')[0];
  if (!u || (!u.admin && !u.mod && !own)) return res.status(403).json({ error: 'Sin permiso' });
  p.comments.splice(idx, 1);
  save(db);
  res.json({ ok: true });
});

app.delete('/api/posts/:id', needAuth, (req, res) => {
  const db = load();
  const i = db.posts.findIndex(p => p.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'No existe' });
  const u = db.users.find(x => x.email === req.user.email);
  const own = db.posts[i].author === req.user.email ||
    (!db.posts[i].author && db.posts[i].nick === req.user.email.split('@')[0]);
  if (!u || (!u.admin && !u.mod && !own)) return res.status(403).json({ error: 'Solo el autor o moderación' });
  const [p] = db.posts.splice(i, 1);
  if (p.file) fs.rm(path.join(UP, p.file), { force: true }, () => {});
  save(db);
  res.json({ ok: true });
});

app.get('/dl/:id', needAuth, (req, res) => {
  const db = load();
  const p = db.posts.find(x => x.id === req.params.id);
  if (!p || !p.file) return res.status(404).send('No existe');
  p.downloads++;
  save(db);
  res.download(path.join(UP, p.file), p.original || p.file);
});

// Radio pública (la escuchan todos)
app.get('/stream/:id', (req, res) => {
  const db = load();
  const p = db.posts.find(x => x.id === req.params.id);
  if (!p || !p.file) return res.status(404).send('No existe');
  res.sendFile(path.join(UP, p.file));
});
app.get('/api/radio', (req, res) => {
  const db = load();
  const musicIds = new Set(db.sections.filter(s => s.kind === 'music').map(s => s.id));
  res.json(db.posts.filter(p => p.file && musicIds.has(p.sectionId)).reverse()
    .map(p => ({ id: p.id, title: p.title, genre: p.genre, url: '/stream/' + p.id })));
});

// Radios remember online (verificadas 13/10/2026). Proxy propio: evita bloqueos https/contenido-mixto.
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
  if (!r) return res.status(404).send('No existe');
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
const history = load().chat.slice(-50);
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}
wss.on('connection', (ws, req) => {
  let t = null;
  try { t = new URL(req.url, 'http://x').searchParams.get('t'); } catch {}
  const rec = t && chatTokens.get(t);
  if (!rec) { try { ws.send(JSON.stringify({ type: 'denied' })); } catch {} ws.close(); return; }
  chatTokens.delete(t);
  const db0 = load();
  const u = db0.users.find(x => x.email === rec.email);
  if (!u || u.banned || !u.verified) { try { ws.send(JSON.stringify({ type: 'denied' })); } catch {} ws.close(); return; }
  ws.nick = rec.email.split('@')[0];
  ws.send(JSON.stringify({ type: 'history', items: history }));
  broadcast({ type: 'online', n: wss.clients.size });
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'msg' && m.text && String(m.text).trim()) {
      const item = { nick: ws.nick, text: esc(m.text).slice(0, 500), date: new Date().toISOString() };
      history.push(item);
      if (history.length > 50) history.shift();
      const db = load(); db.chat = history; save(db);
      broadcast({ type: 'msg', ...item });
    }
  });
  ws.on('close', () => broadcast({ type: 'online', n: wss.clients.size }));
});

server.listen(PORT, () => console.log('RDB Club en puerto ' + PORT));

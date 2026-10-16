// Rich: emotes estilo Twitch (7TV+BTTV globales), GIFs/imágenes, links y YouTube.
const Rich = (() => {
  const emotes = {};
  let _loading = null;
  async function loadEmotes() {
    if (!_loading) {
      _loading = (async () => {
    try {
      const s = await (await fetch('https://7tv.io/v3/emote-sets/global')).json();
      (s.emotes || []).forEach(e => { if (e.name && e.id) emotes[e.name] = `https://cdn.7tv.app/emote/${e.id}/1x.webp`; });
    } catch {}
    try {
      const b = await (await fetch('https://api.betterttv.net/3/cached/emotes/global')).json();
      (Array.isArray(b) ? b : []).forEach(e => { if (e.code && e.id) emotes[e.code] = `https://cdn.betterttv.net/emote/${e.id}/1x`; });
    } catch {}
      })();
    }
    return _loading;
  }
  const ensure = () => loadEmotes();
  const list = () => Object.entries(emotes).map(([code, url]) => ({ code, url }));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function ytId(u) {
    let m = u.match(/(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    return m ? m[1].slice(0, 11) : null;
  }
  const URLRE = /(https?:\/\/[^\s<>"']+)/g;
  const IMGRE = /\.(png|jpe?g|gif|webp)(\?[^\s<>"']*)?$/i;
  function render(raw) {
    const parts = String(raw ?? '').split(URLRE);
    let html = '';
    const tubes = [];
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        // Es URL
        const id = ytId(part);
        if (id) {
          tubes.push(id);
          html += `{{YT${tubes.length - 1}}}`;
        } else if (IMGRE.test(part)) {
          html += `<a href="${esc(part)}" target="_blank" rel="noopener"><img src="${esc(part)}" loading="lazy" style="max-width:220px;max-height:160px;border-radius:8px;display:block;margin:4px 0"></a>`;
        } else {
          const short = part.length > 60 ? part.slice(0, 57) + '…' : part;
          html += `<a href="${esc(part)}" target="_blank" rel="noopener" style="color:var(--cyan)">${esc(short)}</a>`;
        }
      } else {
        let t = esc(part);
        t = t.replace(/:([A-Za-z0-9_]{2,}):/g, (m, code) =>
          emotes[code] ? `<img src="${emotes[code]}" alt="${esc(m)}" title="${esc(m)}" loading="lazy" style="height:28px;vertical-align:middle">` : m);
        html += t;
      }
    });
    tubes.forEach((id, k) => {
      html = html.replace(`{{YT${k}}}`, `<iframe width="100%" height="220" src="https://www.youtube.com/embed/${id}" allowfullscreen loading="lazy" style="border:0;border-radius:10px;margin:6px 0"></iframe>`);
    });
    return html;
  }
  return { loadEmotes, ensure, render, list };
})();

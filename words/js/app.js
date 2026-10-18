(function () {
'use strict';

/* ============================================================================
   WORDS · 朗读室 — 交互层
   ----------------------------------------------------------------------------
   零依赖 ES module。职责：
     · 渲染「今日一句」与条目网格（搜索 / 类型筛选 / 收藏）
     · 抽屉详情 + 深链（#id）+ 上一条 / 下一条
     · 朗读（浏览器内置 speechSynthesis，文本不出本机）
     · 收藏与已读，全部存 localStorage（键前缀 dx_words_）
   ----------------------------------------------------------------------------
   两个容易踩的点，改之前先看：
     1) 抽屉是 hidden + transform 过渡。必须先去掉 hidden，下一帧再加
        .is-on，否则过渡不触发（display 从 none 变 block 不会补间）。
     2) 深链用 replaceState 而不是 hash 赋值：赋值会触发 hashchange，
        在「打开即写 hash」的路径上容易打成自激循环。
   ========================================================================== */

const { ALL, BY_ID } = window.WORDS_DATA;

const LS = {
  theme: 'dx_theme',
  fav: 'dx_words_fav',
  read: 'dx_words_read',
  bi: 'dx_words_bi',
  rate: 'dx_words_rate',
  cloze: 'dx_words_cloze',
};

/* ---------- storage ---------- */
function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw;
  } catch (e) {
    return fallback;
  }
}
function writeLS(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* 隐私模式忽略 */ }
}

const state = {
  q: '',
  tab: 'all',
  favs: new Set(),
  read: new Set(),
  bi: readLS(LS.bi, 'on') !== 'off',
  cloze: readLS(LS.cloze, 'off') === 'on',
  rate: Number(readLS(LS.rate, '1')) || 1,
  currentId: null,
  visible: [],
  todayId: null,
};

(function hydrate() {
  const fav = readLS(LS.fav, '');
  if (fav) fav.split(',').filter(Boolean).forEach((id) => state.favs.add(id));
  const rd = readLS(LS.read, '');
  if (rd) rd.split(',').filter(Boolean).forEach((id) => state.read.add(id));
})();

/* ---------- dom ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const el = {
  grid: $('#grid'),
  empty: $('#empty'),
  emptyTitle: $('#empty-title'),
  emptyDesc: $('#empty-desc'),
  count: $('#result-count'),
  q: $('#q'),
  clear: $('#btn-clear'),
  tabs: document.querySelectorAll('.tabs button'),
  favCount: $('#fav-count'),
  readCount: $('#read-count'),
  cloze: $('#btn-cloze'),
  bilingual: $('#btn-bilingual'),
  theme: $('#btn-theme'),
  todayQuote: $('#today-quote'),
  todayZh: $('#today-zh'),
  todayBy: $('#today-by'),
  shuffle: $('#btn-shuffle'),
  todaySpeak: $('#btn-today-speak'),
  todayOpen: $('#btn-today-open'),
  drawer: $('#drawer'),
  scrim: $('#scrim'),
  dBody: $('#d-body'),
  dBadge: $('#d-badge'),
  dFav: $('#d-fav'),
  dClose: $('#d-close'),
  dPrev: $('#d-prev'),
  dNext: $('#d-next'),
  dShare: $('#d-share'),
  toast: $('#toast'),
  year: $('#year'),
};

/* ---------- utils ---------- */
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let toastTimer = 0;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('is-on'), 1900);
}

function metaOf(item) {
  return item.type === 'speech'
    ? item.occasion
    : `${item.deviceEn} · ${item.topic}`;
}

function titleOf(item) {
  return item.type === 'speech' ? item.speaker : item.device;
}

function quoteOf(item) {
  return item.type === 'speech' ? item.quote : item.passage;
}

function zhOf(item) {
  return item.type === 'speech' ? item.quoteZh : item.passageZh;
}

function badgeOf(item) {
  return item.type === 'speech'
    ? { cls: 'badge-speech', text: `演讲 · ${item.year}` }
    : { cls: 'badge-economist', text: `句式 · ${item.no}` };
}

/* ---------- filtering ---------- */
function haystack(item) {
  const parts = [
    item.speaker, item.speakerZh, item.role, item.title, item.titleZh,
    item.occasion, item.quote, item.quoteZh, item.source,
    item.device, item.deviceEn, item.topic, item.passage, item.passageZh,
    item.why, item.pattern,
    ...(item.tags || []), ...(item.more || []),
    ...(item.vocab || []).map((v) => `${v.w} ${v.zh}`),
    ...(item.notes || []),
    ...(item.takeaways || []),
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function matchQuery(item, q) {
  if (!q) return true;
  const hay = haystack(item);
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}

function filterItems() {
  const q = state.q.trim();
  return ALL.filter((item) => {
    if (state.tab === 'speech' && item.type !== 'speech') return false;
    if (state.tab === 'economist' && item.type !== 'economist') return false;
    if (state.tab === 'fav' && !state.favs.has(item.id)) return false;
    return matchQuery(item, q);
  });
}

/* ---------- quote formatting & copy ---------- */
function copySVG() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
}

function formatQuote(quote, item) {
  const text = esc(quote);
  if (!item.vocab || !item.vocab.length) return text;
  const words = item.vocab.map((v) => v.w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean);
  if (!words.length) return text;
  const regex = new RegExp(`\\b(${words.join('|')})\\b`, 'gi');
  return text.replace(regex, '<span class="cloze-mask" tabindex="0" role="button" aria-label="点击揭开词汇">$1</span>');
}

async function copyQuote(id) {
  const item = BY_ID.get(id);
  if (!item) return;
  const quote = quoteOf(item);
  const zh = zhOf(item);
  const by = item.type === 'speech'
    ? `${item.speaker} · ${item.title} (${item.year})`
    : `${item.device} · ${item.deviceEn} (The Economist 示范句)`;
  const url = `${location.origin}${location.pathname}#${item.id}`;
  const text = `“${quote}”\n\n「${zh}」\n—— ${by}\n${url}`;

  try {
    await navigator.clipboard.writeText(text);
    toast('金句与出处已复制到剪贴板');
  } catch (e) {
    toast('复制失败，请手动选择复制');
  }
}

/* ---------- render: grid ---------- */
function cardHTML(item) {
  const b = badgeOf(item);
  const quote = quoteOf(item);
  const fav = state.favs.has(item.id);
  const short = quote.length < 95 ? ' is-short' : '';
  return `
  <article class="card${state.read.has(item.id) ? ' is-read' : ''}" data-id="${esc(item.id)}" tabindex="0" role="button" aria-label="打开：${esc(titleOf(item))}">
    <div class="card-top">
      <span class="badge ${b.cls}">${esc(b.text)}</span>
      <button type="button" class="icon-btn mini-fav" data-fav="${esc(item.id)}" aria-pressed="${fav}" aria-label="${fav ? '取消收藏' : '收藏'}">${heartSVG(fav)}</button>
    </div>
    <h3 class="card-name">${esc(titleOf(item))}</h3>
    <p class="card-meta">${esc(metaOf(item))}</p>
    <blockquote class="card-quote${short}">${formatQuote(quote, item)}</blockquote>
    <p class="card-zh">${esc(zhOf(item))}</p>
    <ul class="card-tags">${(item.tags || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    <div class="card-foot">
      <div class="card-foot-l">
        <button type="button" class="mini-btn act-speak" data-speak="${esc(item.id)}" aria-label="朗读这一条">
          ${speakerSVG()}朗读
        </button>
        <button type="button" class="mini-btn act-copy" data-copy-quote="${esc(item.id)}" title="复制金句与出处">
          ${copySVG()}复制
        </button>
      </div>
      <div class="card-foot-r">
        <button type="button" class="mini-btn act-open" data-open="${esc(item.id)}">展开</button>
      </div>
    </div>
  </article>`;
}

function heartSVG(filled) {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 20s-7-4.4-7-9.3A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.7C19 15.6 12 20 12 20Z"/></svg>`;
}
function speakerSVG() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>`;
}

function render() {
  state.visible = filterItems();
  const n = state.visible.length;

  el.grid.innerHTML = state.visible.map(cardHTML).join('');
  el.count.textContent = state.q.trim()
    ? `找到 ${n} 条`
    : `共 ${n} 条`;

  el.empty.hidden = n !== 0;
  if (n === 0) {
    const isFav = state.tab === 'fav';
    el.emptyTitle.textContent = isFav ? '还没有收藏' : '没有匹配的条目';
    el.emptyDesc.textContent = isFav
      ? '在任意卡片上点一下心形，就会收进这里。'
      : '换一个关键词，或者回到全部条目看看。';
  }

  // 计数与按钮态
  el.favCount.textContent = String(state.favs.size);
  el.favCount.dataset.empty = state.favs.size === 0 ? '1' : '0';
  el.readCount.textContent = String(state.read.size);
  el.clear.hidden = !state.q;
  el.tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
}

/* ---------- render: today ---------- */
function dailyIndex() {
  const d = new Date();
  const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  return seed % ALL.length;
}

function renderToday(id) {
  const item = BY_ID.get(id) || ALL[dailyIndex()];
  state.todayId = item.id;
  el.todayQuote.textContent = quoteOf(item);
  el.todayZh.textContent = zhOf(item);
  el.todayBy.textContent = item.type === 'speech'
    ? `${item.speaker} · ${item.year}`
    : `${item.device} · ${item.deviceEn}`;
  el.todayOpen.dataset.id = item.id;
}

/* ---------- drawer ---------- */
let closeTimer = 0;
let lastFocus = null;

function drawerHTML(item) {
  const b = badgeOf(item);
  const quote = quoteOf(item);
  const isSpeech = item.type === 'speech';

  const head = isSpeech
    ? `<h2 id="d-title" class="d-title">${esc(item.speaker)}
         <span class="d-title-en">${esc(item.title)} · ${esc(item.speakerZh)}</span>
       </h2>
       <p class="d-sub">${esc(item.role)}　·　${esc(item.occasion)}　·　${esc(item.year)}</p>`
    : `<h2 id="d-title" class="d-title">${esc(item.device)}
         <span class="d-title-en">${esc(item.deviceEn)}</span>
       </h2>
       <p class="d-sub">主题：${esc(item.topic)}　·　第 ${esc(item.no)} 个装置</p>`;

  const body = isSpeech
    ? `<section class="d-sec"><h4>演讲背景</h4><p class="d-body-text">${esc(item.background)}</p></section>
       <section class="d-sec"><h4>可以带走的三个判断</h4>
         <ul class="d-list">${(item.takeaways || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
       </section>`
    : `<section class="d-sec"><h4>为什么这样写有效</h4><p class="d-body-text">${esc(item.why)}</p></section>
       <section class="d-sec"><h4>可复用模板</h4><code class="d-pattern">${esc(item.pattern)}</code></section>`;

  const notes = isSpeech
    ? `<section class="d-sec"><h4>关键词</h4>
         <div class="d-vocab">${(item.vocab || []).map((v) => `
           <div class="d-vocab-row">
             <div class="d-vocab-head"><b>${esc(v.w)}</b><i>${esc(v.p)}</i><span>${esc(v.zh)}</span></div>
             <p class="d-vocab-note">${esc(v.note)}</p>
           </div>`).join('')}</div>
       </section>`
    : `<section class="d-sec"><h4>语言点</h4>
         <ul class="d-list">${(item.notes || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
       </section>`;

  const more = (isSpeech && item.more && item.more.length)
    ? `<section class="d-sec"><h4>同一篇里的其他句子</h4>
         <ul class="d-list is-more">${item.more.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
       </section>`
    : '';

  const source = isSpeech
    ? `<div class="d-source">
         <span>出处：${esc(item.source)}</span>
         ${item.href ? `<a href="${esc(item.href)}" target="_blank" rel="noopener noreferrer">查看原文 ↗</a>` : ''}
       </div>`
    : `<div class="d-source"><span>示范句（按该刊句式重写，非原文转载）· 版权归 The Economist Newspaper Limited 所有</span></div>`;

  return `${head}
    <blockquote class="d-quote${quote.length > 190 ? ' is-long' : ''}">${formatQuote(quote, item)}</blockquote>
    <p class="d-zh">${esc(zhOf(item))}</p>
    <div class="d-tools">
      <button type="button" class="ghost-btn" id="d-speak" data-speak="${esc(item.id)}">${speakerSVG()}朗读这一段</button>
      <button type="button" class="ghost-btn" id="d-copy-quote" data-copy-quote="${esc(item.id)}">${copySVG()}复制金句卡片</button>
      <label class="sr-only" for="d-rate">语速</label>
      <select class="rate-select" id="d-rate">
        <option value="0.8">0.8×</option>
        <option value="1">1.0×</option>
        <option value="1.2">1.2×</option>
      </select>
    </div>
    ${body}${notes}${more}${source}`;
}

function openDrawer(id, opts = {}) {
  const item = BY_ID.get(id);
  if (!item) return;

  if (state.currentId && state.currentId !== id) stopSpeaking();

  state.currentId = id;
  lastFocus = lastFocus || document.activeElement;

  el.dBody.innerHTML = drawerHTML(item);
  const b = badgeOf(item);
  el.dBadge.className = `badge ${b.cls}`;
  el.dBadge.textContent = b.text;
  el.dFav.setAttribute('aria-pressed', String(state.favs.has(id)));
  el.dFav.setAttribute('aria-label', state.favs.has(id) ? '取消收藏这一条' : '收藏这一条');

  const rateSel = $('#d-rate', el.dBody);
  if (rateSel) {
    rateSel.value = String(state.rate);
    rateSel.addEventListener('change', () => {
      state.rate = Number(rateSel.value) || 1;
      writeLS(LS.rate, String(state.rate));
    });
  }

  syncNavButtons();

  clearTimeout(closeTimer);
  el.drawer.hidden = false;
  el.scrim.hidden = false;
  // 先去掉 hidden 再在下一帧加类，过渡才会发生
  requestAnimationFrame(() => {
    el.drawer.classList.add('is-on');
    el.scrim.classList.add('is-on');
    el.dClose.focus({ preventScroll: true });
  });
  document.body.style.overflow = 'hidden';

  markRead(id);
  if (opts.writeHash !== false) {
    try { history.replaceState(null, '', '#' + id); } catch (e) { /* file:// 下可能抛错 */ }
  }
}

function closeDrawer() {
  if (!state.currentId) return;
  stopSpeaking();
  state.currentId = null;
  el.drawer.classList.remove('is-on');
  el.scrim.classList.remove('is-on');
  document.body.style.overflow = '';
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    el.drawer.hidden = true;
    el.scrim.hidden = true;
  }, 380);
  if (lastFocus && lastFocus.focus) {
    try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  lastFocus = null;
}

function currentIndex() {
  const list = state.visible.length ? state.visible : ALL;
  return list.findIndex((x) => x.id === state.currentId);
}

function syncNavButtons() {
  const list = state.visible.length ? state.visible : ALL;
  const i = currentIndex();
  el.dPrev.disabled = i <= 0;
  el.dNext.disabled = i < 0 || i >= list.length - 1;
}

function step(delta) {
  const list = state.visible.length ? state.visible : ALL;
  const i = currentIndex();
  const next = list[i + delta];
  if (next) openDrawer(next.id);
}

function markRead(id) {
  if (state.read.has(id)) return;
  state.read.add(id);
  writeLS(LS.read, Array.from(state.read).join(','));
  el.readCount.textContent = String(state.read.size);
  const card = el.grid.querySelector(`.card[data-id="${cssEscape(id)}"]`);
  if (card) card.classList.add('is-read');
}

function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

function toggleFav(id) {
  if (state.favs.has(id)) {
    state.favs.delete(id);
    toast('已取消收藏');
  } else {
    state.favs.add(id);
    toast('已收藏，可在「收藏」里找到');
  }
  writeLS(LS.fav, Array.from(state.favs).join(','));
  syncFavUI(id);
  if (state.tab === 'fav') render();
  // 收藏/取消会让「收藏」视图的列表长度变化，抽屉里的上一条/下一条要跟着重算
  if (state.currentId) syncNavButtons();
}

function syncFavUI(id) {
  const on = state.favs.has(id);
  const btn = el.grid.querySelector(`[data-fav="${cssEscape(id)}"]`);
  if (btn) {
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? '取消收藏' : '收藏');
    btn.innerHTML = heartSVG(on);
  }
  if (state.currentId === id) {
    el.dFav.setAttribute('aria-pressed', String(on));
    el.dFav.setAttribute('aria-label', on ? '取消收藏这一条' : '收藏这一条');
  }
  el.favCount.textContent = String(state.favs.size);
  el.favCount.dataset.empty = state.favs.size === 0 ? '1' : '0';
}

/* ---------- speech synthesis ---------- */
let voice = null;
let speakKey = null;
let utter = null;

function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const voices = window.speechSynthesis.getVoices() || [];
  if (!voices.length) return;
  const pref = [
    /Google US English/i, /Samantha/i, /Microsoft Aria/i,
    /Microsoft Zira/i, /en[-_]US/i, /^en/i,
  ];
  for (const re of pref) {
    const v = voices.find((x) => re.test(x.name) || re.test(x.lang));
    if (v) { voice = v; return; }
  }
  voice = voices[0];
}

function clearSpeakingUI() {
  document.querySelectorAll('.is-speaking').forEach((n) => n.classList.remove('is-speaking'));
}

function stopSpeaking() {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  speakKey = null;
  clearSpeakingUI();
}

function speak(text, key, btn) {
  if (!('speechSynthesis' in window)) {
    toast('这个浏览器不支持语音合成');
    return;
  }
  const synth = window.speechSynthesis;

  // 同一个按钮再点一次 = 停止
  if (speakKey === key && (synth.speaking || synth.pending)) {
    stopSpeaking();
    return;
  }
  synth.cancel();
  clearSpeakingUI();

  utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-US';
  utter.rate = state.rate;
  utter.pitch = 1;
  if (voice) utter.voice = voice;

  speakKey = key;
  if (btn) btn.classList.add('is-speaking');

  utter.onend = () => { if (speakKey === key) { speakKey = null; clearSpeakingUI(); } };
  utter.onerror = () => { if (speakKey === key) { speakKey = null; clearSpeakingUI(); } };

  synth.speak(utter);
}

if ('speechSynthesis' in window) {
  pickVoice();
  window.speechSynthesis.addEventListener('voiceschanged', pickVoice);
}

/* ---------- events ---------- */
function bind() {
  // 卡片区：处理动作、标签、朗读、复制与挖空
  el.grid.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('[data-copy-quote]');
    if (copyBtn) {
      e.stopPropagation();
      copyQuote(copyBtn.dataset.copyQuote);
      return;
    }

    const clozeSpan = e.target.closest('.cloze-mask');
    if (clozeSpan) {
      e.stopPropagation();
      clozeSpan.classList.toggle('is-revealed');
      return;
    }

    const zhEl = e.target.closest('.card-zh');
    if (zhEl && state.cloze) {
      e.stopPropagation();
      zhEl.classList.toggle('is-revealed');
      return;
    }

    const favBtn = e.target.closest('[data-fav]');
    if (favBtn) { e.stopPropagation(); toggleFav(favBtn.dataset.fav); return; }

    const speakBtn = e.target.closest('[data-speak]');
    if (speakBtn) {
      e.stopPropagation();
      const item = BY_ID.get(speakBtn.dataset.speak);
      if (item) speak(quoteOf(item), 'card:' + item.id, speakBtn);
      return;
    }

    const openBtn = e.target.closest('[data-open]');
    if (openBtn) { e.stopPropagation(); openDrawer(openBtn.dataset.open); return; }

    const tag = e.target.closest('.card-tags li');
    if (tag) {
      e.stopPropagation();
      state.q = tag.textContent.trim();
      el.q.value = state.q;
      render();
      el.grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    const card = e.target.closest('.card');
    if (card) openDrawer(card.dataset.id);
  });

  el.grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.card');
    if (!card || e.target !== card) return;
    e.preventDefault();
    openDrawer(card.dataset.id);
  });

  // 搜索
  let debounce = 0;
  el.q.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.q = el.q.value;
      render();
    }, 90);
  });
  el.clear.addEventListener('click', () => {
    state.q = '';
    el.q.value = '';
    render();
    el.q.focus();
  });

  // 类型筛选
  el.tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tab = btn.dataset.tab;
      render();
    });
  });

  $('#btn-reset').addEventListener('click', () => {
    state.q = '';
    state.tab = 'all';
    el.q.value = '';
    render();
  });

  // 今日一句
  el.shuffle.addEventListener('click', () => {
    let next = ALL[Math.floor(Math.random() * ALL.length)];
    let guard = 0;
    while (next.id === state.todayId && guard++ < 8) {
      next = ALL[Math.floor(Math.random() * ALL.length)];
    }
    renderToday(next.id);
  });
  el.todaySpeak.addEventListener('click', () => {
    const item = BY_ID.get(state.todayId);
    if (item) speak(quoteOf(item), 'today', el.todaySpeak);
  });
  el.todayOpen.addEventListener('click', () => {
    if (state.todayId) openDrawer(state.todayId);
  });

  // 抽屉
  el.dClose.addEventListener('click', closeDrawer);
  el.scrim.addEventListener('click', closeDrawer);
  el.dPrev.addEventListener('click', () => step(-1));
  el.dNext.addEventListener('click', () => step(1));
  el.dFav.addEventListener('click', () => {
    if (state.currentId) toggleFav(state.currentId);
  });
  el.dShare.addEventListener('click', async () => {
    if (!state.currentId) return;
    const url = location.origin + location.pathname + '#' + state.currentId;
    try {
      await navigator.clipboard.writeText(url);
      toast('链接已复制');
    } catch (e) {
      toast('复制失败，请手动复制地址栏');
    }
  });
  el.dBody.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('[data-copy-quote]');
    if (copyBtn) {
      e.stopPropagation();
      copyQuote(copyBtn.dataset.copyQuote);
      return;
    }
    const clozeSpan = e.target.closest('.cloze-mask');
    if (clozeSpan) {
      e.stopPropagation();
      clozeSpan.classList.toggle('is-revealed');
      return;
    }
    const zhEl = e.target.closest('.d-zh');
    if (zhEl && state.cloze) {
      e.stopPropagation();
      zhEl.classList.toggle('is-revealed');
      return;
    }
    const btn = e.target.closest('[data-speak]');
    if (!btn) return;
    const item = BY_ID.get(btn.dataset.speak);
    if (item) speak(quoteOf(item), 'drawer:' + item.id, btn);
  });

  // 主题
  el.theme.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    writeLS(LS.theme, next);
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = next === 'light' ? '#f8fafc' : '#0a0e17';
  });

  // 中英对照
  el.bilingual.addEventListener('click', () => {
    state.bi = !state.bi;
    applyBilingual();
    writeLS(LS.bi, state.bi ? 'on' : 'off');
  });

  // 背诵挖空模式
  if (el.cloze) {
    el.cloze.addEventListener('click', () => {
      state.cloze = !state.cloze;
      applyCloze();
      writeLS(LS.cloze, state.cloze ? 'on' : 'off');
      toast(state.cloze ? '背诵模式已开启（中文与重点生词已遮盖，点击可揭开）' : '背诵模式已关闭');
    });
  }

  // 键盘
  document.addEventListener('keydown', (e) => {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

    if (e.key === 'Escape') {
      if (state.currentId) { closeDrawer(); return; }
      if (state.q) { state.q = ''; el.q.value = ''; render(); return; }
    }

    if (e.key === '/' && !inField) {
      e.preventDefault();
      el.q.focus();
      return;
    }

    if (state.currentId) {
      if (e.key === 'ArrowLeft' && !inField) { e.preventDefault(); step(-1); }
      if (e.key === 'ArrowRight' && !inField) { e.preventDefault(); step(1); }
      if (e.key === 'Tab') trapFocus(e);
    }
  });

  // 外链打开时同步深链
  window.addEventListener('hashchange', () => {
    const id = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (id && BY_ID.has(id) && id !== state.currentId) openDrawer(id, { writeHash: false });
    if (!id && state.currentId) closeDrawer();
  });
}

function trapFocus(e) {
  const focusables = el.drawer.querySelectorAll(
    'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function applyBilingual() {
  document.documentElement.setAttribute('data-bi', state.bi ? 'on' : 'off');
  el.bilingual.setAttribute('aria-pressed', String(state.bi));
  el.bilingual.title = state.bi ? '当前显示中文译文，点击隐藏' : '当前隐藏中文译文，点击显示';
}

function applyCloze() {
  document.documentElement.setAttribute('data-cloze', state.cloze ? 'on' : 'off');
  if (el.cloze) {
    el.cloze.setAttribute('aria-pressed', String(state.cloze));
    el.cloze.title = state.cloze ? '背诵模式已开启（点击关闭，恢复完整显示）' : '切换背诵模式（模糊中文与重点生词，点击即可揭开）';
  }
}

/* ---------- boot ---------- */
function boot() {
  applyBilingual();
  applyCloze();
  el.year.textContent = String(new Date().getFullYear());
  renderToday();
  render();
  bind();

  const id = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (id && BY_ID.has(id)) {
    // 等一帧，让首屏网格先落位，再开抽屉
    requestAnimationFrame(() => openDrawer(id, { writeHash: false }));
  }
}

boot();

})();

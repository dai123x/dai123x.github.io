(function () {
'use strict';

/* ============================================================================
   WORDS · 朗读室 — 交互引擎
   ----------------------------------------------------------------------------
   纯静态零依赖，支持：
     · 双语对照、背诵挖空闪卡自测（Recitation & Cloze Mode）
     · 领域主题胶囊筛选（行动、韧性、科学、商业、科技、人文）
     · 多维排序引擎（默认推荐、篇幅短/长、年代古/今、随机漫步）
     · 本地 Web Speech 语音朗读、句子级高亮跟读与底部悬浮播放器（HUD）
     · 词汇即点即查浮窗与单字发音
     · 句式仿写试验田（本地持久化与仿写朗读）
     · Canvas 2D 高清金句分享海报生成与 PNG 下载
     · 抽屉详情 + 稳定深链（#id）+ 键盘无障碍漫游
   ========================================================================== */

const { ALL, BY_ID } = window.WORDS_DATA;

const LS = {
  theme: 'dx_theme',
  fav: 'dx_words_fav',
  read: 'dx_words_read',
  bi: 'dx_words_bi',
  rate: 'dx_words_rate',
  cloze: 'dx_words_cloze',
  practicePrefix: 'dx_words_practice_',
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
  topic: 'all',
  sort: 'default',
  favs: new Set(),
  read: new Set(),
  bi: readLS(LS.bi, 'on') !== 'off',
  cloze: readLS(LS.cloze, 'off') === 'on',
  rate: Number(readLS(LS.rate, '1')) || 1,
  currentId: null,
  posterId: null,
  visible: [],
  todayId: null,
  speakingId: null,
  speakingText: '',
  activeSentenceIdx: -1,
  isPaused: false,
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
  sortSelect: $('#sort-select'),
  topicBar: $('#topic-bar'),
  topicPills: document.querySelectorAll('.topic-pill'),
  favCount: $('#fav-count'),
  readCount: $('#read-count'),
  cloze: $('#btn-cloze'),
  bilingual: $('#btn-bilingual'),
  theme: $('#btn-theme'),
  todayQuote: $('#today-quote'),
  todayZh: $('#today-zh'),
  todayBy: $('#today-by'),
  shuffle: $('#btn-shuffle'),
  btnQuiz: $('#btn-quiz'),
  todaySpeak: $('#btn-today-speak'),
  todayOpen: $('#btn-today-open'),
  // 抽屉
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
  // 海报弹窗
  posterModal: $('#poster-modal'),
  posterScrim: $('#poster-scrim'),
  posterCanvas: $('#poster-canvas'),
  posterClose: $('#poster-close'),
  btnDownloadPoster: $('#btn-download-poster'),
  btnCopyPoster: $('#btn-copy-poster'),
  // 底部播放 HUD
  playerHud: $('#player-hud'),
  hudTitle: $('#hud-title'),
  hudReplay: $('#hud-replay'),
  hudPause: $('#hud-pause'),
  hudStop: $('#hud-stop'),
  // 词汇浮窗
  vocabPopover: $('#vocab-popover'),
  vpWord: $('.vp-word', $('#vocab-popover')),
  vpPos: $('.vp-pos', $('#vocab-popover')),
  vpZh: $('.vp-zh', $('#vocab-popover')),
  vpNote: $('.vp-note', $('#vocab-popover')),
  vpSpeak: $('#vp-speak'),
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
  toastTimer = setTimeout(() => el.toast.classList.remove('is-on'), 2200);
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

function heartSVG(filled) {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 20s-7-4.4-7-9.3A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.7C19 15.6 12 20 12 20Z"/></svg>`;
}
function speakerSVG() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>`;
}
function copySVG() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
}
function posterSVG() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
}

/* ---------- topic categorization ---------- */
const TOPIC_KEYWORDS = {
  courage: ['行动', '勇气', '担当', '自驱', '毅力', '责任', '领导力', '初心', '果敢', '信念'],
  resilience: ['逆境', '韧性', '失败', '抗争', '低谷', '坚持', '磨难', '自强', '自省', '平庸', '希望'],
  science: ['科学', '宇宙', '探索', '真理', '求真', '理性', '好奇心', '修辞与思辨'],
  business: ['商业', '宏观', '经济', '竞争', '市场', '周期', '增长', '战略', '宏观叙事', '周期与反转', '市场心理', '政策与干预'],
  tech: ['科技', 'ai', '前沿', '计算机', '创新', '数字', '未来', '科技浪潮'],
  humanity: ['人文', '历史', '语言', '自由', '文学', '同理心', '社会', '尊严', '地缘与权力', '文明'],
};

function matchTopic(item, topicKey) {
  if (topicKey === 'all') return true;
  const keywords = TOPIC_KEYWORDS[topicKey];
  if (!keywords) return true;

  const tags = (item.tags || []).join(' ').toLowerCase();
  const topic = (item.topic || '').toLowerCase();
  const why = (item.why || '').toLowerCase();
  const role = (item.role || '').toLowerCase();

  return keywords.some((kw) => {
    const k = kw.toLowerCase();
    return tags.includes(k) || topic.includes(k) || why.includes(k) || role.includes(k);
  });
}

/* ---------- sorting ---------- */
function sortItems(list, sortKey) {
  const arr = list.slice();
  switch (sortKey) {
    case 'short':
      return arr.sort((a, b) => quoteOf(a).length - quoteOf(b).length);
    case 'long':
      return arr.sort((a, b) => quoteOf(b).length - quoteOf(a).length);
    case 'year-asc':
      return arr.sort((a, b) => (Number(a.year) || 2026) - (Number(b.year) || 2026));
    case 'year-desc':
      return arr.sort((a, b) => (Number(b.year) || 2020) - (Number(a.year) || 2020));
    case 'shuffle':
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    case 'default':
    default:
      return arr;
  }
}

/* ---------- sentence splitting & quote markup ---------- */
function splitQuoteToSentences(quote) {
  if (!quote) return [];
  // 匹配句号、问号、感叹号结尾，带可选引号
  const parts = quote.match(/[^.!?]+[.!?]+["'”’]?|[^.!?]+$/g);
  return parts ? parts.map((s) => s.trim()).filter(Boolean) : [quote];
}

function formatQuoteForCard(quote, item) {
  const text = esc(quote);
  if (!item.vocab || !item.vocab.length) return text;
  const words = item.vocab.map((v) => v.w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean);
  if (!words.length) return text;
  const regex = new RegExp(`\\b(${words.join('|')})\\b`, 'gi');
  return text.replace(regex, '<span class="cloze-mask" tabindex="0" role="button" aria-label="点击揭开词汇" data-word="$1">$1</span>');
}

function formatQuoteForDrawer(quote, item) {
  const sentences = splitQuoteToSentences(quote);
  const vocabWords = (item.vocab || []).map((v) => v.w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean);
  const vocabRegex = vocabWords.length ? new RegExp(`\\b(${vocabWords.join('|')})\\b`, 'gi') : null;

  return sentences.map((sent, idx) => {
    let sEsc = esc(sent);
    if (vocabRegex) {
      sEsc = sEsc.replace(vocabRegex, (match) => {
        return `<span class="read-word-match cloze-mask" data-vocab-word="${esc(match)}" role="button" tabindex="0" title="点击查看释义">${match}</span>`;
      });
    }
    return `<span class="read-sentence" data-sentence-idx="${idx}">${sEsc}</span>`;
  }).join(' ');
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
  const matched = ALL.filter((item) => {
    if (state.tab === 'speech' && item.type !== 'speech') return false;
    if (state.tab === 'economist' && item.type !== 'economist') return false;
    if (state.tab === 'fav' && !state.favs.has(item.id)) return false;
    if (!matchTopic(item, state.topic)) return false;
    return matchQuery(item, q);
  });
  return sortItems(matched, state.sort);
}

/* ---------- copy helper ---------- */
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
    <blockquote class="card-quote${short}">${formatQuoteForCard(quote, item)}</blockquote>
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
      : '换一个领域或关键词，或者重置筛选看看。';
  }

  // 计数与按钮态
  el.favCount.textContent = String(state.favs.size);
  el.favCount.dataset.empty = state.favs.size === 0 ? '1' : '0';
  el.readCount.textContent = String(state.read.size);
  el.clear.hidden = !state.q;
  el.tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  el.topicPills.forEach((p) => p.classList.toggle('is-active', p.dataset.topic === state.topic));
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

/* ---------- drawer & practice field ---------- */
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
    ? `<section class="d-sec"><h4>关键词汇与考点</h4>
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

  // 仿写试验田
  const savedPractice = readLS(LS.practicePrefix + item.id, '');
  const practiceSection = `<section class="d-sec">
    <h4>句式仿写试验田</h4>
    <div class="d-practice-box">
      <textarea class="d-practice-input" id="d-practice-input" placeholder="${isSpeech ? '试着用这段名句的修辞或结构写一句英文...' : '试着用上述句式骨架仿写一句英文...'}" spellcheck="false">${esc(savedPractice)}</textarea>
      <div class="d-practice-actions">
        <button type="button" class="ghost-btn" id="d-practice-speak">🔊 朗读我的仿写</button>
        <button type="button" class="ghost-btn" id="d-practice-copy">📋 复制仿写</button>
        <button type="button" class="ghost-btn" id="d-practice-clear">清空</button>
        <span class="d-practice-hint">已自动保存在本地浏览器</span>
      </div>
    </div>
  </section>`;

  const source = isSpeech
    ? `<div class="d-source">
         <span>出处：${esc(item.source)}</span>
         ${item.href ? `<a href="${esc(item.href)}" target="_blank" rel="noopener noreferrer">查看原文 ↗</a>` : ''}
       </div>`
    : `<div class="d-source"><span>示范句（按该刊句式重写，非原文转载）· 版权归 The Economist Newspaper Limited 所有</span></div>`;

  return `${head}
    <blockquote class="d-quote${quote.length > 190 ? ' is-long' : ''}" id="d-quote-box">${formatQuoteForDrawer(quote, item)}</blockquote>
    <p class="d-zh" id="d-zh-box">${esc(zhOf(item))}</p>
    <div class="d-tools">
      <button type="button" class="ghost-btn" id="d-speak" data-speak="${esc(item.id)}">${speakerSVG()}朗读这一段</button>
      <button type="button" class="ghost-btn" id="d-poster-btn" data-poster="${esc(item.id)}">${posterSVG()}生成海报卡片</button>
      <button type="button" class="ghost-btn" id="d-copy-quote" data-copy-quote="${esc(item.id)}">${copySVG()}复制金句</button>
      <label class="sr-only" for="d-rate">语速</label>
      <select class="rate-select" id="d-rate">
        <option value="0.8">0.8×</option>
        <option value="1">1.0×</option>
        <option value="1.2">1.2×</option>
      </select>
    </div>
    ${body}${notes}${practiceSection}${more}${source}`;
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

  // 绑定仿写持久化
  const practiceInput = $('#d-practice-input', el.dBody);
  if (practiceInput) {
    practiceInput.addEventListener('input', () => {
      writeLS(LS.practicePrefix + id, practiceInput.value);
    });
  }

  syncNavButtons();

  clearTimeout(closeTimer);
  el.drawer.hidden = false;
  el.scrim.hidden = false;
  requestAnimationFrame(() => {
    el.drawer.classList.add('is-on');
    el.scrim.classList.add('is-on');
    el.dClose.focus({ preventScroll: true });
  });
  document.body.style.overflow = 'hidden';

  markRead(id);
  if (opts.writeHash !== false) {
    try { history.replaceState(null, '', '#' + id); } catch (e) { /* ignore */ }
  }
}

function closeDrawer() {
  if (!state.currentId) return;
  hideVocabPopover();
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
    toast('已收藏，可在「收藏」标签中查看');
  }
  writeLS(LS.fav, Array.from(state.favs).join(','));
  syncFavUI(id);
  if (state.tab === 'fav') render();
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

/* ---------- speech synthesis & HUD ---------- */
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
  document.querySelectorAll('.is-active-sentence').forEach((n) => n.classList.remove('is-active-sentence'));
  el.playerHud.classList.remove('is-active', 'is-paused');
  state.isPaused = false;
  state.speakingId = null;
  state.activeSentenceIdx = -1;
  setTimeout(() => {
    if (!state.speakingId) el.playerHud.hidden = true;
  }, 350);
}

function stopSpeaking() {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  speakKey = null;
  clearSpeakingUI();
}

function highlightSentence(idx) {
  if (idx === state.activeSentenceIdx) return;
  state.activeSentenceIdx = idx;
  const oldActive = el.dBody.querySelector('.is-active-sentence');
  if (oldActive) oldActive.classList.remove('is-active-sentence');

  if (idx >= 0) {
    const nextActive = el.dBody.querySelector(`.read-sentence[data-sentence-idx="${idx}"]`);
    if (nextActive) nextActive.classList.add('is-active-sentence');
  }
}

function speak(text, key, btn, itemTitle) {
  if (!('speechSynthesis' in window)) {
    toast('当前浏览器不支持语音合成');
    return;
  }
  const synth = window.speechSynthesis;

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
  state.speakingId = key;
  state.speakingText = text;

  if (btn) btn.classList.add('is-speaking');

  // 悬浮 HUD 状态唤起
  const displayTitle = itemTitle || (key.startsWith('vocab:') ? key.replace('vocab:', '') : '朗读跟读');
  el.hudTitle.textContent = displayTitle;
  el.playerHud.hidden = false;
  requestAnimationFrame(() => el.playerHud.classList.add('is-active'));

  // 句子跟读高亮探测
  const sentences = splitQuoteToSentences(text);
  const sentenceBoundaries = [];
  let curOffset = 0;
  sentences.forEach((s) => {
    sentenceBoundaries.push({ start: curOffset, end: curOffset + s.length });
    curOffset += s.length + 1;
  });

  utter.onboundary = (e) => {
    if (e.name === 'word' || e.name === 'sentence') {
      const charIdx = e.charIndex;
      const sIndex = sentenceBoundaries.findIndex((b) => charIdx >= b.start && charIdx <= b.end);
      if (sIndex !== -1) highlightSentence(sIndex);
    }
  };

  utter.onend = () => {
    if (speakKey === key) {
      speakKey = null;
      clearSpeakingUI();
    }
  };
  utter.onerror = () => {
    if (speakKey === key) {
      speakKey = null;
      clearSpeakingUI();
    }
  };

  synth.speak(utter);
}

if ('speechSynthesis' in window) {
  pickVoice();
  window.speechSynthesis.addEventListener('voiceschanged', pickVoice);
}

/* ---------- vocab popover ---------- */
let currentVocabWord = '';

function showVocabPopover(vocabItem, anchorEl) {
  if (!vocabItem || !anchorEl) return;
  currentVocabWord = vocabItem.w;
  el.vpWord.textContent = vocabItem.w;
  el.vpPos.textContent = vocabItem.p || '';
  el.vpZh.textContent = vocabItem.zh || '';
  el.vpNote.textContent = vocabItem.note || '';

  const rect = anchorEl.getBoundingClientRect();
  const popoverW = 280;
  let left = rect.left + rect.width / 2;
  let top = rect.top - 8;

  // 边界保护
  if (left - popoverW / 2 < 12) left = 12 + popoverW / 2;
  if (left + popoverW / 2 > window.innerWidth - 12) left = window.innerWidth - 12 - popoverW / 2;

  el.vocabPopover.style.left = `${left}px`;
  el.vocabPopover.style.top = `${top}px`;
  el.vocabPopover.hidden = false;
  requestAnimationFrame(() => el.vocabPopover.classList.add('is-open'));
}

function hideVocabPopover() {
  el.vocabPopover.classList.remove('is-open');
  setTimeout(() => {
    if (!el.vocabPopover.classList.contains('is-open')) el.vocabPopover.hidden = true;
  }, 200);
}

/* ---------- canvas poster generator ---------- */
function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 10) {
  const words = text.split(/\s+/);
  let line = '';
  let linesDrawn = 0;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;
    if (testWidth > maxWidth && n > 0) {
      ctx.fillText(line.trim(), x, y);
      line = words[n] + ' ';
      y += lineHeight;
      linesDrawn++;
      if (linesDrawn >= maxLines - 1 && n < words.length - 1) {
        line += '...';
        break;
      }
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line.trim(), x, y);
  return y + lineHeight;
}

function wrapCanvasZhText(ctx, text, x, y, maxWidth, lineHeight) {
  let line = '';
  for (let i = 0; i < text.length; i++) {
    const testLine = line + text[i];
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && i > 0) {
      ctx.fillText(line, x, y);
      line = text[i];
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, y);
  return y + lineHeight;
}

function renderPoster(item) {
  state.posterId = item.id;
  const canvas = el.posterCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  const isLight = document.documentElement.getAttribute('data-theme') === 'light';

  // 1. 背景底色与渐变
  const bgGrad = ctx.createLinearGradient(0, 0, w, h);
  if (isLight) {
    bgGrad.addColorStop(0, '#fdfbf7');
    bgGrad.addColorStop(1, '#f1ede4');
  } else {
    bgGrad.addColorStop(0, '#0a0e17');
    bgGrad.addColorStop(0.5, '#0f172a');
    bgGrad.addColorStop(1, '#080d1a');
  }
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // 2. 边框装饰与角标 (古典精致装帧)
  const pad = 36;
  ctx.strokeStyle = isLight ? 'rgba(180, 83, 9, 0.35)' : 'rgba(217, 180, 107, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);

  // 内圈虚线
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
  ctx.strokeRect(pad + 8, pad + 8, w - (pad + 8) * 2, h - (pad + 8) * 2);
  ctx.restore();

  // 四角小折角装饰
  const cornerSize = 12;
  ctx.fillStyle = isLight ? '#b45309' : '#d9b46b';
  [[pad, pad], [w - pad, pad], [pad, h - pad], [w - pad, h - pad]].forEach(([cx, cy]) => {
    ctx.fillRect(cx - 3, cy - 3, 6, 6);
  });

  // 3. 顶部 Header
  let cursorY = 90;
  ctx.font = '600 14px "SF Mono", Menlo, Consolas, monospace';
  ctx.fillStyle = isLight ? '#78350f' : '#d9b46b';
  ctx.textAlign = 'center';
  ctx.letterSpacing = '4px';
  ctx.fillText('WORDS · 朗读室', w / 2, cursorY);

  cursorY += 28;
  ctx.font = '500 13px system-ui, sans-serif';
  ctx.fillStyle = isLight ? '#64748b' : '#94a3b8';
  ctx.fillText(item.type === 'speech' ? 'CLASSIC SPEECH · 经典演讲' : 'THE ECONOMIST · 句式装置', w / 2, cursorY);

  // 装饰金线
  cursorY += 24;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 40, cursorY);
  ctx.lineTo(w / 2 + 40, cursorY);
  ctx.strokeStyle = isLight ? 'rgba(180, 83, 9, 0.4)' : 'rgba(217, 180, 107, 0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 4. 引号与英文金句
  cursorY += 56;
  ctx.font = 'italic 72px "Playfair Display", Georgia, serif';
  ctx.fillStyle = isLight ? 'rgba(180, 83, 9, 0.25)' : 'rgba(217, 180, 107, 0.25)';
  ctx.fillText('“', w / 2, cursorY);

  const quote = quoteOf(item);
  cursorY += 24;
  ctx.textAlign = 'left';
  const quoteFontSize = quote.length > 200 ? 25 : quote.length > 120 ? 29 : 34;
  ctx.font = `italic ${quoteFontSize}px "Playfair Display", "Times New Roman", Georgia, serif`;
  ctx.fillStyle = isLight ? '#0f172a' : '#f8fafc';
  const marginX = 80;
  const contentWidth = w - marginX * 2;
  cursorY = wrapCanvasText(ctx, quote, marginX, cursorY, contentWidth, quoteFontSize * 1.5, 8);

  // 5. 中文翻译
  cursorY += 36;
  const zh = zhOf(item);
  ctx.font = '19px "Songti SC", "Noto Serif CJK SC", "PingFang SC", serif';
  ctx.fillStyle = isLight ? '#475569' : '#cbd5e1';
  cursorY = wrapCanvasZhText(ctx, `「${zh}」`, marginX, cursorY, contentWidth, 32);

  // 6. 底部信息栏
  const footY = h - 90;
  ctx.beginPath();
  ctx.moveTo(marginX, footY - 30);
  ctx.lineTo(w - marginX, footY - 30);
  ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.1)';
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.fillStyle = isLight ? '#0f172a' : '#e2e8f0';
  const byLine = item.type === 'speech' ? `${item.speaker} · ${item.title}` : `${item.device} · ${item.deviceEn}`;
  ctx.fillText(byLine, marginX, footY);

  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = isLight ? '#64748b' : '#94a3b8';
  const subLine = item.type === 'speech' ? `${item.occasion} (${item.year})` : `The Economist 示范金句 · ${item.topic}`;
  ctx.fillText(subLine, marginX, footY + 22);

  ctx.textAlign = 'right';
  ctx.font = '600 13px "SF Mono", Menlo, Consolas, monospace';
  ctx.fillStyle = isLight ? '#78350f' : '#d9b46b';
  ctx.fillText('daixuan.cloud/words', w - marginX, footY + 10);

  // 打开弹窗
  el.posterModal.hidden = false;
  el.posterScrim.hidden = false;
  requestAnimationFrame(() => {
    el.posterModal.classList.add('is-on');
    el.posterScrim.classList.add('is-on');
  });
}

function closePosterModal() {
  el.posterModal.classList.remove('is-on');
  el.posterScrim.classList.remove('is-on');
  setTimeout(() => {
    el.posterModal.hidden = true;
    el.posterScrim.hidden = true;
  }, 260);
}

function downloadPoster() {
  if (!state.posterId) return;
  const link = document.createElement('a');
  link.download = `words-card-${state.posterId}.png`;
  link.href = el.posterCanvas.toDataURL('image/png');
  link.click();
  toast('海报图片已开始下载');
}

/* ---------- events ---------- */
function bind() {
  // 卡片区交互
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
      if (item) speak(quoteOf(item), 'card:' + item.id, speakBtn, titleOf(item));
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

  // 领域主题筛选胶囊
  el.topicBar.addEventListener('click', (e) => {
    const pill = e.target.closest('.topic-pill');
    if (!pill) return;
    state.topic = pill.dataset.topic;
    render();
  });

  // 排序下拉选单
  el.sortSelect.addEventListener('change', () => {
    state.sort = el.sortSelect.value;
    render();
  });

  $('#btn-reset').addEventListener('click', () => {
    state.q = '';
    state.tab = 'all';
    state.topic = 'all';
    state.sort = 'default';
    el.q.value = '';
    el.sortSelect.value = 'default';
    render();
  });

  // 抽背闪卡测试
  el.btnQuiz.addEventListener('click', () => {
    const targetPool = state.visible.length ? state.visible : ALL;
    const randomItem = targetPool[Math.floor(Math.random() * targetPool.length)];
    if (!state.cloze) {
      state.cloze = true;
      applyCloze();
      writeLS(LS.cloze, 'on');
    }
    openDrawer(randomItem.id);
    toast('🎲 已开启背诵闪卡！请尝试回想遮盖的词汇与译文');
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
    if (item) speak(quoteOf(item), 'today', el.todaySpeak, titleOf(item));
  });
  el.todayOpen.addEventListener('click', () => {
    if (state.todayId) openDrawer(state.todayId);
  });

  // 抽屉内部动作
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
      toast('专属深度链接已复制到剪贴板');
    } catch (e) {
      toast('复制失败，请手动复制地址栏');
    }
  });

  el.dBody.addEventListener('click', (e) => {
    // 词汇点击查词
    const wordSpan = e.target.closest('[data-vocab-word]');
    if (wordSpan && state.currentId) {
      e.stopPropagation();
      wordSpan.classList.add('is-revealed');
      const item = BY_ID.get(state.currentId);
      const wTarget = wordSpan.dataset.vocabWord.toLowerCase();
      const v = (item.vocab || []).find((x) => x.w.toLowerCase() === wTarget);
      if (v) showVocabPopover(v, wordSpan);
      return;
    }

    const copyBtn = e.target.closest('[data-copy-quote]');
    if (copyBtn) {
      e.stopPropagation();
      copyQuote(copyBtn.dataset.copyQuote);
      return;
    }

    // 生成海报
    const posterBtn = e.target.closest('[data-poster]');
    if (posterBtn) {
      e.stopPropagation();
      const item = BY_ID.get(posterBtn.dataset.poster);
      if (item) renderPoster(item);
      return;
    }

    // 仿写相关
    if (e.target.id === 'd-practice-speak') {
      const input = $('#d-practice-input', el.dBody);
      if (input && input.value.trim()) {
        speak(input.value.trim(), 'practice', e.target, '仿写朗读');
      } else {
        toast('请先在仿写框内输入英文句子');
      }
      return;
    }
    if (e.target.id === 'd-practice-copy') {
      const input = $('#d-practice-input', el.dBody);
      if (input && input.value.trim()) {
        navigator.clipboard.writeText(input.value.trim())
          .then(() => toast('仿写句子已复制到剪贴板'))
          .catch(() => toast('复制失败'));
      }
      return;
    }
    if (e.target.id === 'd-practice-clear') {
      const input = $('#d-practice-input', el.dBody);
      if (input) {
        input.value = '';
        if (state.currentId) writeLS(LS.practicePrefix + state.currentId, '');
        toast('仿写试验田已清空');
      }
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
    if (item) speak(quoteOf(item), 'drawer:' + item.id, btn, titleOf(item));
  });

  // 海报弹窗事件
  el.posterClose.addEventListener('click', closePosterModal);
  el.posterScrim.addEventListener('click', closePosterModal);
  el.btnDownloadPoster.addEventListener('click', downloadPoster);
  el.btnCopyPoster.addEventListener('click', () => {
    if (state.posterId) copyQuote(state.posterId);
  });

  // 词汇 Popover 发音
  el.vpSpeak.addEventListener('click', () => {
    if (currentVocabWord) speak(currentVocabWord, 'vocab:' + currentVocabWord);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#vocab-popover') && !e.target.closest('[data-vocab-word]')) {
      hideVocabPopover();
    }
  });

  // 底部播放 HUD 事件
  el.hudStop.addEventListener('click', stopSpeaking);
  el.hudReplay.addEventListener('click', () => {
    if (state.speakingText && state.speakingId) {
      const txt = state.speakingText;
      const id = state.speakingId;
      stopSpeaking();
      speak(txt, id, null, el.hudTitle.textContent);
    }
  });
  el.hudPause.addEventListener('click', () => {
    if (!('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    if (state.isPaused) {
      synth.resume();
      state.isPaused = false;
      el.playerHud.classList.remove('is-paused');
    } else {
      synth.pause();
      state.isPaused = true;
      el.playerHud.classList.add('is-paused');
    }
  });

  // 全站主题
  el.theme.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    writeLS(LS.theme, next);
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = next === 'light' ? '#f8fafc' : '#0a0e17';
    // 若海报开着，实时重新渲染海报
    if (state.posterId && !el.posterModal.hidden) {
      const item = BY_ID.get(state.posterId);
      if (item) renderPoster(item);
    }
  });

  // 中英对照切换
  el.bilingual.addEventListener('click', () => {
    state.bi = !state.bi;
    applyBilingual();
    writeLS(LS.bi, state.bi ? 'on' : 'off');
  });

  // 背诵挖空自测模式切换
  if (el.cloze) {
    el.cloze.addEventListener('click', () => {
      state.cloze = !state.cloze;
      applyCloze();
      writeLS(LS.cloze, state.cloze ? 'on' : 'off');
      toast(state.cloze ? '背诵模式已开启（中文与重点词汇已遮盖，点击即可揭开）' : '背诵模式已关闭');
    });
  }

  // 快捷键系统
  document.addEventListener('keydown', (e) => {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

    if (e.key === 'Escape') {
      if (!el.posterModal.hidden) { closePosterModal(); return; }
      if (state.currentId) { closeDrawer(); return; }
      if (state.q) { state.q = ''; el.q.value = ''; render(); return; }
    }

    if (e.key === '/' && !inField) {
      e.preventDefault();
      el.q.focus();
      return;
    }

    if (state.currentId && !inField) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      if (e.key === 'Tab') trapFocus(e);
    }
  });

  // 外链与深链联动
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
    el.cloze.title = state.cloze ? '背诵模式已开启（点击关闭，恢复完整显示）' : '切换背诵模式（遮盖中文与重点生词，点击即可揭开）';
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
    requestAnimationFrame(() => openDrawer(id, { writeHash: false }));
  }
}

boot();

})();

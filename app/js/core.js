/* ═══ core.js — 全局状态、事件总线、公共工具 ═══ */
(function () {
  'use strict';
  const App = window.App = {
    // 场景物体注册表：{ id, name, object3D, tracks:{position:[],rotation:[],scale:[]}, rules:[] }
    // 轨道关键帧: { t:秒, v:[x,y,z] }  rotation 用弧度
    entries: [],
    selected: null,
    selection: [],            /* 多选：含 primary(selected) 在内的全部选中项 */
    time: 0, duration: 5, playing: false, loop: false, autoKey: false,
    clips: [],                /* 命名动画片段 [{ id, name, duration }] */
    activeClipId: null,       /* 时间轴当前编辑的动画 */
    ease: 'smooth',           /* 关键帧缓动: smooth | linear */
    preview: false,
    selectedKey: null,          // { ch, index }
    assets: {},                 // 导入的 GLB 原始 buffer（供保存工程用）key -> {buffer, rootEntryId}
    _dirty: false,              // 有未保存改动时，关页前提醒
    hooks: { tick: [] },        // 每帧回调
    idCounter: 0,
  };

  App.on = function (ev, fn) { (App._ls = App._ls || {}); (App._ls[ev] = App._ls[ev] || []).push(fn); };
  App.emit = function (ev, a, b) { (App._ls && App._ls[ev] || []).forEach(f => f(a, b)); };

  App.selEntry = function () { return App.selected; };

  /* ---------- DOM 工具 ---------- */
  App.$ = sel => document.querySelector(sel);
  App.$$ = sel => Array.from(document.querySelectorAll(sel));
  App.el = function (tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  /* ---------- 提示气泡 ---------- */
  App.toast = function (msg, type = '', ms = 2600) {
    const box = App.$('#toasts');
    const t = App.el('div', 'toast' + (type ? ' ' + type : ''));
    t.textContent = msg;   /* 提示文案可能含用户输入（文件名/规则语句），不走 innerHTML */
    box.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, ms);
  };

  /* ---------- 数值 ---------- */
  App.fmt = n => (Math.round(n * 100) / 100).toString();
  App.fmt1 = n => (Math.round(n * 10) / 10).toFixed(1) + 's';
  App.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  App.lerp = (a, b, k) => a + (b - a) * k;
  App.easeInOut = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

  App.deepCopy = obj => JSON.parse(JSON.stringify(obj));

  /* ---------- 下载 ---------- */
  App.download = function (blobOrStr, filename, mime) {
    const blob = blobOrStr instanceof Blob ? blobOrStr : new Blob([blobOrStr], { type: mime || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  };

  /* ---------- ArrayBuffer <-> base64 ---------- */
  App.bufToB64 = function (buffer) {
    const bytes = new Uint8Array(buffer); let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  };
  App.b64ToBuf = function (b64) {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  };

  /* ---------- 唯一命名 ---------- */
  App.uniqueName = function (base) {
    base = String(base || '物体').replace(/\s+/g, '_').slice(0, 40) || '物体';
    const names = new Set(App.entries.map(e => e.name));
    if (!names.has(base)) return base;
    let i = 2; while (names.has(base + '_' + i)) i++;
    return base + '_' + i;
  };
})();

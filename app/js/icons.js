/* ═══ icons.js — 全站 SVG 图标注册中心（SF Symbols 风格：24 网格 / 1.7px 圆头描边 / 单色跟随文字颜色） ═══
   用法：
   - 静态 HTML：<button data-icon="import">导入 GLB</button> → 启动时 App.injectIcons() 自动注入
   - 动态 JS：  App.icon('cube', 14) 返回 SVG 字符串
   注册名见 App.ICONS；未注册的名字回退为原样返回（可继续混用 emoji） */
(function () {
  'use strict';
  const App = window.App;

  /* 每个图标 = 24×24 网格上的内部图形（stroke/fill 由外壳统一控制） */
  App.ICONS = {
    /* ── 工程流 ── */
    import:    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6"/><path d="M9.5 14.5L12 17l2.5-2.5"/>',
    new:       '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6"/><path d="M9 14h6"/>',
    open:      '<path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2"/><path d="M3 7h18v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    save:      '<path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    export:    '<path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    publish:   '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.6 4 5.6 4 9s-1.4 6.4-4 9c-2.6-2.6-4-5.6-4-9s1.4-6.4 4-9z"/>',
    undo:      '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v0a6 6 0 0 1-6 6h-4"/>',
    redo:      '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a6 6 0 0 0-6 6v0a6 6 0 0 0 6 6h4"/>',
    move:      '<path d="M12 2v20"/><path d="M2 12h20"/><path d="M9 5l3-3 3 3"/><path d="M9 19l3 3 3-3"/><path d="M5 9L2 12l3 3"/><path d="M19 9l3 3-3 3"/>',
    rotate:    '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
    scale:     '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
    play:      '<path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none"/>',
    pause:     '<path d="M8 4v16"/><path d="M16 4v16" stroke-width="2.6"/>',
    stop:      '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
    skipStart: '<path d="M19 5l-9 7 9 7z" fill="currentColor" stroke="none"/><path d="M6 5v14"/>',
    skipEnd:   '<path d="M5 5l9 7-9 7z" fill="currentColor" stroke="none"/><path d="M18 5v14"/>',
    replay:    '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>',
    scene:     '<path d="M4 6h9"/><path d="M17 6h3"/><circle cx="15" cy="6" r="2"/><path d="M4 12h3"/><path d="M11 12h9"/><circle cx="9" cy="12" r="2"/><path d="M4 18h11"/><path d="M19 18h1"/><circle cx="17" cy="18" r="2"/>',
    help:      '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    screenshot: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="14" r="3.5"/>',
    video:     '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14"/><path d="M17 5v14"/><path d="M3 10h4"/><path d="M3 14h4"/><path d="M17 10h4"/><path d="M17 14h4"/>',
    gif:       '<rect x="3" y="7" width="14" height="12" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v11"/>',
    curve:     '<path d="M3 21h18"/><path d="M6 16l4-5 4 3 6-7"/>',
    addKey:    '<rect x="8" y="8" width="8" height="8" rx="1" transform="rotate(45 12 12)"/><path d="M12 9.5v5"/><path d="M9.5 12h5"/>',
    delKey:    '<rect x="8" y="8" width="8" height="8" rx="1" transform="rotate(45 12 12)"/><path d="M10.3 10.3l3.4 3.4"/><path d="M13.7 10.3l-3.4 3.4"/>',
    /* ── 物体类型 ── */
    cube:      '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 12l9-5"/><path d="M12 12L3 7"/><path d="M12 12v10"/>',
    bulb:      '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 1 3.9 10.6c-.6.5-.9 1.4-.9 2.4h-6c0-1-.3-1.9-.9-2.4A6 6 0 0 1 12 3z"/>',
    spot:      '<circle cx="12" cy="4.5" r="2.3"/><path d="M9.2 6.6L5 16"/><path d="M14.8 6.6L19 16"/><path d="M5 16h14"/>',
    label:     '<rect x="3" y="5" width="18" height="13" rx="2"/><path d="M7 9h7"/><path d="M7 12.5h10"/>',
    eyeOn:     '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff:    '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
    /* ── 操作 ── */
    focus:     '<circle cx="12" cy="12" r="7"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/>',
    rename:    '<path d="M17 3a2.8 2.8 0 0 1 4 4L8 20l-5 1 1-5z"/>',
    copy:      '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    trash:     '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    drop:      '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    star:      '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    sparkles:  '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    resetView: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>',
    plus:      '<path d="M12 5v14"/><path d="M5 12h14"/>',
    tree:      '<path d="M12 2l10 5-10 5L2 7z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/>',
    shape:     '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="12" cy="12" r="4"/>',
  };

  /* 生成 SVG 字符串（未注册的名字原样返回，兼容混用 emoji） */
  App.icon = function (name, size) {
    const def = App.ICONS[name];
    if (!def) return name || '';
    size = size || 16;
    return '<svg class="ic" viewBox="0 0 24 24" width="' + size + '" height="' + size +
      '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + def + '</svg>';
  };

  /* 注入：扫描 [data-icon] 元素，把图标插到文字前面（只注入一次） */
  App.injectIcons = function (root) {
    (root || document).querySelectorAll('[data-icon]').forEach(function (el) {
      if (el.dataset.iconDone) return;
      el.dataset.iconDone = '1';
      const size = el.dataset.iconSize || 16;
      el.insertAdjacentHTML('afterbegin', App.icon(el.dataset.icon, size));
    });
  };
})();

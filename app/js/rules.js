/* ═══ rules.js — 交互设计：当【事件】→ 就【动作】规则卡片 + 运行时 ═══ */
(function () {
  'use strict';
  const App = window.App;
  const T = () => window.THREE;

  const EVENTS = {
    click:    '有人点击它',
    dblclick: '双击它',
    hover:    '鼠标悬停它',
    load:     '场景加载后',
  };
  const ACTIONS = {
    anim:    '播放指定动画',
    color:   '变成某颜色',
    message: '弹出提示气泡',
    fly:     '相机飞到它面前',
    toggle:  '显示 ↔ 隐藏',
    spin:    '转起来 / 停下',
    shake:   '抖动一下',
    sound:   '播放音效',
    link:    '打开一个网页',
  };

  /* WebAudio 合成音效（无需素材文件） */
  const SOUNDS = {
    ding: { freq: 1318, type: 'sine', dur: 0.35, decay: true },
    dong: { freq: 520, type: 'sine', dur: 0.45, decay: true },
    boop: { freq: 220, type: 'square', dur: 0.18, decay: true },
    pop:  { freq: 660, type: 'triangle', dur: 0.12, decay: true, slide: 1.6 },
  };
  App.playSound = function (kind) {
    const s = SOUNDS[kind] || SOUNDS.ding;
    try {
      App._audio = App._audio || new (window.AudioContext || window.webkitAudioContext)();
      const ac = App._audio;
      if (ac.state === 'suspended') ac.resume();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = s.type;
      osc.frequency.setValueAtTime(s.freq, ac.currentTime);
      if (s.slide) osc.frequency.exponentialRampToValueAtTime(s.freq * s.slide, ac.currentTime + s.dur);
      gain.gain.setValueAtTime(0.18, ac.currentTime);
      if (s.decay) gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + s.dur);
      osc.connect(gain).connect(ac.destination);
      if (App._recGain) { try { gain.connect(App._recGain); } catch (e) { /* 忽略 */ } }
      osc.start();
      osc.stop(ac.currentTime + s.dur + 0.02);
    } catch (e) { /* 无声环境忽略 */ }
  };

  /* ---------- 动作执行 ---------- */
  App.doAction = function (entry, rule) {
    switch (rule.action) {
      case 'anim':
        if (!App.playClip(rule.clip) && entry.object3D.userData.clips) App.playEntryClips(entry);
        break;
      case 'color':
        App.tweenColor(entry, rule.value || '#ff5555');
        break;
      case 'message':
        App.toast(String(rule.value || '你好！'), 'bubble', 2800);
        break;
      case 'fly':
        App.focusEntry(entry);
        break;
      case 'toggle':
        entry.object3D.visible = !entry.object3D.visible;
        break;
      case 'spin':
        entry._spin = !entry._spin;
        break;
      case 'shake':
        App.shakeEntry(entry);
        break;
      case 'sound':
        App.playSound(rule.value || 'ding');
        break;
      case 'link':
        if (rule.value) {
          try { window.open(rule.value, '_blank'); } catch (e) { /* 弹窗拦截时静默 */ }
        }
        break;
    }
  };

  App.runRules = function (entry, ev) {
    if (!entry) return;
    entry.rules.forEach(function (rule) {
      if (rule.event === ev) App.doAction(entry, rule);
    });
  };

  /* 颜色渐变补间 */
  App.tweenColor = function (entry, hex) {
    const THREE = T();
    const to = new THREE.Color(hex);
    const items = [];
    App.entryMaterials(entry).forEach(function (m) {
      if (m.color) items.push({ m: m, from: m.color.clone() });
    });
    if (!items.length) return;
    App._tweens.push({
      t: 0, dur: 0.4,
      step: function (k) {
        items.forEach(function (it) { it.m.color.lerpColors(it.from, to, k); });
      },
    });
  };

  /* 抖动补间 */
  App.shakeEntry = function (entry) {
    const o = entry.object3D;
    const p0 = o.position.clone();
    App._tweens.push({
      t: 0, dur: 0.5,
      step: function (k) {
        const d = (1 - k) * 0.12 * Math.sin(k * 40);
        o.position.set(p0.x + d, p0.y, p0.z);
        if (k >= 1) o.position.copy(p0);
      },
    });
  };

  /* ---------- 规则卡片 UI ---------- */
  function paramInput(rule) {
    if (rule.action === 'anim') {
      /* 播放指定动画：从命名动画列表里挑一条（可跨物体） */
      const sel = document.createElement('select');
      const list = App.clips.length ? App.clips : [{ id: null, name: '动画1' }];
      list.forEach(function (c) {
        const opt = document.createElement('option');
        opt.value = c.id || '';
        opt.textContent = c.name + (App.clipHasAnim(c.id) ? ' ◆' : '');
        const cur = rule.clip || (App.clips[0] && App.clips[0].id) || '';
        if (cur === c.id) opt.selected = true;
        sel.appendChild(opt);
      });
      if (!rule.clip && App.clips[0]) rule.clip = App.clips[0].id;
      sel.title = '选择要播放的动画（可包含其它物体的关键帧）';
      sel.addEventListener('change', function () { rule.clip = sel.value; App.commitUndo(); });
      return sel;
    }
    if (rule.action === 'color') {
      const inp = document.createElement('input');
      inp.type = 'color';
      inp.value = rule.value || '#ff5555';
      inp.title = '要变成的颜色';
      inp.addEventListener('input', function () { rule.value = inp.value; });
      inp.addEventListener('change', function () { App.commitUndo(); });
      return inp;
    }
    if (rule.action === 'message') {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = rule.value || '';
      inp.placeholder = '要弹出的那句话…';
      inp.addEventListener('input', function () { rule.value = inp.value; });
      inp.addEventListener('change', function () { App.commitUndo(); });
      return inp;
    }
    if (rule.action === 'sound') {
      const sel = document.createElement('select');
      const opts = [['ding', '🔔 叮'], ['dong', '🛎 咚'], ['boop', '🤖 嘟'], ['pop', '🎈 啵']];
      opts.forEach(function (o) {
        const opt = document.createElement('option');
        opt.value = o[0]; opt.textContent = o[1];
        if ((rule.value || 'ding') === o[0]) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', function () { rule.value = sel.value; App.commitUndo(); });
      return sel;
    }
    if (rule.action === 'link') {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = rule.value || '';
      inp.placeholder = 'https://…';
      inp.addEventListener('input', function () { rule.value = inp.value; });
      inp.addEventListener('change', function () { App.commitUndo(); });
      return inp;
    }
    return null;
  }

  function row(entry, rule) {
    const div = document.createElement('div');
    div.className = 'rule';

    const when = document.createElement('div');
    when.className = 'when';
    const b1 = document.createElement('b');
    b1.textContent = '当';
    const evSel = document.createElement('select');
    Object.keys(EVENTS).forEach(function (k) {
      const opt = document.createElement('option');
      opt.value = k; opt.textContent = EVENTS[k];
      if (rule.event === k) opt.selected = true;
      evSel.appendChild(opt);
    });
    evSel.addEventListener('change', function () { rule.event = evSel.value; App.commitUndo(); });
    when.append(b1, evSel);

    const then = document.createElement('div');
    then.className = 'then';
    const b2 = document.createElement('b');
    b2.textContent = '就';
    const acSel = document.createElement('select');
    Object.keys(ACTIONS).forEach(function (k) {
      const opt = document.createElement('option');
      opt.value = k; opt.textContent = ACTIONS[k];
      if (rule.action === k) opt.selected = true;
      acSel.appendChild(opt);
    });
    const param = document.createElement('span');
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '🗑';
    del.title = '删除这条规则';
    del.addEventListener('click', function () {
      const i = entry.rules.indexOf(rule);
      if (i >= 0) entry.rules.splice(i, 1);
      buildRuleRows();
      App.commitUndo();
    });

    function rebuildParam() {
      param.innerHTML = '';
      const inp = paramInput(rule);
      if (inp) param.appendChild(inp);
    }
    acSel.addEventListener('change', function () {
      rule.action = acSel.value;
      rebuildParam();
      App.commitUndo();
    });
    rebuildParam();

    then.append(b2, acSel, param, del);
    div.append(when, then);
    return div;
  }

  function buildRuleRows() {
    const list = document.querySelector('#rules-list');
    const page = document.querySelector('#tab-rules');
    list.innerHTML = '';
    const entry = App.selected;
    page.classList.toggle('has-sel', !!entry);
    if (!entry) return;
    entry.rules.forEach(function (rule) {
      list.appendChild(row(entry, rule));
    });
  }
  App.buildRuleRows = buildRuleRows;

  App.on('selection', buildRuleRows);

  /* ---------- 新建规则 ---------- */
  document.querySelector('#rule-add').addEventListener('click', function () {
    const e = App.selected;
    if (!e) {
      App.toast('先在场景里选中一个物体', 'warn');
      return;
    }
    e.rules.push({ event: 'click', action: 'message', value: '你好！我是 ' + e.name });
    buildRuleRows();
    App.commitUndo();
    App.emit('rule');
    App.toast('规则已添加。点顶部「▶ 播放预览」就能试啦');
  });

  /* ---------- 每帧：补间 + 自转 ---------- */
  App._tweens = App._tweens || [];
  App.hooks.tick.push(function rulesTick(dt) {
    if (App._tweens.length) {
      App._tweens = App._tweens.filter(function (tw) {
        tw.t += dt;
        const k = Math.min(tw.t / tw.dur, 1);
        tw.step(k);
        return k < 1;
      });
    }
    App.entries.forEach(function (e) {
      if (e._spin) e.object3D.rotation.y += dt * 1.5;
    });
  });

  /* 退出预览时停掉自转和本地动画 */
  App.on('preview-end', function () {
    App.entries.forEach(function (e) { e._spin = false; });
    App._locals = [];
  });
})();

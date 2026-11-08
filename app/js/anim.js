/* ═══ anim.js — 命名动画片段（clip）：多动画管理、轨道数据、时间轴 UI、一键动画预设、导出用 AnimationClip ═══
   数据模型：
   - App.clips = [{ id, name, duration }]                    命名动画片段列表（至少一条）
   - App.activeClipId                                        时间轴当前编辑的动画
   - entry.clips = { [clipId]: { position:[], rotation:[], scale:[] } }
                                                             每个物体在每条动画里独立的轨道
   - App.duration 始终镜像「当前动画」的时长                  */
(function () {
  'use strict';
  const App = window.App;
  const T = () => window.THREE;
  const CHS = ['position', 'rotation', 'scale'];
  const emptyTracks = () => ({ position: [], rotation: [], scale: [] });

  /* ═══════════ 动画片段（clip）管理 ═══════════ */

  App.activeClip = function () {
    return App.clips.find(function (c) { return c.id === App.activeClipId; }) || App.clips[0] || null;
  };

  /* 物体在某条动画里的轨道（惰性创建；仅编辑路径使用） */
  App.entryTracks = function (entry, clipId) {
    if (!entry) return emptyTracks();
    const cid = clipId || App.activeClipId;
    if (!entry.clips) entry.clips = {};
    if (!entry.clips[cid]) entry.clips[cid] = emptyTracks();
    return entry.clips[cid];
  };

  /* 物体是否有动画（clipId 省略 = 任意动画） */
  App.entryHasAnim = function (entry, clipId) {
    if (!entry) return false;
    const sets = entry.clips || {};
    /* clipId 仅接受字符串；some() 回调传来的数组下标(number)视为未指定 */
    const ids = (typeof clipId === 'string' && clipId) ? [clipId] : Object.keys(sets);
    return ids.some(function (cid) {
      const s = sets[cid];
      return !!s && !!(s.position.length || s.rotation.length || s.scale.length);
    });
  };

  /* 某条动画的成员物体（在该动画里有关键帧的物体） */
  App.clipMembers = function (clipId) {
    return App.entries.filter(function (e) { return App.entryHasAnim(e, clipId); });
  };

  App.clipHasAnim = function (clipId) {
    return App.clipMembers(clipId).length > 0;
  };

  /* 全局时长 = 所有动画时长的最大值（预览/GIF/视频的播放窗口） */
  App.globalDuration = function () {
    return App.clips.reduce(function (m, c) { return Math.max(m, c.duration); }, 1);
  };

  /* 确保至少存在一条动画（启动 / 打开旧工程时调用） */
  App.ensureClips = function () {
    if (!App.clips.length) App.clips.push({ id: 'clip1', name: '动画1', duration: App.duration || 5 });
    if (!App.clips.some(function (c) { return c.id === App.activeClipId; })) App.activeClipId = App.clips[0].id;
    App.duration = App.activeClip().duration;
    if (App.renderClipChips) App.renderClipChips();
  };

  /* 切换/增删动画后的统一同步：暂停、时长镜像、标尺、播放头、关键帧 */
  App.syncActiveClip = function () {
    App.playing = false;
    const c = App.activeClip();
    App.duration = c ? c.duration : 5;
    App.updatePlayUI();
    App.buildRuler();
    App.setTime(0);
    App.renderKeys();
  };

  App.addClip = function (name) {
    App._clipCounter = (App._clipCounter || 0) + 1;
    const base = String(name || ('动画' + (App.clips.length + 1))).replace(/\s+/g, ' ').trim().slice(0, 20) || ('动画' + (App.clips.length + 1));
    const names = new Set(App.clips.map(function (c) { return c.name; }));
    let n = base, i = 2;
    while (names.has(n)) { n = base + '_' + i; i++; }
    const clip = { id: 'clip' + Date.now().toString(36) + '_' + App._clipCounter, name: n, duration: App.duration };
    App.clips.push(clip);
    App.activeClipId = clip.id;
    App.selectedKey = null;
    App.syncActiveClip();
    App.commitUndo();
    App.emit('clips-changed');
    App.toast('已创建「' + n + '」：接下来打的关键帧都属于这条动画');
    return clip;
  };

  App.renameClip = function (id, name) {
    const clip = App.clips.find(function (c) { return c.id === id; });
    if (!clip) return;
    const n = String(name || '').trim().slice(0, 20);
    if (!n || n === clip.name) return;
    clip.name = n;
    App.emit('clips-changed');
    App.commitUndo();
  };

  App.deleteClip = function (id) {
    if (App.clips.length <= 1) { App.toast('至少要保留一条动画', 'warn'); return; }
    const clip = App.clips.find(function (c) { return c.id === id; });
    if (!clip) return;
    App.entries.forEach(function (e) { if (e.clips) delete e.clips[id]; });
    App.clips = App.clips.filter(function (c) { return c.id !== id; });
    App.selectedKey = null;
    if (App.activeClipId === id) App.activeClipId = App.clips[0].id;
    App.syncActiveClip();
    App.commitUndo();
    App.emit('clips-changed');
    App.toast('已删除「' + clip.name + '」及其关键帧（Ctrl+Z 可撤销）');
  };

  App.switchClip = function (id) {
    if (App.activeClipId === id) return;
    if (!App.clips.some(function (c) { return c.id === id; })) return;
    App.activeClipId = id;
    App.selectedKey = null;
    App.syncActiveClip();
    App.emit('clips-changed');
  };

  /* ═══════════ 轨道数据 ═══════════ */

  App.setKey = function (entry, t, channels) {
    const chs = channels || CHS;
    const o = entry.object3D;
    chs.forEach(function (ch) {
      const v = ch === 'position' ? [o.position.x, o.position.y, o.position.z]
        : ch === 'rotation' ? [o.rotation.x, o.rotation.y, o.rotation.z]
        : [o.scale.x, o.scale.y, o.scale.z];
      App.setKeyValue(entry, ch, t, v);
    });
    App.emit('tracks-changed');
  };

  App.setKeyValue = function (entry, ch, t, v) {
    const keys = App.entryTracks(entry)[ch];
    const eps = 0.001;
    let k = null;
    for (const key of keys) { if (Math.abs(key.t - t) < eps) { k = key; break; } }
    if (k) { k.v = v.slice(); }
    else {
      keys.push({ t: t, v: v });
      keys.sort(function (a, b) { return a.t - b.t; });
    }
  };

  /* 录制模式：拖 gizmo 时自动打点 */
  App.setAutoKeys = function (entry) {
    if (!App.autoKey || !entry) return;
    App.setKey(entry, App.time);
  };

  App.sampleTrack = function (keys, t) {
    if (!keys || !keys.length) return null;
    if (t <= keys[0].t) return keys[0].v;
    const last = keys[keys.length - 1];
    if (t >= last.t) return last.v;
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (t >= a.t && t <= b.t) {
        const span = b.t - a.t;
        let k = span > 1e-6 ? (t - a.t) / span : 0;
        /* 逐帧缓动：该段离开的那个关键帧可单独指定；'auto' 跟随全局 */
        const mode = (a.e && a.e !== 'auto') ? a.e : App.ease;
        if (mode === 'back') {
          /* 回弹：接近目标键时轻微过冲再落回 */
          const c1 = 1.70158, c3 = c1 + 1;
          k = 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
        } else if (mode !== 'linear') {
          k = k * k * (3 - 2 * k); /* 平滑缓动 */
        }
        return [
          App.lerp(a.v[0], b.v[0], k),
          App.lerp(a.v[1], b.v[1], k),
          App.lerp(a.v[2], b.v[2], k),
        ];
      }
    }
    return last.v;
  };

  /* 应用某条动画在时刻 t 的姿态（只读：不会为物体创建轨道） */
  App.applyTracksAt = function (t, entries, clipId) {
    const cid = clipId || App.activeClipId;
    const list = entries || App.entries;
    list.forEach(function (e) {
      const tr = e.clips && e.clips[cid];
      if (!tr) return;
      if (tr.position.length) { const v = App.sampleTrack(tr.position, t); if (v) e.object3D.position.fromArray(v); }
      if (tr.rotation.length) { const v = App.sampleTrack(tr.rotation, t); if (v) e.object3D.rotation.set(v[0], v[1], v[2]); }
      if (tr.scale.length) { const v = App.sampleTrack(tr.scale, t); if (v) e.object3D.scale.fromArray(v); }
    });
    if (App.selected && App.three.boxHelper.visible) App.three.boxHelper.update();
  };

  /* 清空物体在「当前动画」里的轨道 */
  App.clearTracks = function (entry) {
    const ts = App.entryTracks(entry);
    ts.position = []; ts.rotation = []; ts.scale = [];
    App.emit('tracks-changed');
  };

  /* ---------- 播放指定动画（交互规则触发） ---------- */
  App.playClip = function (clipId) {
    let clip = App.clips.find(function (c) { return c.id === clipId; });
    if (!clip) clip = App.clips.find(function (c) { return App.clipHasAnim(c.id); }) || App.clips[0];
    if (!clip) return false;
    if (!App.clipHasAnim(clip.id)) return false;
    App._locals = App._locals || [];
    App._locals.push({ clipId: clip.id, t: 0, dur: clip.duration });
    return true;
  };

  /* ---------- 模型自带动画（导入 GLB 内嵌的 AnimationClip） ---------- */
  App.playEntryClips = function (entry) {
    const clips = entry.object3D.userData.clips;
    if (!clips || !clips.length) return false;
    let mixer = App._mixers[entry.id];
    if (!mixer) {
      mixer = new (T().AnimationMixer)(entry.object3D);
      App._mixers[entry.id] = mixer;
    }
    clips.forEach(function (c) {
      const act = mixer.clipAction(c);
      act.setLoop(T().LoopOnce, 1);      /* 预览语义：自带动画也只播一次 */
      act.clampWhenFinished = true;      /* 播完定格在末帧 */
      act.reset().play();
    });
    return true;
  };

  App.stopEntryClips = function (entry) {
    const mixer = App._mixers[entry.id];
    if (mixer) mixer.stopAllAction();
  };

  /* ═══════════ 导出用 AnimationClip（每条命名动画合并成员物体的轨道） ═══════════ */

  function bake(keys) {
    if (keys.length < 2) return keys;
    const out = [keys[0]];
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      for (let s = 1; s < 6; s++) {
        const t = a.t + (b.t - a.t) * (s / 6);
        out.push({ t: t, v: App.sampleTrack(keys, t) });
      }
      out.push(b);
    }
    return out;
  }

  function buildEntryTracks(entry, clipId, tracks) {
    const THREE = T();
    const ts = (entry.clips && entry.clips[clipId]) || null;
    if (!ts) return;
    const mkTimes = keys => keys.map(k => k.t);
    if (ts.position.length) {
      const ks = bake(ts.position);
      tracks.push(new THREE.VectorKeyframeTrack(entry.name + '.position',
        mkTimes(ks), ks.reduce((acc, k) => acc.concat(k.v), [])));
    }
    if (ts.rotation.length) {
      const ks = bake(ts.rotation);
      const eu = new THREE.Euler(), q = new THREE.Quaternion(), vals = [];
      ks.forEach(function (k) {
        eu.set(k.v[0], k.v[1], k.v[2]);
        q.setFromEuler(eu);
        vals.push(q.x, q.y, q.z, q.w);
      });
      tracks.push(new THREE.QuaternionKeyframeTrack(entry.name + '.quaternion', mkTimes(ks), vals));
    }
    if (ts.scale.length) {
      const ks = bake(ts.scale);
      tracks.push(new THREE.VectorKeyframeTrack(entry.name + '.scale',
        mkTimes(ks), ks.reduce((acc, k) => acc.concat(k.v), [])));
    }
  }

  App.buildAllClips = function () {
    const THREE = T();
    const out = [];
    App.clips.forEach(function (clip) {
      const tracks = [];
      App.clipMembers(clip.id).forEach(function (entry) {
        buildEntryTracks(entry, clip.id, tracks);
      });
      if (tracks.length) out.push(new THREE.AnimationClip(clip.name, -1, tracks));
    });
    return out;
  };

  /* ═══════════ 一键动画预设（作用于当前动画） ═══════════ */

  App.applyAnimPreset = function (entry, kind) {
    const dur = App.duration;
    const o = entry.object3D;
    const p0 = [o.position.x, o.position.y, o.position.z];
    const r0 = [o.rotation.x, o.rotation.y, o.rotation.z];
    const s0 = [o.scale.x, o.scale.y, o.scale.z];

    if (kind === 'clear') {
      App.clearTracks(entry);
      App.toast('已清空该物体在「' + App.activeClip().name + '」里的动画');
      App.commitUndo();
      return;
    }
    const tracks = emptyTracks();
    if (kind === 'spin') {
      tracks.rotation = [
        { t: 0, v: r0.slice() },
        { t: dur, v: [r0[0], r0[1] + Math.PI * 2, r0[2]] },
      ];
    } else if (kind === 'float') {
      const THREE = T();
      const box = new THREE.Box3().setFromObject(o);
      const size = box.isEmpty() ? 2 : box.getSize(new THREE.Vector3()).y;
      const amp = App.clamp(size * 0.22, 0.15, 1.2);
      tracks.position = [
        { t: 0, v: p0.slice() },
        { t: dur * 0.25, v: [p0[0], p0[1] + amp, p0[2]] },
        { t: dur * 0.5, v: p0.slice() },
        { t: dur * 0.75, v: [p0[0], p0[1] - amp, p0[2]] },
        { t: dur, v: p0.slice() },
      ];
    } else if (kind === 'move') {
      tracks.position = [
        { t: 0, v: p0.slice() },
        { t: dur * 0.5, v: [p0[0] + 2, p0[1], p0[2]] },
        { t: dur, v: p0.slice() },
      ];
    } else if (kind === 'bounce') {
      const THREE = T();
      const box = new THREE.Box3().setFromObject(o);
      const size = box.isEmpty() ? 2 : box.getSize(new THREE.Vector3()).y;
      const drop = App.clamp(size * 2.5, 2, 8);
      tracks.position = [
        { t: 0, v: [p0[0], p0[1] + drop, p0[2]] },
        { t: dur * 0.4, v: p0.slice() },
        { t: dur * 0.55, v: [p0[0], p0[1] + drop * 0.28, p0[2]] },
        { t: dur * 0.7, v: p0.slice() },
        { t: dur * 0.8, v: [p0[0], p0[1] + drop * 0.12, p0[2]] },
        { t: dur * 0.9, v: p0.slice() },
        { t: dur, v: p0.slice() },
      ];
    } else if (kind === 'swing') {
      tracks.rotation = [
        { t: 0, v: r0.slice() },
        { t: dur * 0.25, v: [r0[0], r0[1], r0[2] + 0.45] },
        { t: dur * 0.5, v: r0.slice() },
        { t: dur * 0.75, v: [r0[0], r0[1], r0[2] - 0.45] },
        { t: dur, v: r0.slice() },
      ];
    } else if (kind === 'tumble') {
      tracks.rotation = [
        { t: 0, v: r0.slice() },
        { t: dur * 0.5, v: [r0[0] + Math.PI, r0[1], r0[2]] },
        { t: dur, v: [r0[0] + Math.PI * 2, r0[1], r0[2]] },
      ];
      tracks.position = [
        { t: 0, v: p0.slice() },
        { t: dur * 0.5, v: [p0[0], p0[1] + 1.2, p0[2]] },
        { t: dur, v: p0.slice() },
      ];
    } else if (kind === 'circle') {
      const r = 2;
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        tracks.position.push({
          t: dur * i / 8,
          v: [p0[0] + r * Math.sin(a), p0[1], p0[2] - r + r * Math.cos(a)],
        });
      }
    } else if (kind === 'pulse') {
      tracks.scale = [
        { t: 0, v: s0.slice() },
        { t: dur * 0.5, v: [s0[0] * 1.25, s0[1] * 1.25, s0[2] * 1.25] },
        { t: dur, v: s0.slice() },
      ];
    } else {
      return;
    }
    const ts = App.entryTracks(entry);
    ts.position = tracks.position;
    ts.rotation = tracks.rotation;
    ts.scale = tracks.scale;
    App.time = 0;
    App.playing = true;
    App.updatePlayUI();
    App.emit('tracks-changed');
    App.commitUndo();
  };

  /* ═══════════ 时间轴 UI ═══════════ */

  let draggingKey = null;

  App.buildRuler = function () {
    const ruler = document.querySelector('#tl-ruler');
    ruler.innerHTML = '';
    for (let s = 0; s <= App.duration; s++) {
      const tick = document.createElement('div');
      tick.className = 'tick';
      tick.style.left = (s / App.duration * 100) + '%';
      tick.textContent = s + 's';
      ruler.appendChild(tick);
    }
  };

  /* ---------- 动画芯片行：新建 / 切换 / 重命名 / 删除 ---------- */
  function renderClipChips() {
    const box = document.querySelector('#clip-chips');
    if (!box) return;
    box.innerHTML = '';
    App.clips.forEach(function (c) {
      const chip = document.createElement('button');
      chip.className = 'clip-chip' + (c.id === App.activeClipId ? ' on' : '');
      chip.textContent = c.name + (App.clipHasAnim(c.id) ? ' ◆' : '');
      chip.title = '切换到「' + c.name + '」（双击可重命名）';
      chip.addEventListener('click', function () { App.switchClip(c.id); });
      chip.addEventListener('dblclick', function () {
        const input = document.createElement('input');
        input.className = 'clip-rename';
        input.value = c.name;
        input.title = '输入新名字，回车确认';
        chip.replaceWith(input);
        input.focus(); input.select();
        const done = function () { App.renameClip(c.id, input.value); renderClipChips(); };
        input.addEventListener('blur', done);
        input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') input.blur(); });
      });
      box.appendChild(chip);
    });
    const del = document.querySelector('#clip-del');
    if (del) del.style.display = App.clips.length > 1 ? '' : 'none';
  }
  App.renderClipChips = renderClipChips;

  function updateKeyEaseUI() {
    const box = document.querySelector('#tl-key-ease-box');
    const sel = document.querySelector('#tl-key-ease');
    if (!box || !sel) return;
    if (!App.selectedKey || !App.selected) { box.style.display = 'none'; return; }
    const ts = (App.selected.clips && App.selected.clips[App.activeClipId]) || emptyTracks();
    const k = ts[App.selectedKey.ch][App.selectedKey.index];
    if (!k) { box.style.display = 'none'; return; }
    box.style.display = '';
    sel.value = k.e || 'auto';
  }

  /* ---------- 关键帧检查器：精确时间/数值、复制粘贴 ---------- */
  function showKeyInspector() {
    const box = document.querySelector('#key-inspector');
    if (!box) return;
    if (!App.selectedKey || !App.selected) { box.classList.add('hidden'); return; }
    const ts = (App.selected.clips && App.selected.clips[App.activeClipId]) || emptyTracks();
    const k = ts[App.selectedKey.ch][App.selectedKey.index];
    if (!k) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    document.querySelector('#ki-ch').textContent =
      { position: '位置帧', rotation: '旋转帧', scale: '缩放帧' }[App.selectedKey.ch];
    const tIn = document.querySelector('#ki-time');
    if (document.activeElement !== tIn) tIn.value = App.fmt(k.t);
    ['ki-v0', 'ki-v1', 'ki-v2'].forEach(function (id, i) {
      const inp = document.querySelector('#' + id);
      if (document.activeElement === inp) return;
      let v = k.v[i];
      if (App.selectedKey.ch === 'rotation') v = v * 180 / Math.PI;
      inp.value = App.fmt(v);
    });
  }

  function bindKeyInspector() {
    const box = document.querySelector('#key-inspector');
    function currentKey() {
      if (!App.selectedKey || !App.selected) return null;
      const ts = (App.selected.clips && App.selected.clips[App.activeClipId]) || emptyTracks();
      return ts[App.selectedKey.ch][App.selectedKey.index] || null;
    }
    document.querySelector('#ki-time').addEventListener('change', function () {
      const k = currentKey();
      if (!k) return;
      k.t = App.clamp(Number(this.value) || 0, 0, App.duration);
      const keys = App.entryTracks(App.selected)[App.selectedKey.ch];
      keys.sort(function (a, b) { return a.t - b.t; });
      App.selectedKey.index = keys.indexOf(k);
      renderKeys();
      App.setTime(k.t);
      App.commitUndo();
    });
    ['ki-v0', 'ki-v1', 'ki-v2'].forEach(function (id, i) {
      document.querySelector('#' + id).addEventListener('change', function () {
        const k = currentKey();
        if (!k) return;
        let v = Number(this.value) || 0;
        if (App.selectedKey.ch === 'rotation') v = v * Math.PI / 180;
        k.v[i] = v;
        App.applyTracksAt(App.time);
        App.commitUndo();
      });
    });
    document.querySelector('#ki-copy').addEventListener('click', function () {
      const k = currentKey();
      if (!k) return;
      App._copiedKey = { ch: App.selectedKey.ch, v: k.v.slice(), e: k.e };
      App.toast('关键帧已复制 ◆ 选好时间后点「粘贴」');
    });
    document.querySelector('#ki-paste').addEventListener('click', function () {
      const c = App._copiedKey;
      const e = App.selected;
      if (!c || !e) { App.toast('先在别的帧上点「复制」', 'warn'); return; }
      App.setKeyValue(e, c.ch, App.time, c.v.slice());
      if (c.e) {
        const keys = App.entryTracks(e)[c.ch];
        for (const kk of keys) { if (Math.abs(kk.t - App.time) < 0.001) { if (c.e) kk.e = c.e; break; } }
      }
      const keys = App.entryTracks(e)[c.ch];
      App.selectedKey = { ch: c.ch, index: keys.findIndex(function (kk) { return Math.abs(kk.t - App.time) < 0.001; }) };
      renderKeys();
      App.applyTracksAt(App.time);
      App.commitUndo();
      App.toast('已粘贴到 ' + App.fmt1(App.time) + ' ◆');
    });
    document.querySelector('#ki-del').addEventListener('click', function () {
      const k = currentKey();
      if (!k) return;
      const keys = App.entryTracks(App.selected)[App.selectedKey.ch];
      keys.splice(keys.indexOf(k), 1);
      App.selectedKey = null;
      renderKeys();
      App.setTime(App.time);
      App.commitUndo();
    });
  }

  function renderKeys() {
    document.querySelectorAll('#tl-tracks .tl-keys').forEach(function (box) { box.innerHTML = ''; });
    const entry = App.selected;
    const empty = document.querySelector('#tl-empty');
    const cid = App.activeClipId;
    /* 始终铺上当前动画的关键帧：选中物体的高亮显示，其它成员的灰态显示 */
    const sources = entry ? [entry] : App.clipMembers(cid);
    empty.style.display = sources.length ? 'none' : '';
    sources.forEach(function (src) {
      const ts = (src.clips && src.clips[cid]) || emptyTracks(); /* 只读渲染，不创建 */
      CHS.forEach(function (ch) {
        const box = document.querySelector('.tl-track[data-ch="' + ch + '"] .tl-keys');
        (ts[ch] || []).forEach(function (k, i) {
          const isSel = src === entry && App.selectedKey &&
            App.selectedKey.ch === ch && App.selectedKey.index === i;
          const d = document.createElement('div');
          d.className = 'key' + (isSel ? ' sel' : '') + (src === entry ? '' : ' dim');
          d.style.left = (k.t / App.duration * 100) + '%';
          d.title = (src === entry ? '' : src.name + ' · ') + App.fmt1(k.t);
          d.addEventListener('pointerdown', function (ev) {
            ev.stopPropagation();
            if (App.selected !== src) App.select(src); /* 灰态帧：先选中它所属的物体 */
            App.selectedKey = { ch: ch, index: i };
            draggingKey = { entry: src, ch: ch, index: i, el: d };
            App.setTime(k.t);
            renderKeys();
          });
          d.addEventListener('dblclick', function (ev) {
            ev.stopPropagation();
            if (App.selected !== src) App.select(src);
            const keys = App.entryTracks(src)[ch];
            keys.splice(keys.indexOf(k), 1);
            App.selectedKey = null;
            renderKeys();
            App.setTime(App.time);
            App.commitUndo();
          });
          if (src === entry && k.e) d.style.borderColor = '#fff'; /* 有独立缓动的帧描白边 */
          box.appendChild(d);
        });
      });
    });
    updateKeyEaseUI();
    showKeyInspector();
    if (App.curveView) renderCurve();
  }
  App.renderKeys = renderKeys;

  App.setTime = function (t) {
    App.time = App.clamp(t, 0, App.duration);
    App.applyTracksAt(App.time);
    updatePlayhead();
  };

  function updatePlayhead() {
    const win = App.preview ? App.globalDuration() : App.duration;
    const ph = document.querySelector('#tl-playhead');
    ph.style.left = (App.time / win * 100) + '%';
    document.querySelector('#tl-time').textContent = App.fmt1(App.time);
  }
  App.updatePlayhead = updatePlayhead;

  function timeFromEvent(ev) {
    const rect = document.querySelector('#tl-tracks').getBoundingClientRect();
    return App.clamp((ev.clientX - rect.left) / rect.width, 0, 1) * App.duration;
  }

  /* ---------- 曲线视图：可见即可拖的动画曲线 ---------- */
  const CURVE_COLORS = ['#ff7a7a', '#7ddb8a', '#7ab8ff'];
  function curveChannel() { return App._curveCh || 'position'; }

  function renderCurve(range) {
    if (!App.curveView) return;
    const cv = document.querySelector('#curve-canvas');
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = cv.clientWidth || 300;
    const H = cv.clientHeight || 116;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    /* 时间网格 */
    ctx.strokeStyle = '#262b38';
    ctx.lineWidth = 1;
    for (let s = 1; s < App.duration; s++) {
      const x = s / App.duration * W;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    const entry = App.selected;
    const keys = entry ? ((entry.clips && entry.clips[App.activeClipId]) || emptyTracks())[curveChannel()] : null;
    function hint(text) {
      ctx.fillStyle = '#8b91a3';
      ctx.font = '12px system-ui, "Microsoft YaHei"';
      ctx.fillText(text, 14, H / 2);
    }
    if (!entry) { hint('选中物体后，在这里看它的动画曲线'); return; }
    if (!keys || !keys.length) { hint('这条轨道还没有关键帧：先摆姿势点「◆ 打关键帧」'); return; }
    /* 值域 */
    let min = Infinity, max = -Infinity;
    keys.forEach(function (k) { k.v.forEach(function (v) { min = Math.min(min, v); max = Math.max(max, v); }); });
    if (max - min < 1e-6) { min -= 0.5; max += 0.5; }
    if (!range) {
      const pad = (max - min) * 0.18;
      min -= pad; max += pad;
    } else { min = range.min; max = range.max; }
    const map = { min: min, max: max };
    map.X = function (t) { return t / App.duration * W; };
    map.Y = function (v) { return H - 6 - (v - min) / (max - min) * (H - 14); };
    cv._map = map;
    function X(t) { return map.X(t); }
    function Y(v) { return map.Y(v); }
    /* 三条分量曲线（含每段缓动形状） */
    const steps = Math.max(24, Math.floor(W / 3));
    for (let c = 0; c < 3; c++) {
      ctx.strokeStyle = CURVE_COLORS[c];
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = App.duration * i / steps;
        const sv = App.sampleTrack(keys, t);
        const x = X(t), y = Y(sv[c]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    /* 关键点 */
    keys.forEach(function (k) {
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = CURVE_COLORS[c];
        ctx.beginPath();
        ctx.arc(X(k.t), Y(k.v[c]), 4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (k.e) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px system-ui';
        ctx.fillText('◆', X(k.t) + 6, 12);
      }
    });
  }
  App.renderCurve = renderCurve;

  function bindCurve() {
    const cv = document.querySelector('#curve-canvas');
    let drag = null;
    cv.addEventListener('pointerdown', function (ev) {
      if (!App.selected || !App.curveView) return;
      const r = cv.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      const keys = App.entryTracks(App.selected)[curveChannel()];
      if (!keys || !keys.length || !cv._map) return;
      let best = null;
      keys.forEach(function (k, i) {
        for (let c = 0; c < 3; c++) {
          const d = Math.hypot(cv._map.X(k.t) - mx, cv._map.Y(k.v[c]) - my);
          if (d < 10 && (!best || d < best.d)) best = { d: d, i: i, c: c };
        }
      });
      if (!best) return;
      drag = { i: best.i, c: best.c, map: cv._map };
      App.selectedKey = { ch: curveChannel(), index: best.i };
      renderKeys();
    });
    window.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      const r = cv.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      const keys = App.entryTracks(App.selected)[curveChannel()];
      const k = keys[drag.i];
      if (!k) return;
      k.t = App.clamp(mx / r.width * App.duration, 0, App.duration);
      k.v[drag.c] = drag.map.min + (1 - (my - 6) / (r.height - 14)) * (drag.map.max - drag.map.min);
      keys.sort(function (a, b) { return a.t - b.t; });
      drag.i = keys.indexOf(k);
      App.selectedKey = { ch: curveChannel(), index: drag.i };
      renderKeys();
      renderCurve(drag.map);
      App.applyTracksAt(App.time);
    });
    window.addEventListener('pointerup', function () {
      if (drag) { drag = null; renderCurve(); App.commitUndo(); }
    });
    window.addEventListener('resize', function () { renderCurve(); });
    document.querySelector('#curve-ch').addEventListener('change', function (ev) {
      App._curveCh = ev.target.value;
      App.selectedKey = null;
      renderKeys();
      renderCurve();
    });
    document.querySelector('#tl-curve-toggle').addEventListener('click', function () {
      App.curveView = !App.curveView;
      this.classList.toggle('on', App.curveView);
      document.querySelector('#tl-tracks').classList.toggle('curve-mode', App.curveView);
      document.querySelector('#curve-canvas').classList.toggle('hidden', !App.curveView);
      document.querySelector('#curve-hint').classList.toggle('hidden', !App.curveView);
      if (App.curveView) setTimeout(renderCurve, 30);
    });
  }

  function bind() {
    const tracks = document.querySelector('#tl-tracks');
    tracks.addEventListener('pointerdown', function (ev) {
      if (ev.target.closest('.key')) return;
      if (App.selectedKey) { App.selectedKey = null; renderKeys(); }
      App.setTime(timeFromEvent(ev));
      const scrub = function (e) { App.setTime(timeFromEvent(e)); };
      const up = function () {
        window.removeEventListener('pointermove', scrub);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', scrub);
      window.addEventListener('pointerup', up);
    });

    window.addEventListener('pointermove', function (ev) {
      if (!draggingKey) return;
      const item = draggingKey;
      const t = timeFromEvent(ev);
      const keys = App.entryTracks(item.entry)[item.ch];
      const k = keys[item.index];
      if (!k) return;
      k.t = t;
      keys.sort(function (a, b) { return a.t - b.t; });
      item.index = keys.indexOf(k);
      App.selectedKey = { ch: item.ch, index: item.index };
      App.setTime(t);
      renderKeys();
    });
    window.addEventListener('pointerup', function () {
      if (draggingKey) { draggingKey = null; App.commitUndo(); }
    });

    /* 动画芯片行 */
    document.querySelector('#clip-add').addEventListener('click', function () { App.addClip(); });
    document.querySelector('#clip-del').addEventListener('click', function () {
      App.deleteClip(App.activeClipId);
    });
    App.on('clips-changed', renderClipChips);
    App.on('clips-changed', function () { if (App.buildRuleRows) App.buildRuleRows(); });
    renderClipChips();

    document.querySelector('#tl-play').addEventListener('click', App.togglePlay);
    document.querySelector('#tl-stop').addEventListener('click', function () {
      App.playing = false;
      App.setTime(0);
      App.updatePlayUI();
    });
    document.querySelector('#tl-end').addEventListener('click', function () {
      App.playing = false;
      App.setTime(App.duration);
      App.updatePlayUI();
    });
    document.querySelector('#tl-record').addEventListener('change', function (ev) {
      App.autoKey = ev.target.checked;
      if (App.autoKey) App.toast('录制已开启：现在拖动/旋转物体，会自动记录到「' + App.activeClip().name + '」🔴');
    });
    document.querySelector('#tl-loop').addEventListener('change', function (ev) { App.loop = ev.target.checked; });
    document.querySelector('#tl-video').addEventListener('click', function () { App.exportVideo(); });
    document.querySelector('#tl-gif').addEventListener('click', function () { App.exportGIF(); });
    document.querySelector('#tl-ease').addEventListener('change', function (ev) {
      App.ease = ev.target.value;
      App.applyTracksAt(App.time);
    });
    document.querySelector('#tl-key-ease').addEventListener('change', function (ev) {
      if (!App.selectedKey || !App.selected) return;
      const k = App.entryTracks(App.selected)[App.selectedKey.ch][App.selectedKey.index];
      if (!k) return;
      if (ev.target.value === 'auto') delete k.e; else k.e = ev.target.value;
      App.applyTracksAt(App.time);
      renderKeys();
      App.commitUndo();
    });
    document.querySelector('#tl-duration').addEventListener('change', function (ev) {
      const maxKeyTime = function () {
        let m = 0;
        App.clipMembers(App.activeClipId).forEach(function (e) {
          const ts = (e.clips && e.clips[App.activeClipId]) || {};
          CHS.forEach(function (ch) {
            (ts[ch] || []).forEach(function (k) { m = Math.max(m, k.t); });
          });
        });
        return m;
      };
      App.duration = App.clamp(Math.round(Number(ev.target.value) || 5), 1, 120);
      ev.target.value = App.duration;
      const c = App.activeClip();
      if (c) c.duration = App.duration;
      App.buildRuler();
      renderKeys();
      App.setTime(Math.min(App.time, App.duration));
      if (maxKeyTime() > App.duration) {
        App.toast('「' + (c ? c.name : '') + '」有关键帧落在 ' + App.duration + 's 之后，暂不参与播放；把时长调大即可恢复', 'warn', 4000);
      }
    });
    document.querySelector('#tl-addkey').addEventListener('click', function () {
      const e = App.selected;
      if (!e) { App.toast('先在场景里选中一个物体', 'warn'); return; }
      App.setKey(e, App.time);
      App.commitUndo();
      App.toast('已在「' + App.activeClip().name + '」' + App.fmt1(App.time) + ' 记录关键帧 ◆');
      App.emit('keyframe');
    });
    document.querySelector('#tl-delkey').addEventListener('click', function () {
      const e = App.selected;
      if (!e || !App.selectedKey) { App.toast('先点选时间轴上的一个菱形关键帧', 'warn'); return; }
      App.entryTracks(e)[App.selectedKey.ch].splice(App.selectedKey.index, 1);
      App.selectedKey = null;
      renderKeys();
      App.setTime(App.time);
      App.commitUndo();
    });

    document.querySelectorAll('.tl-row2 [data-preset]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const e = App.selected;
        if (!e) { App.toast('先在场景里选中一个物体', 'warn'); return; }
        App.applyAnimPreset(e, btn.dataset.preset);
        if (btn.dataset.preset !== 'clear') App.toast('已生成「' + btn.textContent + '」动画，正在播放 ▶（点时间轴可暂停编辑）');
        App.emit('keyframe');
      });
    });

    bindKeyInspector();
    bindCurve();
  }

  App.togglePlay = function () {
    if (!App.entries.some(function (e) { return App.entryHasAnim(e); })) {
      App.toast('还没有任何动画。选中物体后点「◆ 打关键帧」或「一键动画」试试', 'warn');
      return;
    }
    if (!App.preview) {
      const c = App.activeClip();
      if (c && !App.clipHasAnim(c.id)) {
        App.toast('「' + c.name + '」还没有关键帧：选中物体后打关键帧，或点上方芯片切换到其它动画', 'warn');
        return;
      }
    }
    App.playing = !App.playing;
    const win = App.preview ? App.globalDuration() : App.duration;
    if (App.playing && App.time >= win) App.time = 0;
    App.updatePlayUI();
  };

  App.updatePlayUI = function () {
    document.querySelector('#tl-play').innerHTML = App.icon(App.playing ? 'pause' : 'play', 13);
  };

  App.on('selection', renderKeys);
  App.on('tracks-changed', renderKeys);

  /* ---------- 每帧驱动 ---------- */
  App._mixers = App._mixers || {};
  App.hooks.tick.push(function animTick(dt) {
    if (App.playing) {
      const win = App.preview ? App.globalDuration() : App.duration;
      App.time += dt;
      if (App.time >= win) {
        if (App.loop) App.time -= win;
        else { App.time = win; App.playing = false; App.updatePlayUI(); }
      }
      if (App.preview) {
        /* 预览：所有动画同时播放，各自按自己的时长循环/停在末帧 */
        App.clips.forEach(function (c) {
          const lt = App.loop ? (App.time % c.duration) : Math.min(App.time, c.duration);
          App.applyTracksAt(lt, App.clipMembers(c.id), c.id);
        });
      } else {
        /* 编辑器：只播放当前动画的成员 */
        const c = App.activeClip();
        if (c) {
          const lt = App.loop ? (App.time % c.duration) : Math.min(App.time, c.duration);
          App.applyTracksAt(lt, App.clipMembers(c.id), c.id);
        }
      }
      updatePlayhead();
    }
    if (App._locals && App._locals.length) {
      /* 交互规则触发的指定动画播放 */
      const done = [];
      App._locals.forEach(function (L) {
        L.t += dt;
        if (L.t >= L.dur) {
          /* 播完：精确应用末帧姿态再出队 */
          App.applyTracksAt(L.dur, App.clipMembers(L.clipId), L.clipId);
          done.push(L);
          return;
        }
        App.applyTracksAt(Math.min(L.t, L.dur), App.clipMembers(L.clipId), L.clipId);
      });
      App._locals = App._locals.filter(function (L) { return !done.includes(L); });
    }
    /* 模型自带动画 */
    Object.keys(App._mixers).forEach(function (id) {
      const m = App._mixers[id];
      if (m && m.getActionCount && m.getActionCount()) m.update(dt);
    });
  });

  /* 退出预览时停掉所有自带动画 */
  App.on('preview-end', function () {
    Object.keys(App._mixers).forEach(function (id) {
      try { App._mixers[id].stopAllAction(); } catch (e) { /* 忽略 */ }
    });
  });

  bind();
})();

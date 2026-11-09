/* ═══ undo.js — 撤销 / 重做（快照法：变换、材质联动面板、轨道、规则、增删） ═══ */
(function () {
  'use strict';
  const App = window.App;

  const past = [];
  const future = [];
  const MAX = 50;
  let restoring = false;

  function matSnap(e) {
    const o = e.object3D;
    if (o.isLight) {
      return [{ __light: 1, color: o.color.getHex(), intensity: o.intensity, angle: o.isSpotLight ? o.angle : null, penumbra: o.isSpotLight ? o.penumbra : null }];
    }
    return App.entryMaterials(e).map(function (m) {
      return {
        color: m.color ? m.color.getHex() : null,
        metalness: m.metalness != null ? m.metalness : null,
        roughness: m.roughness != null ? m.roughness : null,
        opacity: m.opacity != null ? m.opacity : null,
        transparent: !!m.transparent,
        emissive: m.emissive ? m.emissive.getHex() : null,
        emissiveIntensity: m.emissiveIntensity != null ? m.emissiveIntensity : null,
        map: m.map || null,   /* 贴图走引用快照：撤销/重做可回到贴图应用前 */
      };
    });
  }

  function applyMatSnap(e, snap) {
    if (snap.length === 1 && snap[0].__light) {
      const o = e.object3D;
      o.color.setHex(snap[0].color);
      o.intensity = snap[0].intensity;
      if (snap[0].angle != null && o.isSpotLight) {
        o.angle = snap[0].angle;
        o.penumbra = snap[0].penumbra;
        if (App.syncSpotBeam) App.syncSpotBeam(o);
      }
      return;
    }
    const mats = App.entryMaterials(e);
    snap.forEach(function (s, i) {
      const m = mats[i];
      if (!m) return;
      if (s.color != null && m.color) m.color.setHex(s.color);
      if (s.metalness != null) m.metalness = s.metalness;
      if (s.roughness != null) m.roughness = s.roughness;
      if (s.opacity != null) { m.opacity = s.opacity; m.transparent = s.transparent; m.depthWrite = !s.transparent; }
      if (s.emissive != null && m.emissive) m.emissive.setHex(s.emissive);
      if (s.emissiveIntensity != null) m.emissiveIntensity = s.emissiveIntensity;
      if (s.map !== undefined) { m.map = s.map || null; }   /* 贴图引用还原（null = 无贴图） */
      m.needsUpdate = true;
    });
  }

  function capture() {
    return {
      selectedId: App.selected ? App.selected.id : null,
      clips: JSON.parse(JSON.stringify(App.clips)),
      activeClipId: App.activeClipId,
      assets: App.assets,   /* 引用快照：clearScene 等是整体换对象，撤销可原样找回 */
      entries: App.entries.map(function (e) {
        const o = e.object3D;
        const inPivot = !!(App._multiPivotActive && App._multiPivotActive());
        return {
          entry: e,
          attached: o.parent === App.three.userRoot || inPivot,
          name: e.name,
          visible: o.visible,
          p: o.position.toArray(),
          r: [o.rotation.x, o.rotation.y, o.rotation.z],
          s: o.scale.toArray(),
          mats: matSnap(e),
          clips: JSON.parse(JSON.stringify(e.clips || {})),
          rules: JSON.parse(JSON.stringify(e.rules)),
          preset: e._matPreset || null,
          tex: e._texKind || null,
        };
      }),
    };
  }

  function applyState(st) {
    restoring = true;
    /* 当前多出来的物体先移出场景（entry 保留，重做可找回） */
    App.entries.forEach(function (e) {
      if (!st.entries.some(function (item) { return item.entry === e; }) && e.object3D.parent) {
        e.object3D.parent.remove(e.object3D);
      }
    });
    App.entries = st.entries.map(function (item) { return item.entry; });
    App.assets = st.assets || {};   /* 恢复资产引用：撤销"新建/清空/删除模型"后源模型不丢 */
    /* 动画片段列表与当前编辑动画一并还原 */
    App.clips = JSON.parse(JSON.stringify(st.clips || []));
    App.activeClipId = st.activeClipId || (App.clips[0] && App.clips[0].id) || null;
    App.ensureClips();
    st.entries.forEach(function (item) {
      const e = item.entry, o = e.object3D;
      if (item.attached && o.parent !== App.three.userRoot) App.three.userRoot.add(o);
      if (!item.attached && o.parent) o.parent.remove(o);
      e.name = item.name;
      o.name = item.name;
      o.visible = item.visible;
      o.position.fromArray(item.p);
      o.rotation.set(item.r[0], item.r[1], item.r[2]);
      o.scale.fromArray(item.s);
      if (item.mats) applyMatSnap(e, item.mats);
      e.clips = JSON.parse(JSON.stringify(item.clips || {}));
      e.rules = JSON.parse(JSON.stringify(item.rules));
      e._matPreset = item.preset || null;
      e._texKind = item.tex || null;
    });
    App.duration = App.activeClip() ? App.activeClip().duration : 5;
    const sel = st.selectedId ? App.entries.find(function (e) { return e.id === st.selectedId; }) : null;
    App.select(sel, true);
    App.emit('multiselection');   /* 批量操作条随撤销同步显隐 */
    App.emit('entries');
    App.emit('tracks-changed');
    App.emit('clips-changed');
    App.buildRuler();
    App.refreshAllPanels();
    restoring = false;
  }

  App.commitUndo = function (quiet) {
    if (restoring) return;
    past.push(capture());
    if (past.length > MAX) past.shift();
    future.length = 0;
    App._dirty = !quiet; /* quiet=true 表示基线快照，不算改动 */
    if (!quiet && App._scheduleAutosave) App._scheduleAutosave();
  };

  App.undo = function () {
    if (past.length < 2) { App.toast('没有可撤销的操作', 'warn', 1200); return; }
    clearTimeout(App._nudgeTimer);   /* 取消未提交的方向键微移，避免污染重做栈 */
    future.push(past.pop());
    applyState(past[past.length - 1]);
    App._dirty = true;
    if (App._scheduleAutosave) App._scheduleAutosave();
  };

  App.redo = function () {
    if (!future.length) { App.toast('没有可重做的操作', 'warn', 1200); return; }
    clearTimeout(App._nudgeTimer);
    const st = future.pop();
    past.push(st);
    applyState(st);
    App._dirty = true;
    if (App._scheduleAutosave) App._scheduleAutosave();
  };
})();

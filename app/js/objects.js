/* ═══ objects.js — 物体注册、基础形状、场景树 ═══ */
(function () {
  'use strict';
  const App = window.App, T = () => window.THREE;

  /* ---------- 注册表 ---------- */
  App.register = function (object3D, name) {
    const entry = {
      id: 'e' + (++App.idCounter),
      name: App.uniqueName(name),
      object3D,
      clips: {},                /* 每条命名动画里独立的轨道：{ [clipId]: {position,rotation,scale} } */
      rules: [],
      baseScale: object3D.scale.x !== 0 ? object3D.scale.x : 1, /* 导入模型记录归一尺寸，供「归位」使用 */
    };
    object3D.name = entry.name;
    object3D.userData.entryId = entry.id;
    App.entries.push(entry);
    App.three.userRoot.add(object3D);
    App.emit('entries');
    return entry;
  };

  App.unregister = function (entry) {
    const i = App.entries.indexOf(entry);
    if (i >= 0) App.entries.splice(i, 1);
    if (App._mixers && App._mixers[entry.id]) {
      try { App._mixers[entry.id].stopAllAction(); } catch (e) { /* 忽略 */ }
      delete App._mixers[entry.id];
    }
    if (entry.object3D.parent) entry.object3D.parent.remove(entry.object3D);
    if (App.selected === entry) App.select(null);
    App.emit('entries');
  };

  App.entryById = id => App.entries.find(e => e.id === id);

  /* ---------- 基础形状 ---------- */
  const SHAPES = {
    box:      { name: '立方体', geo: () => new (T()).BoxGeometry(2, 2, 2), y: 1 },
    sphere:   { name: '球体',   geo: () => new (T()).SphereGeometry(1, 40, 28), y: 1 },
    cylinder: { name: '圆柱',   geo: () => new (T()).CylinderGeometry(0.9, 0.9, 2, 36), y: 1 },
    cone:     { name: '圆锥',   geo: () => new (T()).ConeGeometry(1, 2, 36), y: 1 },
    torus:    { name: '圆环',   geo: () => new (T()).TorusGeometry(1, 0.4, 20, 48), y: 1.4 },
    plane:    { name: '平板',   geo: () => new (T()).BoxGeometry(3, 0.2, 3), y: 0.1 },
  };

  App.addPrimitive = function (shape, opts = {}) {
    if (shape === 'plight') return App.addPointLight(opts);
    if (shape === 'slight') return App.addSpotLight(opts);
    if (shape === 'label') return App.addLabel(opts);
    const def = SHAPES[shape];
    if (!def) return null;
    const THREE = T();
    const mat = new THREE.MeshStandardMaterial({
      color: opts.color || new THREE.Color().setHSL(Math.random(), 0.55, 0.6),
      metalness: 0.05, roughness: 0.55,
    });
    const mesh = new THREE.Mesh(def.geo(), mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.position.y = def.y;
    mesh.userData.primitive = shape;
    const entry = App.register(mesh, opts.name || def.name);
    if (!opts.quiet) {
      App.select(entry);
      App.commitUndo();
    }
    App.emit('entry-added', entry);
    return entry;
  };

  /* ---------- 复制 / 删除 ---------- */
  App.duplicateEntry = function (entry) {
    if (!entry) return;
    const THREE = T();
    const copy = entry.object3D.clone(true);
    copy.traverse(o => {
      if (o.isMesh) {
        o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
        o.castShadow = true; o.receiveShadow = true;
      }
    });
    copy.position.x += 1.2; copy.position.z += 1.2;
    const ne = App.register(copy, entry.name.replace(/_\d+$/, '') + '_副本');
    ne.clips = App.deepCopy(entry.clips || {});
    ne.rules = App.deepCopy(entry.rules);
    App.select(ne);
    App.commitUndo();
    App.toast('已复制 → ' + ne.name);
    return ne;
  };

  App.deleteEntry = function (entry) {
    if (!entry) return;
    const name = entry.name;
    App.unregister(entry);
    App.commitUndo();
    App.toast('已删除 ' + name + '（Ctrl+Z 可撤销）');
  };

  /* ---------- 点光源 ---------- */
  App.addPointLight = function (opts = {}) {
    const THREE = T();
    const color = opts.color || '#fff4d6';
    const light = new THREE.PointLight(color, opts.intensity != null ? opts.intensity : 20, 0, 1.8);
    light.position.set(0, 3, 0);
    /* 小球标记，方便点击选中 */
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 16, 12),
      new THREE.MeshBasicMaterial({ color: color })
    );
    light.add(bulb);
    const entry = App.register(light, opts.name || '点光源');
    if (!opts.quiet) {
      App.select(entry);
      App.commitUndo();
    }
    App.emit('entry-added', entry);
    return entry;
  };

  /* ---------- 聚光灯 ---------- */
  /* target 挂在光源自身子节点上：拖动=移动光束位置，旋转=调整照射方向 */
  App.addSpotLight = function (opts = {}) {
    const THREE = T();
    const color = opts.color || '#fff4d6';
    const angle = opts.angle != null ? opts.angle : Math.PI / 6;   /* 30° 锥角 */
    const light = new THREE.SpotLight(color, opts.intensity != null ? opts.intensity : 60, 0, angle, opts.penumbra != null ? opts.penumbra : 0.35, 1.5);
    light.position.set(0, 5, 0);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.bias = -0.0004;
    /* 照射目标：挂在光源子节点正下方 5 格，默认照向地面 */
    light.target.position.set(0, -5, 0);
    light.add(light.target);
    /* 小球标记（可点选）+ 半透明光束锥（指示照射方向和范围） */
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 16, 12),
      new THREE.MeshBasicMaterial({ color: color })
    );
    light.add(bulb);
    const len = 5;
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(Math.tan(angle) * len, len, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide })
    );
    beam.name = '__spot_beam__';
    /* ConeGeometry 尖端天然朝上：定位到灯与目标中点后，尖端正好在灯泡处、底圈落在照射目标 */
    beam.position.y = -len / 2;
    light.add(beam);
    light.userData.lightKind = 'spot';
    light.userData.spotBeam = beam;
    const entry = App.register(light, opts.name || '聚光灯');
    if (!opts.quiet) {
      App.select(entry);
      App.commitUndo();
    }
    App.emit('entry-added', entry);
    return entry;
  };

  /* 光束锥显隐：编辑时可见，预览/导出/发布时隐藏（只保留真实光照） */
  App.setSpotBeamsVisible = function (v) {
    App.entries.forEach(function (e) {
      if (e.object3D.userData.spotBeam) e.object3D.userData.spotBeam.visible = v;
    });
  };

  /* 聚光灯参数变化后同步光束锥外观 */
  App.syncSpotBeam = function (light) {
    if (!light.isSpotLight || !light.userData.spotBeam) return;
    const len = 5;
    const beam = light.userData.spotBeam;
    beam.geometry.dispose();
    beam.geometry = new THREE.ConeGeometry(Math.tan(light.angle) * len, len, 24, 1, true);
  };

  /* ---------- 示例作品（教学用完整场景） ---------- */
  App.loadDemoScene = function () {
    App.clearScene(true);
    const cyl = App.addPrimitive('cylinder', { name: '金色圆柱', color: '#e8b64c', quiet: true });
    cyl.object3D.position.set(-2.5, 1, 0);
    App.applyMatPreset(cyl, 'metal');
    App.applyAnimPreset(cyl, 'spin');

    const sph = App.addPrimitive('sphere', { name: '玻璃球', color: '#7fd4ff', quiet: true });
    sph.object3D.position.set(0.5, 1.6, 0.5);
    App.applyMatPreset(sph, 'glass');
    App.applyAnimPreset(sph, 'float');

    const tor = App.addPrimitive('torus', { name: '发光圆环', color: '#ff6ad5', quiet: true });
    tor.object3D.position.set(3, 1.5, -1);
    App.applyMatPreset(tor, 'glow');
    tor.rules.push({ event: 'click', action: 'message', value: '我是发光圆环 ✨ 点其他物体也有戏看' });
    tor.rules.push({ event: 'hover', action: 'shake', value: null });
    tor.rules.push({ event: 'hover', action: 'sound', value: 'pop' });
    App.applyAnimPreset(tor, 'pulse');

    const lb = App.addLabel({ quiet: true, name: '提示牌', text: '点一点圆环\n有惊喜 ✨', color: '#ffffff', bg: '#e8557f' });
    lb.object3D.position.set(0.2, 4.3, -0.5);

    App.commitUndo();
    App.select(null);
    App.time = 0;
    App.playing = true;
    App.updatePlayUI();
    App.renderKeys();
    App.toast('示例作品已加载，正在播放 ▶ 点一点圆环试试交互', '', 4000);
  };

  /* ---------- 文字标注（3D 气泡牌） ---------- */
  App.renderLabelTexture = function (THREE, text, color, bg) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = '600 56px system-ui, "Microsoft YaHei", sans-serif';
    ctx.font = font;
    const lines = String(text || ' ').split('\n');
    let w = 0;
    lines.forEach(function (ln) { w = Math.max(w, ctx.measureText(ln).width); });
    const padX = 48, padY = 30, lineH = 72;
    canvas.width = Math.ceil(w + padX * 2);
    canvas.height = Math.ceil(lineH * lines.length + padY * 2);
    const c2 = canvas.getContext('2d');
    c2.font = font;
    /* 圆角底 */
    c2.fillStyle = bg;
    const r = 28, W = canvas.width, H = canvas.height;
    c2.beginPath();
    c2.moveTo(r, 0);
    c2.arcTo(W, 0, W, H, r); c2.arcTo(W, H, 0, H, r); c2.arcTo(0, H, 0, 0, r); c2.arcTo(0, 0, W, 0, r);
    c2.closePath(); c2.fill();
    c2.fillStyle = color;
    c2.textAlign = 'center'; c2.textBaseline = 'middle';
    lines.forEach(function (ln, i) {
      c2.fillText(ln, W / 2, padY + lineH * (i + 0.5) - 2);
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { tex: tex, aspect: W / H };
  };

  App.updateLabel = function (entry) {
    const THREE = T();
    const o = entry.object3D;
    const u = o.userData;
    const plane = o.children.find(function (c) { return c.isMesh; });
    if (!plane) return;
    const made = App.renderLabelTexture(THREE, u.labelText, u.labelColor, u.labelBg);
    plane.material.map.dispose();
    plane.material.map = made.tex;
    plane.material.needsUpdate = true;
    plane.geometry.dispose();
    const h = 0.7;
    plane.geometry = new THREE.PlaneGeometry(h * made.aspect, h);
  };

  App.addLabel = function (opts = {}) {
    const THREE = T();
    const text = opts.text || '双击「外观」改这句话';
    const color = opts.color || '#ffffff';
    const bg = opts.bg || '#4da3ff';
    const group = new THREE.Group();
    const made = App.renderLabelTexture(THREE, text, color, bg);
    const h = 0.7;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(h * made.aspect, h),
      new THREE.MeshBasicMaterial({ map: made.tex, transparent: true, side: THREE.DoubleSide, depthWrite: false })
    );
    plane.name = '__billboard_plane__';
    plane.castShadow = false;
    group.add(plane);
    group.position.y = 2.2;
    group.userData.primitive = 'label';
    group.userData.labelText = text;
    group.userData.labelColor = color;
    group.userData.labelBg = bg;
    group.userData.billboard = true;
    const entry = App.register(group, opts.name || '文字牌');
    if (!opts.quiet) {
      App.select(entry);
      App.commitUndo();
    }
    App.emit('entry-added', entry);
    return entry;
  };

  /* ---------- 批量操作 ---------- */
  App.deleteSelected = function () {
    const list = App.selection.slice();
    if (list.length <= 1) { App.deleteEntry(App.selected); return; }
    list.forEach(App.unregister);
    App.select(null);
    App.commitUndo();
    App.toast('已删除 ' + list.length + ' 个物体（Ctrl+Z 可撤销）');
  };

  App.duplicateSelected = function () {
    const list = App.selection.slice();
    if (list.length <= 1) { App.duplicateEntry(App.selected); return; }
    list.forEach(function (e) { App.duplicateEntry(e); });
    App.toast('已复制 ' + list.length + ' 个物体');
  };

  App.dropSelected = function () {
    const list = App.selection.length > 1 ? App.selection.slice() : (App.selected ? [App.selected] : []);
    const THREE = T();
    list.forEach(function (e) {
      e.object3D.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(e.object3D);
      if (!box.isEmpty()) e.object3D.position.y -= box.min.y;
      e.object3D.updateWorldMatrix(true, true);
    });
    if (list.length) {
      App.three.boxHelper.update();
      App._syncMultiBoxes();
      App.commitUndo();
      App.toast(list.length > 1 ? '已把 ' + list.length + ' 个物体落到地面 ⬇' : '已落到地面 ⬇');
    }
  };

  /* ---------- 组合模板（多部件小场景） ---------- */
  App.addTemplate = function (kind, opts = {}) {
    const THREE = T();
    const g = new THREE.Group();
    function part(geo, color, x, y, z, rx) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: color, metalness: 0.05, roughness: 0.6 }));
      m.position.set(x, y, z);
      if (rx) m.rotation.x = rx;
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
      return m;
    }
    if (kind === 'snowman') {
      part(new THREE.SphereGeometry(1, 32, 24), '#ffffff', 0, 1, 0);
      part(new THREE.SphereGeometry(0.68, 32, 24), '#ffffff', 0, 2.3, 0);
      part(new THREE.SphereGeometry(0.45, 32, 24), '#ffffff', 0, 3.2, 0);
      part(new THREE.ConeGeometry(0.12, 0.55, 16), '#ff8833', 0, 3.2, 0.5, Math.PI / 2);
      part(new THREE.CylinderGeometry(0.32, 0.32, 0.1, 24), '#333a45', 0, 3.66, 0);
      part(new THREE.CylinderGeometry(0.22, 0.22, 0.42, 24), '#333a45', 0, 3.9, 0);
      part(new THREE.SphereGeometry(0.06, 12, 10), '#22252c', -0.16, 3.28, 0.4);
      part(new THREE.SphereGeometry(0.06, 12, 10), '#22252c', 0.16, 3.28, 0.4);
    } else if (kind === 'table') {
      part(new THREE.BoxGeometry(2.4, 0.16, 1.4), '#a97142', 0, 0.94, 0);
      [[-1.05, -0.55], [1.05, -0.55], [-1.05, 0.55], [1.05, 0.55]].forEach(function (p) {
        part(new THREE.BoxGeometry(0.14, 0.86, 0.14), '#8f5c33', p[0], 0.43, p[1]);
      });
    } else if (kind === 'tree') {
      part(new THREE.CylinderGeometry(0.16, 0.22, 0.9, 16), '#7a5230', 0, 0.45, 0);
      part(new THREE.ConeGeometry(0.78, 1.3, 24), '#3f9d55', 0, 1.5, 0);
      part(new THREE.ConeGeometry(0.6, 1.1, 24), '#4db06a', 0, 2.25, 0);
    } else if (kind === 'car') {
      part(new THREE.BoxGeometry(1.7, 0.42, 0.95), '#e74c3c', 0, 0.56, 0);
      part(new THREE.BoxGeometry(0.85, 0.36, 0.85), '#5db4e8', -0.08, 0.95, 0);
      [[-0.55, -0.44], [0.55, -0.44], [-0.55, 0.44], [0.55, 0.44]].forEach(function (p) {
        const wheel = part(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 20), '#22252c', p[0], 0.2, p[1]);
        wheel.rotation.z = Math.PI / 2;
      });
    } else if (kind === 'rocket') {
      part(new THREE.CylinderGeometry(0.3, 0.34, 1.5, 24), '#eef2f7', 0, 1.05, 0);
      part(new THREE.ConeGeometry(0.3, 0.55, 24), '#e74c3c', 0, 2.07, 0);
      [[0, 0, 0.42, 0], [0, 0, -0.42, Math.PI], [0.42, 0, 0, Math.PI / 2], [-0.42, 0, 0, -Math.PI / 2]].forEach(function (p) {
        const fin = part(new THREE.BoxGeometry(0.06, 0.55, 0.34), '#e74c3c', p[0], 0.45, p[2]);
        fin.rotation.y = p[3];
      });
      const flame = part(new THREE.ConeGeometry(0.18, 0.45, 16), '#ff9d3c', 0, 0.12, 0);
      flame.rotation.x = Math.PI;
    } else if (kind === 'house') {
      part(new THREE.BoxGeometry(1.7, 1.05, 1.4), '#f0d9b5', 0, 0.52, 0);
      const roof = part(new THREE.ConeGeometry(1.28, 0.75, 4), '#b04a3a', 0, 1.42, 0);
      roof.rotation.y = Math.PI / 4;
      part(new THREE.BoxGeometry(0.34, 0.52, 0.06), '#7a5230', -0.32, 0.26, 0.7);
      part(new THREE.BoxGeometry(0.32, 0.32, 0.06), '#9fd8ff', 0.38, 0.62, 0.7);
    } else {
      return null;
    }
    g.userData.template = kind;
    const names = { snowman: '小雪人', table: '小桌子', tree: '小树', car: '小汽车', rocket: '小火箭', house: '小房子', campfire: '篝火' };
    const entry = App.register(g, opts.name || names[kind] || '模板');
    if (!opts.quiet) {
      App.select(entry);
      App.commitUndo();
    }
    App.emit('entry-added', entry);
    return entry;
  };

  /* ---------- ⭐ 收藏：常用模型一键添加 ---------- */
  const FAVORITES = [
    { id: 'fav-snowman', name: '雪人', icon: '⛄', kind: 'template', ref: 'snowman', tip: '多部件组合体' },
    { id: 'fav-table', name: '桌子', icon: '🪵', kind: 'template', ref: 'table', tip: '多部件组合体' },
    { id: 'fav-tree', name: '小树', icon: '🌲', kind: 'template', ref: 'tree', tip: '多部件组合体' },
    { id: 'fav-car', name: '汽车', icon: '🚗', kind: 'template', ref: 'car', tip: '多部件组合体' },
    { id: 'fav-rocket', name: '火箭', icon: '🚀', kind: 'template', ref: 'rocket', tip: '多部件组合体' },
    { id: 'fav-house', name: '房子', icon: '🏠', kind: 'template', ref: 'house', tip: '多部件组合体' },
    { id: 'fav-tokyo', name: '小东京', icon: '🏮', kind: 'glb', url: './models/LittlestTokyo.glb', tip: 'Draco 压缩示例模型（71 部件）' },
  ];
  App.FAVORITES = FAVORITES;

  /* 用户自定义收藏：存在浏览器本地（localStorage），关闭浏览器也在 */
  App.getUserFavs = function () {
    try { return JSON.parse(localStorage.getItem('litecube_favs') || '[]'); }
    catch (e) { return []; }
  };

  App.saveUserFav = function (entry) {
    if (!entry) return;
    const key = entry.object3D.userData.assetKey;
    const asset = key && App.assets[key];
    if (!asset) { App.toast('这种物体暂不能收藏（支持导入的 GLB/OBJ 模型）', 'warn'); return; }
    const fav = { name: entry.name, fileName: asset.fileName, kind: 'user' };
    if (asset.buffer) {
      fav.b64 = App.bufToB64(asset.buffer);
    } else if (asset.text) {
      fav.srcFormat = 'obj';
      fav.b64 = btoa(unescape(encodeURIComponent(asset.text)));
      if (asset.mtl) fav.mtlB64 = btoa(unescape(encodeURIComponent(asset.mtl)));
      if (asset.texs) fav.texs = asset.texs;
    }
    const list = App.getUserFavs();
    list.push(fav);
    try {
      localStorage.setItem('litecube_favs', JSON.stringify(list));
      App.toast('已加入收藏 ⭐（下次打开也在）');
    } catch (e) {
      App.toast('收藏失败：模型太大，超出浏览器本地存储限制', 'err', 4000);
      return;
    }
    App.buildFavorites();
  };

  App.removeUserFav = function (idx) {
    const list = App.getUserFavs();
    list.splice(idx, 1);
    try { localStorage.setItem('litecube_favs', JSON.stringify(list)); } catch (e) { /* 忽略 */ }
    App.buildFavorites();
  };

  App.buildFavorites = function () {
    const list = document.querySelector('#fav-list');
    if (!list) return;
    list.innerHTML = '';
    FAVORITES.forEach(function (f) {
      const btn = document.createElement('button');
      btn.className = 'fav-card';
      btn.title = f.tip + (f.kind === 'glb' ? ' · 首次点击需加载片刻' : '');
      btn.innerHTML = '<i>' + f.icon + '</i><span>' + f.name + '</span>';
      btn.addEventListener('click', function () { App.addFavorite(f.id); });
      list.appendChild(btn);
    });
    /* 我的收藏（用户保存的模型） */
    const favs = App.getUserFavs();
    if (favs.length) {
      const div = document.createElement('div');
      div.className = 'fav-divider';
      div.textContent = '我的收藏';
      list.appendChild(div);
    }
    favs.forEach(function (f, idx) {
      const btn = document.createElement('button');
      btn.className = 'fav-card';
      btn.title = '我收藏的模型（' + (f.fileName || f.name) + '）';
      btn.innerHTML = '<i>📦</i><span>' + f.name + '</span><b class="fav-del" title="取消收藏">✕</b>';
      btn.addEventListener('click', function (ev) {
        if (ev.target.classList.contains('fav-del')) { App.removeUserFav(idx); return; }
        App.addFavorite('user:' + idx);
      });
      list.appendChild(btn);
    });
  };

  App.addFavorite = function (id) {
    /* 用户收藏：user:索引 */
    if (id && id.indexOf('user:') === 0) {
      const idx = Number(id.slice(5));
      const f = App.getUserFavs()[idx];
      if (!f) return;
      if (location.protocol === 'file:') {
        App.toast('本地文件模式下无法读取收藏模型，请用「启动编辑器.bat」打开', 'warn', 4500);
        return;
      }
      if (f.srcFormat === 'obj') {
        const text = decodeURIComponent(escape(atob(f.b64)));
        const mtlText = f.mtlB64 ? decodeURIComponent(escape(atob(f.mtlB64))) : null;
        const urlMap = {};
        const texB64s = [];
        (f.texs || []).forEach(function (t) {
          const buf = App.b64ToBuf(t.b64);
          urlMap[t.name] = URL.createObjectURL(new Blob([buf]));
          texB64s.push({ name: t.name, b64: t.b64 });
        });
        App.importOBJ(text, mtlText, urlMap, f.fileName || f.name + '.obj', { texB64s: texB64s });
      } else {
        App.importGLBBuffer(App.b64ToBuf(f.b64), f.fileName || f.name + '.glb');
      }
      return;
    }
    const f = FAVORITES.find(function (x) { return x.id === id; });
    if (!f) return;
    if (f.kind === 'template') {
      App.addTemplate(f.ref);
      return;
    }
    if (f.kind === 'glb') {
      if (location.protocol === 'file:') {
        App.toast('本地文件模式下无法读取收藏模型，请用「启动编辑器.bat」打开', 'warn', 4500);
        return;
      }
      App.toast('正在加载收藏模型「' + f.name + '」…', '', 2500);
      fetch(f.url)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.arrayBuffer();
        })
        .then(function (buf) {
          App.importGLBBuffer(buf, f.name + '.glb');
        })
        .catch(function (err) {
          console.error(err);
          App.toast('收藏模型加载失败：' + (err && err.message ? err.message : err), 'err');
        });
    }
  };

  /* ---------- 场景级模板：一键载入完整成品 ---------- */
  App.addSceneTemplate = function (kind, opts = {}) {
    opts = opts || {};
    App.clearScene(true);
    let count = 0;
    const P = function (fn) { fn(); count++; };

    if (kind === 'showcase') {
      /* 产品展示台 */
      P(function () {
        const s = App.addPrimitive('cylinder', { name: '展台', color: '#2c3444', quiet: true });
        s.object3D.scale.set(1.4, 0.35, 1.4);
        s.object3D.position.set(0, 0.18, 0);
      });
      P(function () {
        const ring = App.addPrimitive('torus', { name: '产品光环', color: '#4da3ff', quiet: true });
        ring.object3D.position.set(0, 2.4, 0);
        App.applyMatPreset(ring, 'glow');
        App.applyAnimPreset(ring, 'spin');
      });
      P(function () {
        const gem = App.addPrimitive('sphere', { name: '产品', color: '#7fd4ff', quiet: true });
        gem.object3D.scale.set(0.7, 0.7, 0.7);
        gem.object3D.position.set(0, 1.15, 0);
        App.applyMatPreset(gem, 'glass');
        App.applyAnimPreset(gem, 'float');
        gem.rules.push({ event: 'click', action: 'message', value: '⭐ 这就是我们的明星产品！' });
        gem.rules.push({ event: 'click', action: 'fly' });
      });
      P(function () {
        const l1 = App.addPointLight({ name: '主光灯', color: '#ffd9a0', intensity: 35 });
        l1.object3D.position.set(2.5, 4, 2.5);
      });
      P(function () {
        const l2 = App.addPointLight({ name: '氛围灯', color: '#4da3ff', intensity: 20 });
        l2.object3D.position.set(-3, 3, -2);
      });
      P(function () {
        const lb = App.addLabel({ quiet: true, name: '产品标题', text: '产品名称\n点一下有惊喜', color: '#ffffff', bg: '#2b4a75' });
        lb.object3D.position.set(0, 4.6, 0);
      });
      App.setSceneBg('#101820');
    } else if (kind === 'poem') {
      /* 古诗课件 */
      P(function () {
        const moon = App.addPrimitive('sphere', { name: '月亮', color: '#fff2c9', quiet: true });
        moon.object3D.scale.set(1.1, 1.1, 1.1);
        moon.object3D.position.set(3.2, 5, -3);
        App.applyMatPreset(moon, 'glow');
        App.applyAnimPreset(moon, 'float');
      });
      P(function () {
        App.addTemplate('tree', { quiet: true });
        const tree = App.entries[App.entries.length - 1];
        tree.name = '门前树'; tree.object3D.name = tree.name;
        tree.object3D.position.set(-3, 0, 0.5);
      });
      P(function () {
        App.addTemplate('house', { quiet: true });
        const house = App.entries[App.entries.length - 1];
        house.name = '小屋'; house.object3D.name = house.name;
        house.object3D.position.set(0.5, 0, 1.5);
        house.object3D.rotation.y = -0.5;
      });
      P(function () {
        const l = App.addPointLight({ name: '月光', color: '#cfe0ff', intensity: 25 });
        l.object3D.position.set(3, 6, -2);
      });
      P(function () {
        const lb = App.addLabel({ quiet: true, name: '诗句', text: '床前明月光\n疑是地上霜', color: '#ffffff', bg: '#1d3a5f' });
        lb.object3D.position.set(-0.5, 4.8, -1);
      });
      const poemLabel = App.entries.find(e => e.name === '诗句');
      if (poemLabel) poemLabel.rules.push({ event: 'click', action: 'message', value: '举头望明月，低头思故乡。——李白《静夜思》' });
      App.setSceneBg('#0d1424');
    } else if (kind === 'birthday') {
      /* 生日贺卡 */
      P(function () {
        const c1 = App.addPrimitive('cylinder', { name: '蛋糕底', color: '#ffd9e8', quiet: true });
        c1.object3D.scale.set(1.3, 0.5, 1.3); c1.object3D.position.set(0, 0.26, 0);
        const c2 = App.addPrimitive('cylinder', { name: '蛋糕中', color: '#fff6e8', quiet: true });
        c2.object3D.scale.set(0.95, 0.45, 0.95); c2.object3D.position.set(0, 0.73, 0);
        const c3 = App.addPrimitive('cylinder', { name: '蛋糕顶', color: '#ffd9e8', quiet: true });
        c3.object3D.scale.set(0.6, 0.4, 0.6); c3.object3D.position.set(0, 1.15, 0);
      });
      P(function () {
        const candle = App.addPrimitive('cylinder', { name: '蜡烛', color: '#ff6ad5', quiet: true });
        candle.object3D.scale.set(0.12, 0.5, 0.12); candle.object3D.position.set(0, 1.55, 0);
        App.applyMatPreset(candle, 'glow');
      });
      P(function () {
        const ring = App.addPrimitive('torus', { name: '彩带', color: '#ffd166', quiet: true });
        ring.object3D.position.set(0, 2.6, 0);
        ring.object3D.rotation.x = 1.2;
        App.applyMatPreset(ring, 'glow');
        App.applyAnimPreset(ring, 'spin');
        ring.rules.push({ event: 'click', action: 'sound', value: 'ding' });
        ring.rules.push({ event: 'click', action: 'message', value: '🎂 生日快乐！' });
      });
      P(function () {
        const l = App.addPointLight({ name: '暖光', color: '#ffd9a0', intensity: 30 });
        l.object3D.position.set(2, 4, 2);
      });
      P(function () {
        const lb = App.addLabel({ quiet: true, name: '祝福', text: 'Happy Birthday\n🎂 生日快乐 🎂', color: '#ffffff', bg: '#e8557f' });
        lb.object3D.position.set(0, 4.4, 0);
      });
      App.setSceneBg('#241526');
    } else if (kind === 'classroom') {
      /* 课堂朗读 */
      P(function () {
        const desk = App.addPrimitive('box', { name: '讲台', color: '#a97142', quiet: true });
        desk.object3D.scale.set(1.6, 0.5, 1); desk.object3D.position.set(0, 0.25, 0);
      });
      P(function () {
        const p1 = App.addPrimitive('box', { name: '书页左', color: '#f5efe0', quiet: true });
        p1.object3D.scale.set(0.55, 0.04, 0.7); p1.object3D.position.set(-0.29, 0.55, 0); p1.object3D.rotation.z = 0.12;
        const p2 = App.addPrimitive('box', { name: '书页右', color: '#f5efe0', quiet: true });
        p2.object3D.scale.set(0.55, 0.04, 0.7); p2.object3D.position.set(0.29, 0.55, 0); p2.object3D.rotation.z = -0.12;
      });
      P(function () {
        const book = App.entries.find(e => e.name === '书页左');
        if (book) {
          book.rules.push({ event: 'click', action: 'message', value: '📖 跟我一起大声朗读吧！' });
          book.rules.push({ event: 'click', action: 'sound', value: 'ding' });
        }
      });
      P(function () {
        const lb = App.addLabel({ quiet: true, name: '课文', text: '跟我一起读\n📖 Open the book', color: '#ffffff', bg: '#2f7d4f' });
        lb.object3D.position.set(0, 3.6, -0.5);
      });
      const bookEntry = App.entries.find(e => e.name === '书页左');
      if (bookEntry) bookEntry.object3D.position.y = 0.62;
      App.setSceneBg('#1c2430');
    } else if (kind === 'festival') {
      /* 新春灯笼 */
      P(function () {
        const l1 = App.addPrimitive('sphere', { name: '灯笼一', color: '#e8452c', quiet: true });
        l1.object3D.scale.set(0.8, 1, 0.8); l1.object3D.position.set(-1.6, 3, 0);
        App.applyMatPreset(l1, 'glow');
        const l2 = App.addPrimitive('sphere', { name: '灯笼二', color: '#e8452c', quiet: true });
        l2.object3D.scale.set(0.8, 1, 0.8); l2.object3D.position.set(1.6, 3.6, -0.5);
        App.applyMatPreset(l2, 'glow');
      });
      P(function () {
        const tassel = App.addPrimitive('cylinder', { name: '灯笼穗', color: '#ffd166', quiet: true });
        tassel.object3D.scale.set(0.08, 0.4, 0.08); tassel.object3D.position.set(-1.6, 2.1, 0);
      });
      P(function () {
        const l = App.addPointLight({ name: '灯笼光', color: '#ff9d5c', intensity: 30 });
        l.object3D.position.set(0, 3.4, 1.5);
      });
      P(function () {
        const lb = App.addLabel({ quiet: true, name: '贺词', text: '🏮 新春快乐\n万事如意', color: '#ffe9c9', bg: '#a32020' });
        lb.object3D.position.set(0, 5.2, 0);
        lb.rules.push({ event: 'click', action: 'sound', value: 'dong' });
      });
      App.setSceneBg('#1c1013');
    } else if (kind === 'campfire') {
      /* 篝火营地 */
      P(function () {
        [[-0.8, 0.2, 0], [0.8, 0.2, 0.2], [0.1, 0.2, -0.85], [0.15, 0.2, 0.85], [-0.4, 0.2, 0.6], [0.5, 0.2, -0.5]].forEach(function (p) {
          const stone = App.addPrimitive('sphere', { name: '石头', color: '#6b7280', quiet: true });
          stone.object3D.scale.set(0.35, 0.28, 0.35);
          stone.object3D.position.set(p[0], p[1], p[2]);
        });
      });
      P(function () {
        const w1 = App.addPrimitive('cylinder', { name: '木柴一', color: '#7a5230', quiet: true });
        w1.object3D.scale.set(0.09, 0.6, 0.09); w1.object3D.rotation.z = Math.PI / 2.4; w1.object3D.position.set(0, 0.18, 0);
        const w2 = App.addPrimitive('cylinder', { name: '木柴二', color: '#6b4525', quiet: true });
        w2.object3D.scale.set(0.09, 0.6, 0.09); w2.object3D.rotation.x = Math.PI / 2.4; w2.object3D.position.set(0, 0.18, 0);
      });
      P(function () {
        const fire = App.addPrimitive('cone', { name: '火焰', color: '#ff9d3c', quiet: true });
        fire.object3D.scale.set(0.5, 1, 0.5); fire.object3D.position.set(0, 0.95, 0);
        App.applyMatPreset(fire, 'glow');
        App.applyAnimPreset(fire, 'pulse');
        fire.rules.push({ event: 'click', action: 'sound', value: 'pop' });
        fire.rules.push({ event: 'hover', action: 'color', value: '#ffd166' });
      });
      P(function () {
        const l = App.addPointLight({ name: '火光', color: '#ff9d3c', intensity: 40 });
        l.object3D.position.set(0, 1.6, 0);
      });
      P(function () {
        const lb = App.addLabel({ quiet: true, name: '营地告示', text: '🏕 篝火营地\n点一下火焰试试', color: '#ffe9c9', bg: '#7a3b12' });
        lb.object3D.position.set(0, 3.6, 0);
      });
      App.setSceneBg('#151a24');
    } else if (kind === 'space') {
      /* 太空探索 */
      P(function () {
        const earth = App.addPrimitive('sphere', { name: '地球', color: '#3b82f6', quiet: true });
        earth.object3D.position.set(0, 2, 0);
        App.applyMatPreset(earth, 'plastic');
        App.applyAnimPreset(earth, 'spin');
      });
      P(function () {
        const ring = App.addPrimitive('torus', { name: '卫星环', color: '#cbd5e1', quiet: true });
        ring.object3D.scale.set(1.4, 1.4, 1.4);
        ring.object3D.position.set(0, 2, 0);
        ring.object3D.rotation.x = Math.PI / 2.6;
        App.applyMatPreset(ring, 'metal');
      });
      P(function () {
        const moon = App.addPrimitive('sphere', { name: '月球', color: '#d1d5db', quiet: true });
        moon.object3D.scale.set(0.3, 0.3, 0.3);
        moon.object3D.position.set(2.6, 3, 0.5);
        App.applyAnimPreset(moon, 'circle');
      });
      P(function () {
        const sun = App.addPointLight({ name: '阳光', color: '#fff4d6', intensity: 45 });
        sun.object3D.position.set(5, 5, 3);
      });
      P(function () {
        const lb = App.addLabel({ quiet: true, name: '探索牌', text: '🚀 太空探索\n点一点地球', color: '#ffffff', bg: '#1e3a8a' });
        lb.object3D.position.set(0, 4.8, 0);
      });
      App.setSceneBg('#05070f');
    } else {
      return null;
    }

    App.commitUndo();
    App.select(null);
    App.time = 0;
    App.playing = true;
    App.updatePlayUI();
    App.renderKeys();
    App.toast('场景已就绪 ▶ 正在播放；点「⏹ 退出预览」回去编辑', '', 4200);
    App.emit('entry-added', null);
    return count;
  };

  /* ---------- 场景树 ---------- */

  App.buildTree = function () {
    const tree = App.$('#tree');
    tree.innerHTML = '';
    App.$('#tree-empty').style.display = App.entries.length ? 'none' : '';
    for (const entry of App.entries) {
      const li = App.el('li', (App.selection.includes(entry) ? 'on ' : '') + (entry.object3D.visible ? '' : 'dim-entry'));
      li.dataset.id = entry.id;

      const icon = App.el('span', 'tico', App.icon(entry.object3D.isSpotLight ? 'spot' : (entry.object3D.isLight ? 'bulb' : (entry.object3D.userData && entry.object3D.userData.primitive === 'label' ? 'label' : 'cube')), 14));
      const name = App.el('span', 'name', entry.name);
      const vis = App.el('span', 'vis' + (entry.object3D.visible ? '' : ' off'), App.icon(entry.object3D.visible ? 'eyeOn' : 'eyeOff', 17));
      vis.title = entry.object3D.visible ? '隐藏该物体' : '显示该物体';

      li.append(icon, name, vis);
      li.addEventListener('click', ev => {
        if (ev.target === vis) return;
        App.select(entry);
      });
      vis.addEventListener('click', () => {
        entry.object3D.visible = !entry.object3D.visible;
        vis.innerHTML = App.icon(entry.object3D.visible ? 'eyeOn' : 'eyeOff', 17);
        vis.classList.toggle('off', !entry.object3D.visible);
        li.classList.toggle('dim-entry', !entry.object3D.visible);
        App.commitUndo();
      });
      name.addEventListener('dblclick', () => startTreeRename(entry));
      tree.appendChild(li);
    }
  };

  /* 行内重命名（双击名字或右键菜单触发） */
  function startTreeRename(entry) {
    const li = document.querySelector('#tree li[data-id="' + entry.id + '"]');
    if (!li) { App.toast('请在左侧场景树里重命名', 'warn'); return; }
    const nameEl = li.querySelector('.name');
    if (!nameEl) return;
    const input = App.el('input');
    input.value = entry.name;
    nameEl.replaceWith(input);
    input.focus(); input.select();
    const done = function () {
      entry.name = App.uniqueName(input.value.trim() || entry.name);
      entry.object3D.name = entry.name;
      App.emit('entries');
      App.emit('selection');
    };
    input.addEventListener('blur', done);
    input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') input.blur(); });
  }
  App.startTreeRename = startTreeRename;

  App.on('entries', () => App.buildTree());
  App.on('selection', () => App.buildTree());
})();

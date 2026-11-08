/* ═══ materials.js — 外观面板：颜色、金属感、粗糙度、透明、发光、贴图、预设 ═══ */
(function () {
  'use strict';
  const App = window.App;
  const T = () => window.THREE;

  /* 收集一个物体的所有材质 */
  App.entryMaterials = function (entry) {
    const mats = [];
    entry.object3D.traverse(function (o) {
      if (o.isMesh) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        list.forEach(function (m) {
          if (m && !mats.includes(m)) mats.push(m);
        });
      }
    });
    return mats;
  };

  /* 大白话材质预设 */
  const PRESETS = {
    metal:   { metalness: 0.95, roughness: 0.22, opacity: 1, emissive: 0 },
    plastic: { metalness: 0.0,  roughness: 0.55, opacity: 1, emissive: 0 },
    glass:   { metalness: 0.0,  roughness: 0.06, opacity: 0.35, emissive: 0 },
    glow:    { metalness: 0.0,  roughness: 0.5,  opacity: 1, emissive: 1.4 },
    ceramic: { metalness: 0.0,  roughness: 0.15, opacity: 1, emissive: 0 },
  };

  let texRepeat = 1;

  /* 选中态高亮同步：跟随当前选中物体的预设 / 贴图状态 */
  App.syncMatPresetUI = function () {
    const e = App.selected;
    document.querySelectorAll('#tab-material .mat-preset').forEach(function (btn) {
      btn.classList.toggle('on', !!e && e._matPreset === btn.dataset.preset);
    });
    document.querySelectorAll('.tex-row [data-tex]').forEach(function (btn) {
      btn.classList.toggle('on', !!e && e._texKind === btn.dataset.tex);
    });
  };

  App.applyMatPreset = function (entry, key) {
    const p = PRESETS[key];
    if (!p || !entry) return;
    /* 记录套用前的材质快照：再次点击同一预设时据此还原 */
    entry._matPresetBackup = App.entryMaterials(entry).map(function (m) {
      return {
        metalness: m.metalness,
        roughness: m.roughness,
        opacity: m.opacity,
        transparent: !!m.transparent,
        depthWrite: m.depthWrite !== false,
        emissive: m.emissive ? '#' + m.emissive.getHexString() : null,
        emissiveIntensity: m.emissiveIntensity,
      };
    });
    App.entryMaterials(entry).forEach(function (m) {
      m.metalness = p.metalness;
      m.roughness = p.roughness;
      m.transparent = p.opacity < 1;
      m.opacity = p.opacity;
      m.depthWrite = p.opacity >= 1;
      if (p.emissive) {
        if (!m.emissive) m.emissive = new (T()).Color();
        m.emissive.copy(m.color ? m.color : new (T()).Color('#ffffff'));
        m.emissiveIntensity = p.emissive;
      } else if (m.emissive) {
        m.emissive.setRGB(0, 0, 0);
        m.emissiveIntensity = 0;
      }
      m.needsUpdate = true;
    });
    entry._matPreset = key;
    App.refreshMaterialPanel();
    App.commitUndo();
    App.emit('material-changed');
  };

  /* 取消预设：还原为套用前的材质 */
  App.restoreMatPreset = function (entry) {
    if (!entry) return;
    const backup = entry._matPresetBackup;
    if (backup) {
      const mats = App.entryMaterials(entry);
      backup.forEach(function (s, i) {
        const m = mats[i];
        if (!m) return;
        m.metalness = s.metalness;
        m.roughness = s.roughness;
        m.opacity = s.opacity;
        m.transparent = s.transparent;
        m.depthWrite = s.depthWrite;
        if (s.emissive && m.emissive) m.emissive.set(s.emissive);
        m.emissiveIntensity = s.emissiveIntensity;
        m.needsUpdate = true;
      });
    }
    entry._matPreset = null;
    entry._matPresetBackup = null;
    App.refreshMaterialPanel();
    App.commitUndo();
    App.emit('material-changed');
  };

  App.setMatColor = function (entry, hex, commit) {
    App.entryMaterials(entry).forEach(function (m) {
      if (m.color) {
        m.color.set(hex);
        m.needsUpdate = true;
      }
    });
    if (commit) {
      App.commitUndo();
      App.emit('material-changed');
    }
  };

  App.setMatProp = function (entry, prop, value) {
    App.entryMaterials(entry).forEach(function (m) {
      if (prop === 'opacity') {
        m.opacity = value;
        m.transparent = value < 1;
        m.depthWrite = value >= 1;
      } else if (prop === 'emissive') {
        if (!m.emissive) m.emissive = new (T()).Color();
        m.emissive.set(value);
      } else if (prop === 'emissiveIntensity') {
        if (!m.emissive) m.emissive = new (T()).Color();
        m.emissiveIntensity = value;
      } else if (m[prop] !== undefined) {
        m[prop] = value;
      }
      m.needsUpdate = true;
    });
  };

  /* ---------- 贴图 ---------- */
  App.applyTexture = function (entry, url) {
    const THREE = T();
    const tex = new THREE.TextureLoader().load(url, function () {
      App.toast('贴图已应用 🖼');
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(texRepeat, texRepeat);
    App.entryMaterials(entry).forEach(function (m) {
      m.map = tex;
      m.needsUpdate = true;
    });
    App.commitUndo();
    App.emit('material-changed');
  };

  App.removeTexture = function (entry) {
    App.entryMaterials(entry).forEach(function (m) {
      if (m.map) {
        m.map.dispose();
        m.map = null;
      }
      m.needsUpdate = true;
    });
    App.commitUndo();
    App.emit('material-changed');
  };

  App.setTextureRepeat = function (entry, v) {
    texRepeat = v;
    App.entryMaterials(entry).forEach(function (m) {
      if (m.map) m.map.repeat.set(v, v);
    });
  };

  /* ---------- 内置程序化贴图（无需上传，离线可用） ---------- */
  const TEX_MAKERS = {
    wood: function (ctx, s) {
      ctx.fillStyle = '#b5854b';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = 'rgba(92,56,20,' + (0.07 + Math.random() * 0.15).toFixed(3) + ')';
        ctx.fillRect(Math.random() * s, 0, 4 + Math.random() * 16, s);
      }
      ctx.strokeStyle = 'rgba(70,40,12,0.3)';
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.ellipse(Math.random() * s, Math.random() * s, 5 + Math.random() * 18, 3 + Math.random() * 7, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    },
    brick: function (ctx, s) {
      ctx.fillStyle = '#cfc6b8';
      ctx.fillRect(0, 0, s, s);
      const bh = 62, gap = 8, bw = 120;
      for (let row = 0; row * (bh + gap) < s + bh; row++) {
        const y = row * (bh + gap);
        const off = row % 2 === 0 ? 0 : -bw / 2;
        for (let x = off; x < s + bw; x += bw + gap) {
          const tint = 0.85 + Math.random() * 0.3;
          ctx.fillStyle = 'rgb(' + Math.round(163 * tint) + ',' + Math.round(74 * tint) + ',' + Math.round(51 * tint) + ')';
          ctx.fillRect(x, y, bw, bh);
        }
      }
    },
    checker: function (ctx, s) {
      const n = 8, c = s / n;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          ctx.fillStyle = (i + j) % 2 === 0 ? '#f2f2f2' : '#37414f';
          ctx.fillRect(i * c, j * c, c, c);
        }
      }
    },
    dots: function (ctx, s) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, s, s);
      const step = 64, r = 22;
      for (let row = 0; row * step < s + step; row++) {
        for (let x = (row % 2 === 0 ? 0 : step / 2); x < s + step; x += step) {
          ctx.fillStyle = '#4da3ff';
          ctx.beginPath();
          ctx.arc(x, row * step, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  };

  App.applyBuiltinTexture = function (entry, kind) {
    const THREE = T();
    const maker = TEX_MAKERS[kind];
    if (!maker || !entry) return;
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    maker(canvas.getContext('2d'), size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(texRepeat, texRepeat);
    App.entryMaterials(entry).forEach(function (m) {
      m.map = tex;
      m.needsUpdate = true;
    });
    App.syncMatPresetUI();
    App.commitUndo();
    App.emit('material-changed');
  };

  /* ---------- 外观格式刷 ---------- */
  App.copyLook = function (entry) {
    if (!entry) return;
    App._copiedLook = App.entryMaterials(entry).map(function (m) {
      return {
        color: m.color ? '#' + m.color.getHexString() : null,
        metalness: m.metalness, roughness: m.roughness,
        opacity: m.opacity, transparent: !!m.transparent,
        emissive: m.emissive ? '#' + m.emissive.getHexString() : null,
        emissiveIntensity: m.emissiveIntensity,
        map: m.map ? m.map.clone() : null,
      };
    });
    App.toast('外观已复制，选中别的物体点「粘贴外观」🧴');
  };

  App.pasteLook = function (entry) {
    if (!entry) return;
    if (!App._copiedLook) { App.toast('先在别的物体上「复制外观」', 'warn'); return; }
    const mats = App.entryMaterials(entry);
    App._copiedLook.forEach(function (s, i) {
      const m = mats[i];
      if (!m) return;
      if (s.color && m.color) m.color.set(s.color);
      if (s.metalness != null) m.metalness = s.metalness;
      if (s.roughness != null) m.roughness = s.roughness;
      if (s.opacity != null) { m.opacity = s.opacity; m.transparent = s.transparent; m.depthWrite = !s.transparent; }
      if (s.emissive && m.emissive) m.emissive.set(s.emissive);
      if (s.emissiveIntensity != null) m.emissiveIntensity = s.emissiveIntensity;
      if (s.map) {
        s.map.repeat.set(texRepeat, texRepeat);
        m.map = s.map;
      } else {
        m.map = null;
      }
      m.needsUpdate = true;
    });
    App.refreshMaterialPanel();
    App.commitUndo();
    App.toast('外观已粘贴 📋');
    App.emit('material-changed');
  };

  /* ---------- 面板刷新 ---------- */
  App.refreshMaterialPanel = function () {
    App.syncMatPresetUI();
    const entry = App.selected;
    const page = document.querySelector('#tab-material');
    page.classList.toggle('has-sel', !!entry);
    if (!entry) return;
    const isLight = !!entry.object3D.isLight;
    document.querySelector('#mt-light').classList.toggle('hidden', !isLight);
    document.querySelector('#lt-spot').classList.toggle('hidden', !isLight || !entry.object3D.isSpotLight);
    document.querySelector('#mt-pbr').classList.toggle('hidden', isLight);
    if (isLight) {
      const l = entry.object3D;
      document.querySelector('#lt-color').value = '#' + l.color.getHexString();
      document.querySelector('#lt-intensity').value = l.intensity;
      document.querySelector('#lt-intensity').nextElementSibling.textContent = Math.round(l.intensity);
      if (l.isSpotLight) {
        const deg = Math.round(l.angle * 180 / Math.PI);
        document.querySelector('#lt-angle').value = deg;
        document.querySelector('#lt-angle').nextElementSibling.textContent = deg + '°';
        document.querySelector('#lt-penumbra').value = l.penumbra;
        document.querySelector('#lt-penumbra').nextElementSibling.textContent = Number(l.penumbra).toFixed(2);
      }
      return;
    }
    const isLabel = !!(entry.object3D.userData && entry.object3D.userData.labelText !== undefined);
    document.querySelector('#mt-label').classList.toggle('hidden', !isLabel);
    document.querySelector('#mt-pbr').classList.toggle('hidden', isLabel);
    if (isLabel) {
      document.querySelector('#lb-text').value = entry.object3D.userData.labelText;
      document.querySelector('#lb-color').value = entry.object3D.userData.labelColor;
      document.querySelector('#lb-bg').value = entry.object3D.userData.labelBg;
      return;
    }
    const mats = App.entryMaterials(entry);
    if (!mats.length) return;
    const m = mats[0];
    const metal = Number(m.metalness != null ? m.metalness : 0);
    const rough = Number(m.roughness != null ? m.roughness : 0.5);
    const opacity = Number(m.opacity != null ? m.opacity : 1);
    document.querySelector('#mt-color').value = '#' + (m.color ? m.color.getHexString() : 'ffffff');
    document.querySelector('#mt-metal').value = metal;
    document.querySelector('#mt-metal').nextElementSibling.textContent = metal.toFixed(2);
    document.querySelector('#mt-rough').value = rough;
    document.querySelector('#mt-rough').nextElementSibling.textContent = rough.toFixed(2);
    document.querySelector('#mt-opacity').value = opacity;
    document.querySelector('#mt-opacity').nextElementSibling.textContent = opacity.toFixed(2);
    document.querySelector('#mt-emis-color').value = '#' + (m.emissive ? m.emissive.getHexString() : '000000');
    document.querySelector('#mt-emis-i').value = Number(m.emissiveIntensity != null ? m.emissiveIntensity : 0);
  };

  /* ---------- 事件绑定 ---------- */
  function bind() {
    function cur() { return App.selected; }

    /* 灯光控制 */
    document.querySelector('#lt-color').addEventListener('input', function () {
      const e = cur();
      if (!e || !e.object3D.isLight) return;
      const v = this.value;
      e.object3D.color.set(v);
      e.object3D.children.forEach(function (c) {
        if (c.isMesh && c.material && c.material.color) c.material.color.set(v);
      });
    });
    document.querySelector('#lt-color').addEventListener('change', function () { App.commitUndo(); });
    document.querySelector('#lt-intensity').addEventListener('input', function () {
      const e = cur();
      if (!e || !e.object3D.isLight) return;
      e.object3D.intensity = Number(this.value);
      this.nextElementSibling.textContent = this.value;
    });
    document.querySelector('#lt-intensity').addEventListener('change', function () { App.commitUndo(); });
    document.querySelector('#lt-angle').addEventListener('input', function () {
      const e = cur();
      if (!e || !e.object3D.isSpotLight) return;
      e.object3D.angle = Number(this.value) * Math.PI / 180;
      this.nextElementSibling.textContent = this.value + '°';
      App.syncSpotBeam(e.object3D);
    });
    document.querySelector('#lt-angle').addEventListener('change', function () { App.commitUndo(); });
    document.querySelector('#lt-penumbra').addEventListener('input', function () {
      const e = cur();
      if (!e || !e.object3D.isSpotLight) return;
      e.object3D.penumbra = Number(this.value);
      this.nextElementSibling.textContent = Number(this.value).toFixed(2);
    });
    document.querySelector('#lt-penumbra').addEventListener('change', function () { App.commitUndo(); });

    document.querySelector('#tab-material').addEventListener('input', function (ev) {
      const e = cur();
      if (!e) return;
      const id = ev.target.id;
      if (id === 'mt-color') {
        App.setMatColor(e, ev.target.value, false);
      } else if (id === 'mt-metal') {
        App.setMatProp(e, 'metalness', Number(ev.target.value));
        ev.target.nextElementSibling.textContent = Number(ev.target.value).toFixed(2);
      } else if (id === 'mt-rough') {
        App.setMatProp(e, 'roughness', Number(ev.target.value));
        ev.target.nextElementSibling.textContent = Number(ev.target.value).toFixed(2);
      } else if (id === 'mt-opacity') {
        App.setMatProp(e, 'opacity', Number(ev.target.value));
        ev.target.nextElementSibling.textContent = Number(ev.target.value).toFixed(2);
      } else if (id === 'mt-emis-color') {
        App.setMatProp(e, 'emissive', ev.target.value);
      } else if (id === 'mt-emis-i') {
        App.setMatProp(e, 'emissiveIntensity', Number(ev.target.value));
      } else if (id === 'mt-tex-repeat') {
        App.setTextureRepeat(e, Number(ev.target.value));
        ev.target.nextElementSibling.textContent = ev.target.value;
      }
    });

    document.querySelector('#tab-material').addEventListener('change', function (ev) {
      if (ev.target.id === 'mt-color' || ev.target.id === 'mt-emis-color') {
        App.commitUndo();
        App.emit('material-changed');
      }
    });

    document.querySelectorAll('#tab-material .mat-preset').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const e = cur();
        if (!e) return;
        const kind = btn.dataset.preset;
        if (e._matPreset === kind) {
          App.restoreMatPreset(e); /* 再点一次：取消选中，还原套用前的材质 */
          App.toast('已还原为原来的材质');
          return;
        }
        App.applyMatPreset(e, kind);
        const name = btn.querySelector('span') ? btn.querySelector('span').textContent : kind;
        App.toast('已套用「' + name + '」质感，可继续微调；再点一次可还原 ✨');
      });
    });

    document.querySelector('#mt-tex-btn').addEventListener('click', function () {
      document.querySelector('#file-texture').click();
    });
    document.querySelector('#file-texture').addEventListener('change', function (ev) {
      const file = ev.target.files[0];
      if (file && App.selected) {
        App.applyTexture(App.selected, URL.createObjectURL(file));
        App.selected._texKind = null; /* 自定义贴图不属于内置款，清除内置选中态 */
        App.syncMatPresetUI();
      }
      ev.target.value = '';
    });
    document.querySelector('#mt-tex-remove').addEventListener('click', function () {
      if (App.selected) {
        App.removeTexture(App.selected);
        App.selected._texKind = null;
        App.syncMatPresetUI();
      }
    });

    document.querySelectorAll('.tex-row [data-tex]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const e = App.selected;
        if (!e) { App.toast('先选中一个物体', 'warn'); return; }
        const kind = btn.dataset.tex;
        if (e._texKind === kind) {
          App.removeTexture(e); /* 再点一次：取消选中，恢复无贴图 */
          e._texKind = null;
          App.syncMatPresetUI();
          App.toast('已移除贴图，恢复原状');
          return;
        }
        e._texKind = kind;
        App.applyBuiltinTexture(e, kind);
        const name = btn.textContent.trim();
        App.toast('已应用「' + name + '」贴图；再点一次可还原');
      });
    });

    document.querySelector('#mt-copy-look').addEventListener('click', function () {
      if (App.selected) App.copyLook(App.selected);
    });
    document.querySelector('#mt-paste-look').addEventListener('click', function () {
      if (App.selected) App.pasteLook(App.selected);
    });

    document.querySelector('#lb-apply').addEventListener('click', function () {
      const e = App.selected;
      if (!e || !e.object3D.userData || e.object3D.userData.labelText === undefined) return;
      e.object3D.userData.labelText = document.querySelector('#lb-text').value || ' ';
      e.object3D.userData.labelColor = document.querySelector('#lb-color').value;
      e.object3D.userData.labelBg = document.querySelector('#lb-bg').value;
      App.updateLabel(e);
      App.commitUndo();
      App.toast('文字已更新 💬');
    });
  }

  bind();
})();

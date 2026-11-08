/* ═══ io.js — GLB 导入导出、工程保存/打开、一键发布互动网页 ═══ */
(function () {
  'use strict';
  const App = window.App;
  const T = () => window.THREE;
  const A = () => window.ADDONS;

  /* ═══════════ GLB 导入 ═══════════ */

  App.importGLBFile = function (file) {
    if (/\.obj$/i.test(file.name)) {
      const txtReader = new FileReader();
      txtReader.onload = function () { App.importOBJ(txtReader.result, null, null, file.name); };
      txtReader.readAsText(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = function () {
      App.importGLBBuffer(reader.result, file.name);
    };
    reader.readAsArrayBuffer(file);
  };

  /* OBJ + MTL + 贴图 多文件导入 */
  App.importOBJFiles = function (fileList) {
    const arr = Array.from(fileList);
    const objFile = arr.find(function (f) { return /\.obj$/i.test(f.name); });
    if (!objFile) { App.toast('没有找到 .obj 文件', 'warn'); return; }
    const mtlFile = arr.find(function (f) { return /\.mtl$/i.test(f.name); });
    const texFiles = arr.filter(function (f) { return !/\.(obj|mtl)$/i.test(f.name); });
    function readAs(f, mode) {
      return new Promise(function (res, rej) {
        const r = new FileReader();
        r.onload = function () { res(r.result); };
        r.onerror = rej;
        if (mode === 'text') r.readAsText(f); else r.readAsArrayBuffer(f);
      });
    }
    const jobs = [readAs(objFile, 'text'), mtlFile ? readAs(mtlFile, 'text') : Promise.resolve(null)];
    texFiles.forEach(function (f) {
      jobs.push(readAs(f, 'buf').then(function (buf) {
        return { name: f.name.toLowerCase(), buf: buf };
      }));
    });
    Promise.all(jobs).then(function (results) {
      const objText = results[0];
      const mtlText = results[1];
      const urlMap = {};
      const texB64s = [];
      results.slice(2).forEach(function (t) {
        if (!t) return;
        urlMap[t.name] = URL.createObjectURL(new Blob([t.buf]));
        texB64s.push({ name: t.name, b64: App.bufToB64(t.buf) });
      });
      App.importOBJ(objText, mtlText, urlMap, objFile.name, { texB64s: texB64s });
    });
  };

  /* 落地对齐 + 尺寸归一 + 原点锚定到底部中心（GLB/OBJ 共用）
     锚定后：缩放模型始终以地面为基准向上生长，落地/归位数学生可靠 */
  App._normalizeObject = function (root, quiet) {
    const THREE = T();
    const savedScale = root.scale.x;
    root.scale.set(1, 1, 1);
    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) { root.scale.setScalar(savedScale); return; }
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const needResize = (maxDim > 20 || maxDim < 0.3);
    if (needResize && !quiet) App.toast('模型尺寸差异较大，已自动缩放到合适大小');
    /* 锚定：把子树平移，使局部原点 = 底部中心（偏移必须用局部坐标计算） */
    const c = box.getCenter(new THREE.Vector3());
    root.children.slice().forEach(function (ch) {
      ch.position.x -= c.x;
      ch.position.y -= box.min.y;
      ch.position.z -= c.z;
    });
    root.scale.setScalar(needResize ? 4 / maxDim : savedScale);
    root.position.set(0, 0, 0);
  };

  App.importOBJ = function (objText, mtlText, urlMap, fileName, opts) {
    opts = opts || {};
    let root;
    try {
      const objLoader = new (A()).OBJLoader();
      if (mtlText) {
        const THREE = T();
        const manager = new THREE.LoadingManager();
        manager.setURLModifier(function (url) {
          const base = decodeURIComponent(url).split(/[\\/]/).pop().toLowerCase();
          return (urlMap && urlMap[base]) || url;
        });
        const mtlLoader = new (A()).MTLLoader(manager);
        const materials = mtlLoader.parse(mtlText, '');
        materials.preload();
        objLoader.setMaterials(materials);
      }
      root = objLoader.parse(objText);
    } catch (err) {
      console.error(err);
      if (!opts.quiet) App.toast('OBJ 解析失败：文件可能损坏', 'err');
      if (opts.done) opts.done(null);
      return;
    }
    root.traverse(function (o) {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    if (!opts.skipNormalize) App._normalizeObject(root, !opts.quiet);
    const key = 'asset' + (++App.idCounter);
    App.assets[key] = {
      text: objText,
      mtl: mtlText || null,
      texs: opts.texB64s || null,
      fileName: fileName,
    };
    root.userData.assetKey = key;
    const entry = App.register(root, fileName.replace(/\.obj$/i, ''));
    if (!opts.quiet) {
      App.select(entry);
      if (App.showRightTab) App.showRightTab('transform'); /* 导入后右栏默认显示变换属性 */
      App.commitUndo();
      App.toast('已导入 ' + fileName + (mtlText ? '（含材质）' : '') + ' 📦');
    }
    App.emit('entry-added', entry);
    if (opts.done) opts.done(entry);
  };

  App.importOBJText = function (text, fileName, opts) {
    App.importOBJ(text, null, null, fileName, opts);
  };

  App.importGLBBuffer = function (buffer, fileName, opts) {
    opts = opts || {};
    const THREE = T();
    const loader = new (A()).GLTFLoader();
    /* Draco 压缩模型支持（本地库与 CDN 均已配置解码器路径） */
    try {
      const draco = new (A()).DRACOLoader();
      draco.setDecoderPath((window.__THREE_BASE__ || './lib/three/') + 'examples/jsm/libs/draco/');
      loader.setDRACOLoader(draco);
    } catch (e) { /* 解码器不可用时按普通模型处理 */ }
    loader.parse(buffer, '', function (gltf) {
      const root = gltf.scene;
      if (gltf.animations && gltf.animations.length) {
        root.userData.clips = gltf.animations;
      }
      root.traverse(function (o) {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      });
      if (!opts.skipNormalize) {
        App._normalizeObject(root, !!opts.quiet);
      }
      const key = 'asset' + (++App.idCounter);
      App.assets[key] = { buffer: buffer, fileName: fileName };
      root.userData.assetKey = key;
      const entry = App.register(root, fileName.replace(/\.(glb|gltf)$/i, ''));
      /* 大模型自动降阴影：保持流畅（场景菜单可重新打开） */
      let meshCount = 0;
      root.traverse(function (o) { if (o.isMesh) meshCount++; });
      if (meshCount > 60 && App.three.renderer.shadowMap.enabled) {
        App.setShadows(false);
        const sh = document.querySelector('#scene-shadow');
        if (sh) sh.checked = false;
        if (!opts.quiet) App.toast('模型较复杂（' + meshCount + ' 个部件），已自动关闭阴影保持流畅；可在「⚙️ 场景」重新打开', '', 4500);
      }
      if (!opts.quiet) {
        App.select(entry);
        if (App.showRightTab) App.showRightTab('transform'); /* 导入后右栏默认显示变换属性 */
        App.commitUndo();
        App.toast('已导入 ' + fileName + ' 📦（点击它可编辑，拖到「外观」页可换材质）');
      }
      App.emit('entry-added', entry);
      if (opts.done) opts.done(entry);
    }, function (err) {
      console.error(err);
      const msg = err && err.message ? err.message : String(err || '');
      let hint = '';
      if (/draco/i.test(msg)) hint = '（Draco 解码失败，请检查网络或改用未压缩模型）';
      else if (/\.gltf/i.test(fileName) || /external/i.test(msg)) hint = '（.gltf 若引用外部 bin/贴图，请先在 Blender 等工具里打包成 .glb）';
      App.toast('模型导入失败：' + msg.slice(0, 60) + hint, 'err', 5000);
      if (opts.done) opts.done(null);
    });
  };

  /* ═══════════ 序列化 ═══════════ */

  function materialsData(entry) {
    return App.entryMaterials(entry).map(function (m) {
      return {
        color: m.color ? '#' + m.color.getHexString() : null,
        metalness: m.metalness, roughness: m.roughness,
        opacity: m.opacity, transparent: !!m.transparent,
        emissive: m.emissive ? '#' + m.emissive.getHexString() : null,
        emissiveIntensity: m.emissiveIntensity,
        hasMap: !!m.map,
      };
    });
  }

  /* 序列化物体在每条动画里的轨道（剔除空轨道） */
  function serializeClipsMap(entry) {
    const out = {};
    Object.keys(entry.clips || {}).forEach(function (cid) {
      const ts = entry.clips[cid];
      if (ts && (ts.position.length || ts.rotation.length || ts.scale.length)) {
        out[cid] = App.deepCopy(ts);
      }
    });
    return out;
  }

  /* 旧版兼容字段：第一条有内容的轨道集（旧版本编辑器打开新工程时读这里） */
  function legacyTracks(entry) {
    const map = serializeClipsMap(entry);
    const first = Object.keys(map)[0];
    return first ? App.deepCopy(map[first]) : { position: [], rotation: [], scale: [] };
  }

  function serializeEntry(entry) {
    const o = entry.object3D;
    if (o.isLight) {
      return {
        kind: 'light',
        name: entry.name,
        visible: o.visible,
        transform: {
          p: o.position.toArray(),
          r: [o.rotation.x, o.rotation.y, o.rotation.z],
          s: [1, 1, 1],
        },
        light: {
          color: '#' + o.color.getHexString(),
          intensity: o.intensity,
          lightType: o.isSpotLight ? 'spot' : 'point',
          angle: o.isSpotLight ? o.angle : undefined,
          penumbra: o.isSpotLight ? o.penumbra : undefined,
        },
        clips: serializeClipsMap(entry),
        tracks: legacyTracks(entry),
        rules: App.deepCopy(entry.rules),
      };
    }
    if (o.userData.template) {
      return {
        kind: 'template',
        template: o.userData.template,
        name: entry.name,
        visible: o.visible,
        transform: {
          p: o.position.toArray(),
          r: [o.rotation.x, o.rotation.y, o.rotation.z],
          s: o.scale.toArray(),
        },
        materials: materialsData(entry),
        clips: serializeClipsMap(entry),
        tracks: legacyTracks(entry),
        rules: App.deepCopy(entry.rules),
      };
    }
    const data = {
      kind: o.userData.primitive ? 'primitive' : 'glb',
      name: entry.name,
      visible: o.visible,
      transform: {
        p: o.position.toArray(),
        r: [o.rotation.x, o.rotation.y, o.rotation.z],
        s: o.scale.toArray(),
      },
      materials: materialsData(entry),
      clips: serializeClipsMap(entry),
      tracks: legacyTracks(entry),
      rules: App.deepCopy(entry.rules),
    };
    if (data.kind === 'primitive') {
      data.shape = o.userData.primitive;
      if (o.userData.labelText !== undefined) {
        data.labelText = o.userData.labelText;
        data.labelColor = o.userData.labelColor;
        data.labelBg = o.userData.labelBg;
      }
    }
    else {
      /* 模型资产统一存到 data.assets（同一模型被复制多次也只存一份） */
      data.assetKey = o.userData.assetKey;
    }
    return data;
  }

  function applyEntryData(entry, d) {
    const o = entry.object3D;
    entry.name = d.name;
    o.name = d.name;
    if (d.transform) {
      o.position.fromArray(d.transform.p);
      o.rotation.set(d.transform.r[0], d.transform.r[1], d.transform.r[2]);
      o.scale.fromArray(d.transform.s);
    }
    o.visible = d.visible !== false;
    if (d.light && o.isLight) {
      o.color.set(d.light.color);
      o.intensity = d.light.intensity;
      if (o.isSpotLight && d.light.angle != null) {
        o.angle = d.light.angle;
        o.penumbra = d.light.penumbra != null ? d.light.penumbra : 0.35;
        App.syncSpotBeam(o);
      }
    }
    if (d.clips && Object.keys(d.clips).length) {
      entry.clips = App.deepCopy(d.clips);
    } else if (d.tracks) {
      /* 旧版工程迁移：单轨道 → 归入第一条动画 */
      const cid = (App.clips[0] && App.clips[0].id) || 'clip1';
      entry.clips = {};
      entry.clips[cid] = App.deepCopy(d.tracks);
    } else {
      entry.clips = {};
    }
    entry.rules = d.rules || [];
    if (d.materials) {
      const mats = App.entryMaterials(entry);
      d.materials.forEach(function (md, i) {
        const m = mats[i];
        if (!m) return;
        if (md.color && m.color) m.color.set(md.color);
        if (md.metalness != null) m.metalness = md.metalness;
        if (md.roughness != null) m.roughness = md.roughness;
        if (md.opacity != null) { m.opacity = md.opacity; m.transparent = !!md.transparent || md.opacity < 1; m.depthWrite = m.opacity >= 1; }
        if (md.emissive && m.emissive) m.emissive.set(md.emissive);
        if (md.emissiveIntensity != null) m.emissiveIntensity = md.emissiveIntensity;
        m.needsUpdate = true;
      });
    }
    App.emit('entries');
  }

  /* ═══════════ 工程保存 / 打开 ═══════════ */

  /* 构建完整工程数据（保存工程与发布「做同款」共用） */
  function buildProjectData() {
    const data = { app: 'litecube', version: 1, duration: App.duration, entries: [] };
    /* 命名动画片段列表 */
    data.clips = App.clips.map(function (c) { return { id: c.id, name: c.name, duration: c.duration }; });
    data.settings = {
      bg: '#' + App.three.scene.background.getHexString(),
      grid: App.three.grid.visible,
      ease: App.ease,
      shadows: App.three.renderer.shadowMap.enabled,
      camera: {
        p: App.three.camera.position.toArray(),
        t: App.three.controls.target.toArray(),
      },
    };
    /* 资产集中区：每个模型只存一份，条目里只放引用 */
    data.assets = {};
    Object.keys(App.assets).forEach(function (key) {
      const asset = App.assets[key];
      if (!asset) return;
      const a = { fileName: asset.fileName };
      if (asset.buffer) {
        a.b64 = App.bufToB64(asset.buffer);
      } else if (asset.text) {
        a.srcFormat = 'obj';
        a.b64 = btoa(unescape(encodeURIComponent(asset.text)));
        if (asset.mtl) a.mtlB64 = btoa(unescape(encodeURIComponent(asset.mtl)));
        if (asset.texs && asset.texs.length) a.texs = asset.texs;
      }
      data.assets[key] = a;
    });
    let missing = false;
    App.entries.forEach(function (entry) {
      const d = serializeEntry(entry);
      if (d.kind === 'glb' && !(d.assetKey && App.assets[d.assetKey])) missing = true;
      data.entries.push(d);
    });
    return { data: data, missing: missing };
  }

  /* ---------- 自动保存（防崩溃/误关）：小场景存浏览器本地，大模型静默跳过 ---------- */
  App._scheduleAutosave = function () {
    clearTimeout(App._asTimer);
    App._asTimer = setTimeout(App._doAutosave, 2500);
  };
  App._doAutosave = function () {
    try {
      if (!App.entries.length) { localStorage.removeItem('litecube_autosave'); return; }
      let bytes = 0;
      Object.keys(App.assets).forEach(function (k) {
        const a = App.assets[k];
        if (!a) return;
        if (a.buffer) bytes += a.buffer.byteLength;
        if (a.text) bytes += a.text.length;
      });
      if (bytes > 2.2 * 1024 * 1024) return; /* 模型太大，超出本地存储，静默跳过 */
      const built = buildProjectData();
      const json = JSON.stringify(built.data);
      if (json.length > 3.5 * 1024 * 1024) return;
      localStorage.setItem('litecube_autosave', json);
    } catch (e) { /* 配额不足等，静默 */ }
  };
  App.clearAutosave = function () {
    try { localStorage.removeItem('litecube_autosave'); } catch (e) { /* 忽略 */ }
  };

  App.saveProject = function () {
    if (!App.entries.length) { App.toast('场景是空的，没什么可保存的', 'warn'); return; }
    if (App._multiPivotActive && App._multiPivotActive()) App._teardownMultiPivot();
    const built = buildProjectData();
    const data = built.data;
    let missing = built.missing;
    App.download(JSON.stringify(data), (App._publishName || '我的3D作品') + '.lcz.json', 'application/json');
    App._dirty = false;
    App.clearAutosave();
    App.toast(missing ? '工程已保存 ⚠（部分模型缺少源文件，未包含在内）' : '工程已保存为单文件（模型已内嵌）💾');
    App.emit('saved');
  };

  App.openProjectFile = function (file) {
    const reader = new FileReader();
    reader.onload = function () {
      let data;
      try { data = JSON.parse(reader.result); }
      catch (e) { App.toast('工程文件解析失败', 'err'); return; }
      if (!data || data.app !== 'litecube') { App.toast('这不是轻立方工程文件', 'err'); return; }
      App.clearScene(true);
      /* 还原命名动画片段（旧工程无 clips → 迁移为单条「动画1」） */
      if (Array.isArray(data.clips) && data.clips.length) {
        App.clips = data.clips.map(function (c) { return { id: c.id, name: c.name, duration: c.duration || 5 }; });
        App.activeClipId = App.clips[0].id;
      } else {
        App.clips = [{ id: 'clip1', name: '动画1', duration: data.duration || 5 }];
        App.activeClipId = 'clip1';
      }
      App.duration = App.activeClip().duration;
      const durInput = document.querySelector('#tl-duration');
      durInput.value = App.duration;
      App.buildRuler();
      App.renderClipChips();
      App.setTime(0);
      if (data.settings) {
        if (data.settings.bg) {
          App.setSceneBg(data.settings.bg);
          document.querySelector('#scene-bg').value = data.settings.bg;
        }
        if (App.three.grid) {
          App.three.grid.visible = data.settings.grid !== false;
          document.querySelector('#scene-grid').checked = data.settings.grid !== false;
        }
        if (App.setShadows) {
          App.setShadows(data.settings.shadows !== false);
          document.querySelector('#scene-shadow').checked = data.settings.shadows !== false;
        }
        if (data.settings.camera && data.settings.camera.p) {
          App.three.camera.position.fromArray(data.settings.camera.p);
          App.three.controls.target.fromArray(data.settings.camera.t);
          App.three.controls.update();
        }
        App.ease = ['smooth', 'linear', 'back'].includes(data.settings.ease) ? data.settings.ease : 'smooth';
        const easeEl = document.querySelector('#tl-ease');
        if (easeEl) easeEl.value = App.ease;
      }
      let chain = Promise.resolve();
      /* 预解码资产：每个模型只解码一次，重复引用共享 */
      const assetSrc = {};
      Object.keys(data.assets || {}).forEach(function (key) {
        const a = data.assets[key];
        if (!a || !a.b64) return;
        if (a.srcFormat === 'obj') {
          const texB64s = [];
          const urlMap = {};
          (a.texs || []).forEach(function (t) {
            const buf = App.b64ToBuf(t.b64);
            urlMap[t.name] = URL.createObjectURL(new Blob([buf]));
            texB64s.push({ name: t.name, b64: t.b64 });
          });
          assetSrc[key] = {
            srcFormat: 'obj',
            objText: decodeURIComponent(escape(atob(a.b64))),
            mtlText: a.mtlB64 ? decodeURIComponent(escape(atob(a.mtlB64))) : null,
            urlMap: urlMap,
            texB64s: texB64s,
            fileName: a.fileName,
          };
        } else {
          assetSrc[key] = { srcFormat: 'glb', buffer: App.b64ToBuf(a.b64), fileName: a.fileName };
        }
      });
      (data.entries || []).forEach(function (d) {
        chain = chain.then(function () { return restoreEntry(d, assetSrc); });
      });
      chain.then(function () {
        App.select(null);
        App.commitUndo(true);
        App.clearAutosave();
        App.toast('工程已打开 ✅');
      });
    };
    reader.readAsText(file);
  };

  function restoreEntry(d, assetSrc) {
    assetSrc = assetSrc || {};
    if (d.kind === 'glb') {
      return new Promise(function (res) {
        const src = d.assetKey ? assetSrc[d.assetKey] : null;
        if (src && src.srcFormat === 'obj') {
          App.importOBJ(src.objText, src.mtlText, src.urlMap, src.fileName, {
            skipNormalize: true, quiet: true, texB64s: src.texB64s,
            done: res,
          });
          return;
        }
        if (src && src.buffer) {
          App.importGLBBuffer(src.buffer, src.fileName, { skipNormalize: true, quiet: true, done: res });
          return;
        }
        if (d.b64) {
          /* 旧版格式：资产内嵌在条目里 */
          if (d.srcFormat === 'obj') {
            const urlMap = {};
            const texB64s = [];
            (d.texs || []).forEach(function (t) {
              const buf = App.b64ToBuf(t.b64);
              urlMap[t.name] = URL.createObjectURL(new Blob([buf]));
              texB64s.push({ name: t.name, b64: t.b64 });
            });
            App.importOBJ(decodeURIComponent(escape(atob(d.b64))), d.mtlB64 ? decodeURIComponent(escape(atob(d.mtlB64))) : null, urlMap, d.fileName || d.name + '.obj', {
              skipNormalize: true, quiet: true, texB64s: texB64s,
              done: res,
            });
          } else {
            App.importGLBBuffer(App.b64ToBuf(d.b64), d.fileName || d.name + '.glb', {
              skipNormalize: true, quiet: true,
              done: res,
            });
          }
          return;
        }
        res(null);
      }).then(function (entry) {
        if (entry) applyEntryData(entry, d);
      });
    }
    let entry = null;
    if (d.kind === 'light' && d.light) {
      if (d.light.lightType === 'spot') {
        entry = App.addSpotLight({ quiet: true, name: d.name, color: d.light.color, intensity: d.light.intensity, angle: d.light.angle, penumbra: d.light.penumbra });
      } else {
        entry = App.addPointLight({ quiet: true, name: d.name, color: d.light.color, intensity: d.light.intensity });
      }
    } else if (d.kind === 'template' && d.template) {
      entry = App.addTemplate(d.template, { quiet: true, name: d.name });
    } else if (d.shape === 'label') {
      entry = App.addLabel({ quiet: true, name: d.name, text: d.labelText, color: d.labelColor, bg: d.labelBg });
    } else {
      entry = App.addPrimitive(d.shape, { quiet: true, name: d.name });
    }
    if (entry) applyEntryData(entry, d);
    return Promise.resolve();
  }

  App.clearScene = function (skipUndo) {
    App.entries.slice().forEach(App.unregister);
    App.assets = {};
    App.select(null);
    if (!skipUndo) App.commitUndo();
  };

  /* ═══════════ 录制动画 GIF（微信里当图片直接发） ═══════════ */

  App.exportGIF = function () {
    if (!App.entries.some(App.entryHasAnim)) { App.toast('还没有动画可录：先给物体做一段动画吧', 'warn'); return; }
    const start = function () { App._doGIF(); };
    if (!window.GIF) {
      const s = document.createElement('script');
      s.src = (window.__THREE_BASE__ && window.__THREE_BASE__.indexOf('http') !== 0 ? '../lib/gif/gif.js' : 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.js');
      s.onload = start;
      s.onerror = function () { App.toast('GIF 编码器加载失败，请检查网络', 'err'); };
      document.head.appendChild(s);
      return;
    }
    start();
  };

  App._doGIF = function () {
    if (!App.entries.some(App.entryHasAnim)) { App.toast('还没有动画可录', 'warn'); return; }
    /* worker 脚本必须同源：取回脚本文本包成 Blob URL（本地库/CDN 均可） */
    const workerSrc = (window.__THREE_BASE__ && window.__THREE_BASE__.indexOf('http') !== 0 ? '../lib/gif/gif.worker.js' : 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js');
    fetch(workerSrc).then(function (r) { return r.text(); }).then(function (workerText) {
      const wurl = URL.createObjectURL(new Blob([workerText], { type: 'text/javascript' }));
      const srcCanvas = App.three.renderer.domElement;
      const W = 480, H = Math.round(480 * srcCanvas.clientHeight / srcCanvas.clientWidth) || 270;
      const tmp = document.createElement('canvas');
      tmp.width = W; tmp.height = H;
      const tctx = tmp.getContext('2d');
      const gif = new window.GIF({ workers: 2, quality: 12, width: W, height: H, workerScript: wurl });
      const frames = [];
      let last = -1;
      const hook = function () {
        const gwin = App.globalDuration();
      const idx = Math.floor(App.time / gwin * 12); /* 每秒约 2.4 帧 × 12 段 */
        if (idx === last || frames.length >= 12) return;
        last = idx;
        tctx.fillStyle = '#1a1d26';
        tctx.fillRect(0, 0, W, H);
        tctx.drawImage(srcCanvas, 0, 0, W, H);
        /* 必须当场快照 ImageData：拖到 addFrame 才拷贝的话，12 帧全是最后一帧 */
        frames.push({ data: tctx.getImageData(0, 0, W, H), delay: Math.round(1000 * gwin / 12) });
      };
      App.hooks.postRender = App.hooks.postRender || [];
      App.hooks.postRender.push(hook);
      window.__gifFrames = frames;
      const wasPreview = App.preview;
      if (!App.preview) App.togglePreview();
      App.setTime(0);
      App.playing = true;
      App.updatePlayUI();
      App.toast('🎞 正在抓帧 ' + App.globalDuration() + ' 秒…', '', App.globalDuration() * 1000);
      setTimeout(function () {
        const i = App.hooks.postRender.indexOf(hook);
        if (i >= 0) App.hooks.postRender.splice(i, 1);
        if (!wasPreview) App.togglePreview();
        else { App.playing = false; App.updatePlayUI(); }
        frames.forEach(function (fr) { gif.addFrame(fr.data, { delay: fr.delay }); });
        gif.on('finished', function (blob) {
          App.download(blob, (App._publishName || '我的3D动画') + '.gif');
          App.toast('🎞 GIF 已导出（' + Math.round(blob.size / 1024) + 'KB，微信里当图片直接发）', '', 5000);
        });
        gif.render();
        App.toast('⚙ 正在编码 GIF…', '', 3000);
      }, App.globalDuration() * 1000 + 200);
    }).catch(function (err) {
      App.toast('GIF 编码器加载失败：' + (err && err.message ? err.message : err), 'err');
    });
  };

  /* ═══════════ 录制动画视频（WebM，纯前端） ═══════════ */

  App.exportVideo = function () {
    if (!window.MediaRecorder) { App.toast('当前浏览器不支持视频录制，请用 Chrome/Edge', 'err'); return; }
    if (!App.entries.some(App.entryHasAnim)) { App.toast('还没有动画可录：先给物体做一段动画吧', 'warn'); return; }
    const canvas = App.three.renderer.domElement;
    let stream;
    try { stream = canvas.captureStream(30); }
    catch (e) { App.toast('视频流创建失败', 'err'); return; }
    /* 音效轨道：录制期间触发的音效也录进视频 */
    try {
      const ac = App._audio || (window.AudioContext || window.webkitAudioContext ? new (window.AudioContext || window.webkitAudioContext)() : null);
      if (ac) {
        App._audio = ac;
        if (ac.state === 'suspended') ac.resume();
        App._recDest = ac.createMediaStreamDestination();
        App._recGain = ac.createGain();
        App._recGain.gain.value = 1;
        App._recGain.connect(App._recDest);
        App._recGain.connect(ac.destination);
        App._recDest.stream.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
      }
    } catch (e) { /* 无音轨也可录 */ }
    let mime = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000 });
    const chunks = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      const blob = new Blob(chunks, { type: 'video/webm' });
      App.download(blob, (App._publishName || App._videoName || '我的3D动画') + '.webm');
      App.toast('🎬 视频已导出（WebM 格式，微信/抖音可直接发送）', '', 5000);
      if (App._recGain) { try { App._recGain.disconnect(); } catch (e) { /* 忽略 */ } }
      App._recDest = null;
      App._recGain = null;
      App._dirty = false;
    };
    /* 录制期间进入预览状态（隐藏 gizmo），从头播放一遍 */
    const wasPreview = App.preview;
    if (!App.preview) App.togglePreview();
    App.setTime(0);
    App.playing = true;
    App.updatePlayUI();
    rec.start();
    App.toast('🔴 正在录制 ' + App.globalDuration() + ' 秒动画，请勿切换页面…', '', App.globalDuration() * 1000);
    setTimeout(function () {
      try { rec.stop(); } catch (e) { /* 忽略 */ }
      if (!wasPreview) App.togglePreview();
      else { App.playing = false; App.updatePlayUI(); }
    }, App.globalDuration() * 1000 + 150);
  };

  /* ═══════════ 导出 GLB（含动画） ═══════════ */

  App.exportGLB = function () {
    if (!App.entries.length) { App.toast('场景是空的，先添加点东西吧', 'warn'); return; }
    if (App._multiPivotActive && App._multiPivotActive()) App._teardownMultiPivot();
    const exporter = new (A()).GLTFExporter();
    const clips = App.buildAllClips();
    App.setSpotBeamsVisible(false);   /* 光束锥是编辑辅助，不进导出产物 */
    exporter.parse(App.three.userRoot, function (result) {
      App.setSpotBeamsVisible(true);
      App.download(new Blob([result], { type: 'model/gltf-binary' }), (App._publishName || '我的3D作品') + '.glb');
      App._dirty = false;
      App.toast(clips.length ? 'GLB 已导出（含动画）📦' : 'GLB 已导出 📦');
      App.emit('exported');
    }, function (err) {
      App.setSpotBeamsVisible(true);
      console.error(err);
      App.toast('导出失败：' + (err && err.message ? err.message : err), 'err');
    }, { binary: true, animations: clips });
  };

  /* ═══════════ 一键发布互动网页 ═══════════ */

  App.publish = function (name, link) {
    name = (name || '我的3D作品').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || '我的3D作品';
    App._publishName = name;
    App._publishLink = /^https?:\/\//.test(link || '') ? link : '';
    if (!App.entries.length) { App.toast('场景是空的，先添加点东西吧', 'warn'); return; }
    if (App._multiPivotActive && App._multiPivotActive()) App._teardownMultiPivot();
    const exporter = new (A()).GLTFExporter();
    const clips = App.buildAllClips();
    const rules = [];
    App.entries.forEach(function (e) {
      e.rules.forEach(function (r) {
        rules.push({ name: e.name, event: r.event, action: r.action, value: r.value, clip: r.clip || '' });
      });
    });
    /* 完整工程数据随发布页内嵌，观众可「做同款」 */
    const proj = buildProjectData();
    App.setSpotBeamsVisible(false);   /* 光束锥不进发布产物 */
    exporter.parse(App.three.userRoot, function (glb) {
      App.setSpotBeamsVisible(true);
      const b64 = App.bufToB64(glb);
      const data = JSON.stringify({
        title: name, glb: b64, rules: rules, hasAnim: clips.length > 0,
        settings: {
          bg: '#' + App.three.scene.background.getHexString(),
          camera: {
            p: App.three.camera.position.toArray(),
            t: App.three.controls.target.toArray(),
          },
        },
        project: proj.data,
        link: App._publishLink || '',
      }).replace(/</g, '\\u003c');
      App.download(buildPublishHTML(data, name), name + '.html', 'text/html');
      App._dirty = false;
      App.toast('发布成功！电脑上双击即可看 🚀（手机观看：传到电脑，或上传网页空间生成链接）', '', 5000);
      App.emit('published');
    }, function (err) {
      App.setSpotBeamsVisible(true);
      console.error(err);
      App.toast('发布失败：' + (err && err.message ? err.message : err), 'err');
    }, { binary: true, animations: clips });
  };

  /* 测试钩子：供自动化验证发布产物 */
  App._buildPublishHTML = buildPublishHTML;

  function buildPublishHTML(dataJson, title) {
    title = (title || '我的3D作品').replace(/</g, '&lt;');
    const head = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + title + ' · 轻立方制作</title>\n' +
      '<style>\n' +
      'html,body{margin:0;height:100%;overflow:hidden;background:#1a1d26;font-family:system-ui,"Microsoft YaHei",sans-serif}\n' +
      '#cv{width:100%;height:100%;display:block}\n' +
      '#bar{position:fixed;top:12px;left:50%;transform:translateX(-50%);display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;max-width:94%;z-index:5}\n' +
      '#bar button{background:rgba(29,32,41,.9);color:#d9dde8;border:1px solid #2c3140;border-radius:999px;padding:6px 16px;font-size:13px;cursor:pointer;white-space:nowrap}\n' +
      '#bar button:hover{border-color:#4da3ff}\n' +
      '#bar .brand{color:#8b91a3;font-size:12px;text-decoration:none}\n' +
      '#bar .brand:hover{color:#d9dde8}\n' +
      '@media (max-width:640px){ #bar .brand{display:none} #tip{width:92%;text-align:center} }\n' +
      '#toasts{position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:9;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}\n' +
      '.t{background:rgba(67,209,124,.95);color:#08320f;border-radius:999px;padding:8px 20px;font-size:15px;font-weight:600;animation:pop .3s ease}\n' +
      '@keyframes pop{from{transform:scale(.6);opacity:0}}\n' +
      '#tip{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);color:#8b91a3;font-size:12px}\n' +
      '</style>\n' +
      '<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}<\/script>\n';
    return head +
      '<body>\n<canvas id="cv"></canvas>\n<div id="loading" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#1a1d26;color:#8b91a3;font-family:system-ui;z-index:30;flex-direction:column;gap:10px"><div style="font-size:34px">🧊</div><div>正在加载 3D 作品…</div></div>\n<div id="bar"><button id="replay">▶ 重播动画</button><button id="remix">🎨 做同款</button><button id="fs">⛶ 全屏</button><a class="brand" href="https://litecube.netlify.app/" target="_blank" rel="noopener">🧊 ' + title + ' · 由轻立方 LiteCube 制作</a></div>\n' +
      '<div id="toasts"></div>\n<div id="tip">拖动旋转视角 · 滚轮缩放 · 点一点场景里的物体</div>\n' +
      '<script type="application/json" id="work-data">' + dataJson + '<\/script>\n' +
      '<script type="module">\n' +
      RUNTIME +
      '<\/script>\n</body>\n</html>';
  }

  /* 发布页运行时（注意：内不能用反引号与 ${}） */
  const RUNTIME = [
    "import * as THREE from 'three';",
    "import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';",
    "const data = JSON.parse(document.getElementById('work-data').textContent);",
    "function webglOK(){ try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; } }",
    "if (!webglOK()){",
    "  document.body.innerHTML = '<div style=\"display:flex;height:100vh;align-items:center;justify-content:center;color:#d9dde8;background:#1a1d26;font-family:system-ui;text-align:center;padding:24px\"><div><div style=\"font-size:44px;margin-bottom:10px\">📱</div><p style=\"font-size:16px;margin-bottom:12px\">当前查看环境不支持 3D 显示</p><p style=\"color:#8b91a3;font-size:13px;line-height:1.9\">苹果手机请用支持本地网页的浏览器打开本文件（如 Documents、Alook），<br>或把文件传到电脑上双击打开，<br>或把文件上传到网页空间后用 Safari 打开链接。</p></div></div>';",
    "  throw new Error('webgl-unsupported');",
    "}",
    "const canvas = document.getElementById('cv');",
    "const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });",
    "renderer.setPixelRatio(Math.min(devicePixelRatio, 2));",
    "renderer.shadowMap.enabled = true;",
    "renderer.shadowMap.type = THREE.PCFSoftShadowMap;",
    "renderer.toneMapping = THREE.ACESFilmicToneMapping;",
    "const scene = new THREE.Scene();",
    "scene.background = new THREE.Color('#1a1d26');",
    "scene.fog = new THREE.Fog('#1a1d26', 30, 90);",
    "if (data.settings && data.settings.bg) { scene.background.set(data.settings.bg); scene.fog.color.set(data.settings.bg); }",
    "const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);",
    "camera.position.set(7, 5, 9);",
    "const controls = new ((await import('three/addons/controls/OrbitControls.js')).OrbitControls)(camera, canvas);",
    "controls.enableDamping = true; controls.dampingFactor = 0.08;",
    "controls.target.set(0, 1, 0); controls.maxPolarAngle = Math.PI * 0.55;",
    "if (data.settings && data.settings.camera && data.settings.camera.p){",
    "  camera.position.fromArray(data.settings.camera.p);",
    "  controls.target.fromArray(data.settings.camera.t); }",
    "scene.add(new THREE.HemisphereLight('#cfd8ff', '#3a3428', 0.55));",
    "const sun = new THREE.DirectionalLight('#fff4e0', 1.6);",
    "sun.position.set(6, 10, 4); sun.castShadow = true;",
    "sun.shadow.mapSize.set(2048, 2048);",
    "sun.shadow.camera.left = -15; sun.shadow.camera.right = 15;",
    "sun.shadow.camera.top = 15; sun.shadow.camera.bottom = -15;",
    "sun.shadow.bias = -0.0004;",
    "scene.add(sun);",
    "try { const pmrem = new THREE.PMREMGenerator(renderer);",
    "  const env = await import('three/addons/environments/RoomEnvironment.js');",
    "  scene.environment = pmrem.fromScene(new env.RoomEnvironment(), 0.04).texture; } catch (e) {}",
    "function resize(){ const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }",
    "addEventListener('resize', resize); resize();",
    "const bin = atob(data.glb); const bytes = new Uint8Array(bin.length);",
    "for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);",
    "const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '');",
    "document.getElementById('loading').remove();",
    "const model = gltf.scene;",
    "model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });",
    "scene.add(model);",
    "const billboards = [];",
    "model.traverse(o => { if (o.name === '__billboard_plane__') billboards.push(o); });",
    "const mixer = new THREE.AnimationMixer(model);",
    "const actions = gltf.animations.map(c => mixer.clipAction(c));",
    "actions.forEach(a => { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; });",
    "const actionsByName = {}; actions.forEach(a => { actionsByName[a.getClip().name] = a; });",
    "function playAll(){ actions.forEach(a => { a.reset(); a.play(); }); }",
    "if (actions.length) playAll();",
    "const byName = {};",
    "(data.rules || []).forEach(r => { (byName[r.name] = byName[r.name] || []).push(r); });",
    "const spins = new Set();",
    "const toasts = document.getElementById('toasts');",
    "function toast(msg){ const d = document.createElement('div'); d.className = 't'; d.textContent = msg; toasts.appendChild(d); setTimeout(() => { d.style.opacity = '0'; d.style.transition = 'opacity .4s'; setTimeout(() => d.remove(), 450); }, 2400); }",
    "function tweenColor(node, hex){ const c = new THREE.Color(hex); const items = [];",
    "  node.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (m && m.color) items.push({ m, from: m.color.clone() }); }); } });",
    "  let t = 0; tweens.push({ step(dt){ t += dt; const k = Math.min(t / 0.4, 1); items.forEach(it => it.m.color.lerpColors(it.from, c, k)); return k < 1; } }); }",
    "const tweens = [];",
    "const SOUNDS = { ding: { f: 1318, t: 'sine', d: 0.35 }, dong: { f: 520, t: 'sine', d: 0.45 }, boop: { f: 220, t: 'square', d: 0.18 }, pop: { f: 660, t: 'triangle', d: 0.12, slide: 1.6 } };",
    "let actx = null;",
    "function playSound(kind){ const s = SOUNDS[kind] || SOUNDS.ding;",
    "  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)();",
    "    if (actx.state === 'suspended') actx.resume();",
    "    const osc = actx.createOscillator(); const g = actx.createGain();",
    "    osc.type = s.t; osc.frequency.setValueAtTime(s.f, actx.currentTime);",
    "    if (s.slide) osc.frequency.exponentialRampToValueAtTime(s.f * s.slide, actx.currentTime + s.d);",
    "    g.gain.setValueAtTime(0.18, actx.currentTime);",
    "    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + s.d);",
    "    osc.connect(g).connect(actx.destination); osc.start(); osc.stop(actx.currentTime + s.d + 0.02); } catch (e) {} }",
    "function doAction(node, r){",
    "  if (r.action === 'anim'){ const target = r.clip ? actionsByName[r.clip] : null; if (target) { target.reset(); target.play(); } else playAll(); }",
    "  else if (r.action === 'color') tweenColor(node, r.value || '#ff5555');",
    "  else if (r.action === 'message') toast(r.value || '你好！');",
    "  else if (r.action === 'toggle') node.visible = !node.visible;",
    "  else if (r.action === 'spin'){ if (spins.has(node)) spins.delete(node); else spins.add(node); }",
    "  else if (r.action === 'shake'){ const p0 = node.position.clone(); let st = 0;",
    "    tweens.push({ step(dt){ st += dt; const k = Math.min(st / 0.5, 1);",
    "      node.position.x = p0.x + (1 - k) * 0.12 * Math.sin(k * 40);",
    "      if (k >= 1){ node.position.copy(p0); return false; } return true; } }); }",
    "  else if (r.action === 'link'){ if (r.value) window.open(r.value, '_blank'); }",
    "  else if (r.action === 'sound') playSound(r.value || 'ding');",
    "  else if (r.action === 'fly'){",
    "    const box = new THREE.Box3().setFromObject(node);",
    "    if (!box.isEmpty()){ const c = box.getCenter(new THREE.Vector3());",
    "      const size = box.getSize(new THREE.Vector3()).length() || 2;",
    "      const dir = camera.position.clone().sub(controls.target).normalize();",
    "      const to = c.clone().add(dir.multiplyScalar(Math.max(size * 2.2, 2.5)));",
    "      flyTo(to, c); } }",
    "}",
    "let fly = null;",
    "function flyTo(p, t){ fly = { fp: camera.position.clone(), ft: controls.target.clone(), tp: p, tt: t, k: 0 }; }",
    "function nodeOf(o){ let n = o; while (n){ if (n.name && byName[n.name]) return n; n = n.parent; } return null; }",
    "const ray = new THREE.Raycaster(); const ptr = new THREE.Vector2(); let hovered = null;",
    "function hitTest(ev){ const r = canvas.getBoundingClientRect();",
    "  ptr.x = ((ev.clientX - r.left) / r.width) * 2 - 1; ptr.y = -((ev.clientY - r.top) / r.height) * 2 + 1;",
    "  ray.setFromCamera(ptr, camera);",
    "  const hits = ray.intersectObjects(model.children, true);",
    "  return hits.length ? hits[0].object : null; }",
    "canvas.addEventListener('pointerup', ev => { const o = hitTest(ev); if (!o) return;",
    "  const n = nodeOf(o); if (n) byName[n.name].forEach(r => { if (r.event === 'click') doAction(n, r); }); });",
    "canvas.addEventListener('dblclick', ev => { const o = hitTest(ev); if (!o) return;",
    "  const n = nodeOf(o); if (n) byName[n.name].forEach(r => { if (r.event === 'dblclick') doAction(n, r); }); });",
    "canvas.addEventListener('pointermove', ev => { const o = hitTest(ev); const n = o ? nodeOf(o) : null;",
    "  canvas.style.cursor = o ? 'pointer' : '';",
    "  if (n !== hovered){ if (hovered && byName[hovered.name]) byName[hovered.name].forEach(r => { if (r.event === 'hover') doAction(hovered, r); }); hovered = n; } });",
    "Object.keys(byName).forEach(name => { const n = model.getObjectByName(name);",
    "  if (n) byName[name].forEach(r => { if (r.event === 'load') doAction(n, r); }); });",
    "document.getElementById('replay').addEventListener('click', playAll);",
    "document.getElementById('remix').addEventListener('click', function(){",
    "  window.open('https://github.com/qi7885-cloud/LiteCube', '_blank'); });",
    "if ('ontouchstart' in window) document.getElementById('tip').textContent = '单指拖动转视角 · 双指缩放平移 · 点一点场景里的物体';",
    "if (data.link){ const more = document.createElement('button');",
    "  more.textContent = '🔗 了解更多';",
    "  more.addEventListener('click', function(){ window.open(data.link, '_blank'); });",
    "  document.getElementById('bar').appendChild(more); }",
    "document.getElementById('fs').addEventListener('click', function(){",
    "  if (!document.fullscreenElement) document.documentElement.requestFullscreen();",
    "  else document.exitFullscreen(); });",
    "document.title = data.title || '我的3D作品';",
    "document.querySelector('#bar .brand').textContent = '🧊 ' + (data.title || '我的3D作品') + ' · 由轻立方 LiteCube 制作';",
    "const clock = new THREE.Clock();",
    "(function loop(){ requestAnimationFrame(loop);",
    "  const dt = Math.min(clock.getDelta(), 0.05);",
    "  mixer.update(dt); controls.update();",
    "  spins.forEach(n => { n.rotation.y += dt * 1.5; });",
    "  for (let i = tweens.length - 1; i >= 0; i--) if (!tweens[i].step(dt)) tweens.splice(i, 1);",
    "  if (fly){ fly.k += dt / 0.8; const k = Math.min(fly.k, 1); const e = k < 0.5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2) / 2;",
    "    camera.position.lerpVectors(fly.fp, fly.tp, e); controls.target.lerpVectors(fly.ft, fly.tt, e);",
    "    if (k >= 1) fly = null; }",
    "  billboards.forEach(b => b.quaternion.copy(camera.quaternion));",
    "  renderer.render(scene, camera); })();",
    "window.__pubModel = model;",
    "window.__pubBooted = true;",
    "window.__billboardCount = billboards.length;",
    "window.__actionCount = actions.length;",
    "window.__pubCam = camera;",
  ].join('\n');
})();

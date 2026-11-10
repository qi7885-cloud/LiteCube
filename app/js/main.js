/* ═══ main.js — 启动、工具栏、面板绑定、快捷键、新手任务 ═══ */
(function () {
  'use strict';
  const App = window.App;
  const T = () => window.THREE;

  App.boot = function () {
    App.initEditor();
    App.initGizmo();    /* 视口右上角视角方向指示器 */

    /* 初始示例物体 */
    App.addPrimitive('box', { name: '示例立方体', color: '#5aa2ff', quiet: true });
    App.select(null);
    App.commitUndo(true); /* 基线快照（不算用户改动） */

    bindToolbar();
    bindTabs();
    bindTransformPanel();
    bindKeyboard();
    bindContextMenu();

    App.updatePlayUI();
    App.ensureClips();      /* 命名动画列表：至少一条「动画1」，时长镜像到时间轴 */
    App.buildRuler();
    App.buildFavorites();
    App.refreshAllPanels();

    /* 有未保存改动时关页前提醒，防止丢作品 */
    window.addEventListener('beforeunload', function (ev) {
      if (App._dirty && App.entries.length) {
        ev.preventDefault();
        ev.returnValue = '';
      }
    });
    /* 正常关闭页面时丢弃自动保存（关页前对未保存改动已有确认），下次打开不再提醒；
       只有崩溃 / 强杀进程等异常退出才会保留自动保存 → 下次打开出现恢复条 */
    window.addEventListener('pagehide', function () {
      App.clearAutosave();
    });

    /* ---------- 动画编辑区高度拖拽：拖到底只保留动画芯片行，视口最大化 ---------- */
    (function bindTimelineResizer() {
      const tl = document.getElementById('timeline');
      const handle = document.getElementById('tl-resizer');
      if (!tl || !handle) return;
      const KEY = 'litecube_tlHeight';
      const MIN = 46;                              /* 只剩「动画」芯片行 */
      const COLLAPSED_BELOW = 150;                 /* 低于此高度进入收起态（隐藏芯片行以外的行） */
      let lastExpanded = parseInt(localStorage.getItem(KEY) || '0', 10) || 240;

      function applyHeight(h) {
        h = Math.max(MIN, Math.min(h, Math.min(window.innerHeight - 140, 460)));
        tl.style.height = h + 'px';
        tl.classList.toggle('collapsed', h < COLLAPSED_BELOW);
        if (h >= COLLAPSED_BELOW) lastExpanded = h;
        try { localStorage.setItem(KEY, String(h)); } catch (e) { /* 忽略 */ }
      }
      App.timelineCollapsed = function () { return tl.classList.contains('collapsed'); };
      App.toggleTimeline = function () {
        applyHeight(App.timelineCollapsed() ? lastExpanded : MIN);
      };

      handle.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        handle.setPointerCapture(ev.pointerId);
        handle.classList.add('dragging');
        const startY = ev.clientY;
        const startH = tl.getBoundingClientRect().height;
        const move = function (e) {
          applyHeight(startH + (startY - e.clientY)); /* 向下拖 = 缩小 */
        };
        const up = function () {
          handle.classList.remove('dragging');
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
      });
      handle.addEventListener('dblclick', App.toggleTimeline);

      /* 启动时恢复上次高度（保存的是收起态高度则直接收起） */
      const saved = parseInt(localStorage.getItem(KEY) || '0', 10);
      if (saved) applyHeight(saved);
    })();

    App.injectIcons(document);   /* 静态按钮 SVG 图标注入 */

    App.toast('欢迎来到轻立方！点场景里的示例立方体试试，或导入你的 GLB 模型', '', 5000);

    /* 自动保存恢复横条 */
    try {
      const as = localStorage.getItem('litecube_autosave');
      if (as) {
        const bar = document.createElement('div');
        bar.id = 'restore-bar';
        bar.innerHTML = '<span>📦 检测到上次未保存的作品</span><button id="rb-restore">恢复</button><button id="rb-drop">丢弃</button>';
        document.body.appendChild(bar);
        document.querySelector('#rb-restore').addEventListener('click', function () {
          bar.remove();
          App.openProjectFile(new File([as], '自动恢复.lcz.json', { type: 'application/json' }));
        });
        document.querySelector('#rb-drop').addEventListener('click', function () {
          App.clearAutosave();
          bar.remove();
        });
      }
    } catch (e) { /* 隐私模式等忽略 */ }

    /* 首次访问引导 */
    let seen = false;
    try { seen = !!localStorage.getItem('litecube_welcomed'); } catch (e) { /* 隐私模式忽略 */ }
    if (!seen) {
      document.querySelector('#welcome').classList.remove('hidden');
      document.querySelector('#w-demo').addEventListener('click', function () {
        closeWelcome();
        App.loadDemoScene();
      });
      document.querySelector('#w-start').addEventListener('click', closeWelcome);
    }
    function closeWelcome() {
      document.querySelector('#welcome').classList.add('hidden');
      try { localStorage.setItem('litecube_welcomed', '1'); } catch (e) { /* 忽略 */ }
    }
  };

  /* ---------- gizmo 模式 / 吸附 ---------- */
  App.setGizmoMode = function (mode) {
    if (!App.three.ready) return;
    App.three.tctrl.setMode(mode);
    document.querySelectorAll('#gizmo-modes .mode').forEach(function (b) {
      b.classList.toggle('on', b.dataset.mode === mode);
    });
  };

  App.setSnap = function (on) {
    const t = App.three.tctrl;
    t.setTranslationSnap(on ? 0.5 : null);
    t.setRotationSnap(on ? T().MathUtils.degToRad(15) : null);
    t.setScaleSnap(on ? 0.1 : null);
  };

  /* ---------- 播放预览 ---------- */
  /* ---------- 设备相关提示文案 ---------- */
  App.hintText = function () {
    const touch = 'ontouchstart' in window;
    return touch
      ? '单指拖动转视角 · 双指缩放/平移 · 点按选择物体 · 双击聚焦'
      : '左键/右键拖动转视角 · 中键平移 · 滚轮缩放 · 双击聚焦';
  };

  App.togglePreview = function () {
    if (!App.entries.length) { App.toast('场景是空的', 'warn'); return; }
    App.preview = !App.preview;
    const tctrl = App.three.tctrl, boxHelper = App.three.boxHelper;
    const btn = document.querySelector('#btn-play');
    const hint = document.querySelector('#hint-bar');
    if (App.preview) {
      if (App._multiPivotActive && App._multiPivotActive()) App._teardownMultiPivot();
      tctrl.visible = false; tctrl.enabled = false;
      boxHelper.visible = false;
      /* 记录进入预览前每个物体的完整状态：退出时精确回到编辑状态
         （姿态 + 材质/显隐——「变成某颜色」「显示↔隐藏」等交互只在预览沙盒里生效） */
      App._prePreviewPose = {};
      App.entries.forEach(function (e) {
        const o = e.object3D;
        App._prePreviewPose[e.id] = {
          p: o.position.toArray(),
          r: [o.rotation.x, o.rotation.y, o.rotation.z],
          s: o.scale.toArray(),
          visible: o.visible,
          mats: App.entryMaterials(e).map(function (m) {
            return {
              color: m.color ? m.color.getHex() : null,
              emissive: m.emissive ? m.emissive.getHex() : null,
              emissiveIntensity: m.emissiveIntensity != null ? m.emissiveIntensity : null,
              opacity: m.opacity != null ? m.opacity : null,
              transparent: !!m.transparent,
              depthWrite: m.depthWrite !== false,
              metalness: m.metalness != null ? m.metalness : null,
              roughness: m.roughness != null ? m.roughness : null,
              map: m.map || null,
            };
          }),
        };
      });
      App.playing = App.entries.some(App.entryHasAnim);
      App.setTime(0);
      App.setSpotBeamsVisible(false);   /* 预览：隐藏光束锥，只保留真实光照 */
      App.updatePlayUI();
      btn.textContent = '⏹ 退出预览';
      document.body.classList.add('preview-full'); /* 沉浸式：隐藏编辑 UI，视口铺满 */
      hint.textContent = '预览中：点一点物体试试交互 · 再按一次「退出预览」回去编辑';
      hint.classList.add('preview');
      App.emit('preview-start');
    } else {
      tctrl.visible = true; tctrl.enabled = true;
      if (App.selected) boxHelper.visible = true;
      App.playing = false;
      App.setTime(0);
      App.setSpotBeamsVisible(true);   /* 退出预览：恢复光束锥辅助显示 */
      /* 退出预览：恢复进入前的完整编辑状态（姿态 + 材质 + 显隐），交互改动不落盘 */
      if (App._tweens) App._tweens.length = 0;   // 掐掉还在飞的颜色/抖动补间
      const poseMap = App._prePreviewPose || {};
      Object.keys(poseMap).forEach(function (id) {
        const e = App.entryById(id);
        if (!e) return;
        const s = poseMap[id];
        e.object3D.position.fromArray(s.p);
        e.object3D.rotation.set(s.r[0], s.r[1], s.r[2]);
        e.object3D.scale.fromArray(s.s);
        if (s.visible !== undefined) e.object3D.visible = s.visible;
        if (s.mats) {
          App.entryMaterials(e).forEach(function (m, i) {
            const ms = s.mats[i];
            if (!ms) return;
            if (ms.color != null && m.color) m.color.setHex(ms.color);
            if (ms.emissive != null && m.emissive) m.emissive.setHex(ms.emissive);
            if (ms.emissiveIntensity != null) m.emissiveIntensity = ms.emissiveIntensity;
            if (ms.opacity != null) { m.opacity = ms.opacity; m.transparent = ms.transparent; m.depthWrite = ms.depthWrite; }
            if (ms.metalness != null) m.metalness = ms.metalness;
            if (ms.roughness != null) m.roughness = ms.roughness;
            if (ms.map !== undefined) m.map = ms.map || null;
            m.needsUpdate = true;
          });
        }
      });
      App._prePreviewPose = null;
      App.updateTransformPanel();
      if (App.selected && boxHelper.visible) boxHelper.update();
      if (App._updateMultiBoxes) App._updateMultiBoxes();
      App.updatePlayUI();
      btn.textContent = '▶ 播放预览';
      document.body.classList.remove('preview-full');
      hint.textContent = App.hintText();
      hint.classList.remove('preview');
      App.emit('preview-end');
    }
  };
  App.on('preview-start', function () {
    App.entries.forEach(function (e) { App.runRules(e, 'load'); });
    /* 模型自带动画在预览时自动播放 */
    App.entries.forEach(function (e) {
      if (e.object3D.userData.clips && e.object3D.userData.clips.length) App.playEntryClips(e);
    });
  });
  App.on('multiselection', function () {
    const bar = document.querySelector('#batch-bar');
    const n = App.selectionCount();
    if (n > 1) {
      bar.classList.remove('hidden');
      document.querySelector('#batch-count').textContent = '已选 ' + n + ' 个';
    } else {
      bar.classList.add('hidden');
    }
  });

  /* ---------- 工具栏 ---------- */
  function bindToolbar() {
    const $ = App.$;
    /* 窄屏抽屉面板：默认收起，点按钮呼出 */
    function isNarrow() { return window.matchMedia('(max-width: 900px)').matches; }
    function syncDrawers() {
      document.body.classList.toggle('left-hidden', isNarrow());
      document.body.classList.toggle('right-hidden', isNarrow());
    }
    syncDrawers();
    window.addEventListener('resize', syncDrawers);
    $('#tg-left').addEventListener('click', function () {
      document.body.classList.toggle('left-hidden');
      this.textContent = document.body.classList.contains('left-hidden') ? '☰ 物体' : '✕ 收起';
    });
    $('#tg-right').addEventListener('click', function () {
      document.body.classList.toggle('right-hidden');
      this.textContent = document.body.classList.contains('right-hidden') ? '⚙ 属性' : '✕ 收起';
    });

    /* 左栏标签页：场景 / 添加（与右栏 tabs 同款式） */
    function showLeftTab(which) {
      document.querySelector('#lt-scene').classList.toggle('on', which === 'scene');
      document.querySelector('#lt-add').classList.toggle('on', which === 'add');
      document.querySelector('#left-scene').classList.toggle('on', which === 'scene');
      document.querySelector('#left-add').classList.toggle('on', which === 'add');
    }
    $('#lt-scene').addEventListener('click', function () { showLeftTab('scene'); });
    $('#lt-add').addEventListener('click', function () { showLeftTab('add'); });
    App.showLeftTab = showLeftTab;

    $('#btn-import').addEventListener('click', function () { $('#file-glb').click(); });
    $('#file-glb').addEventListener('change', function (ev) {
      const files = ev.target.files;
      if (!files || !files.length) { ev.target.value = ''; return; }
      const arr = Array.from(files);
      if (arr.length === 1) {
        App.importGLBFile(arr[0]);
      } else if (arr.some(function (f) { return /\.obj$/i.test(f.name); })) {
        App.importOBJFiles(files); /* .obj + .mtl + 贴图 成套导入 */
      } else {
        App.importGLBFile(arr[0]);
        App.toast('一次只导入了第一个文件；OBJ 需要成套选择 .obj + .mtl + 贴图', 'warn', 4000);
      }
      ev.target.value = '';
    });

    const sceneMenu = $('#scene-menu');
    $('#btn-scene').addEventListener('click', function (ev) {
      ev.stopPropagation();
      sceneMenu.classList.toggle('hidden');
    });
    /* 场景菜单内的点击不冒泡：勾选网格/阴影、调背景色时可连续调整，菜单不关闭
       （「📷 保存画面截图」有自己的处理器，截完主动收起） */
    sceneMenu.addEventListener('click', function (ev) { ev.stopPropagation(); });
    document.addEventListener('click', function () {
      document.querySelectorAll('.menu').forEach(function (m) { m.classList.add('hidden'); });
    });
    $('#scene-bg').addEventListener('input', function (ev) { App.setSceneBg(ev.target.value); });
    $('#scene-bg').addEventListener('change', function () { App.commitUndo(); });
    document.querySelectorAll('#scene-menu [data-bg]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        App.setSceneBg(btn.dataset.bg);
        document.querySelector('#scene-bg').value = btn.dataset.bg;
        App.commitUndo();
      });
    });
    $('#scene-grid').addEventListener('change', function (ev) {
      App.three.grid.visible = ev.target.checked;
      App.commitUndo();
    });
    $('#scene-shadow').addEventListener('change', function (ev) {
      App.setShadows(ev.target.checked);
      App.commitUndo();
    });
    $('#btn-screenshot').addEventListener('click', function () {
      App.saveScreenshot();
      $('#scene-shadow').closest('.menu').classList.add('hidden');
    });
    document.querySelectorAll('.shape-grid [data-shape]').forEach(function (btn) {
      btn.addEventListener('click', function () { App.addPrimitive(btn.dataset.shape); });
    });
    document.querySelectorAll('[data-tpl]').forEach(function (btn) {
      btn.addEventListener('click', function () { App.addTemplate(btn.dataset.tpl); });
    });
    document.querySelectorAll('[data-scene]').forEach(function (btn) {
      btn.addEventListener('click', function () { App.addSceneTemplate(btn.dataset.scene); });
    });
    /* 添加后自动切到「场景」页，让用户立刻看到新物体 */
    document.querySelectorAll('#left-add [data-shape], #left-add [data-tpl], #left-add [data-scene]').forEach(function (btn) {
      btn.addEventListener('click', function () { showLeftTab('scene'); });
    });
    $('#btn-demo').addEventListener('click', function () {
      App.loadDemoScene();
      showLeftTab('scene');
    });
    $('#batch-del').addEventListener('click', App.deleteSelected);
    $('#batch-dup').addEventListener('click', App.duplicateSelected);
    $('#batch-drop').addEventListener('click', App.dropSelected);

    $('#btn-new').addEventListener('click', function () {
      if (!App.entries.length) { App.toast('场景已经是空的啦', 'warn', 1500); return; }
      if (window.confirm('清空当前场景，从头开始？\n（点错也不怕：确定后按 Ctrl+Z 可撤销）')) {
        App.clearScene();
        App.select(null);
        App.toast('已新建空白场景 🆕');
      }
    });
    $('#btn-save').addEventListener('click', App.saveProject);
    $('#btn-open').addEventListener('click', function () { $('#file-project').click(); });
    $('#file-project').addEventListener('change', function (ev) {
      const f = ev.target.files[0];
      if (f) App.openProjectFile(f);
      ev.target.value = '';
    });
    $('#btn-export-glb').addEventListener('click', App.exportGLB);
    $('#btn-publish').addEventListener('click', function () {
      /* 所见即所得：先渲染一帧再截取画面 */
      try {
        const r = App.three.renderer;
        r.render(App.three.scene, App.three.camera);
        $('#pubm-thumb').src = r.domElement.toDataURL('image/jpeg', 0.85);
      } catch (e) { $('#pubm-thumb').style.display = 'none'; }
      $('#pubm-name').value = App._publishName || '我的3D作品';
      $('#pubm-link').value = App._publishLink || '';
      $('#pub-modal').classList.remove('hidden');
    });
    $('#pubm-close').addEventListener('click', function () { $('#pub-modal').classList.add('hidden'); });
    $('#pubm-cancel').addEventListener('click', function () { $('#pub-modal').classList.add('hidden'); });
    $('#pubm-go').addEventListener('click', function () {
      const name = $('#pubm-name').value.trim() || '我的3D作品';
      const link = $('#pubm-link').value.trim();
      App._publishName = name;
      App._publishLink = /^https?:\/\//.test(link) ? link : '';
      $('#pub-modal').classList.add('hidden');
      App.publish(name, App._publishLink);
    });
    $('#pub-modal').addEventListener('click', function (ev) {
      if (ev.target.id === 'pub-modal') ev.target.classList.add('hidden');
    });

    $('#btn-undo').addEventListener('click', App.undo);
    $('#btn-redo').addEventListener('click', App.redo);

    document.querySelectorAll('#gizmo-modes .mode').forEach(function (btn) {
      btn.addEventListener('click', function () { App.setGizmoMode(btn.dataset.mode); });
    });
    $('#snap-toggle').addEventListener('change', function (ev) { App.setSnap(ev.target.checked); });

    $('#btn-play').addEventListener('click', App.togglePreview);
    $('#exit-preview').addEventListener('click', App.togglePreview); /* 沉浸式预览右上角退出按钮 */
    $('#pv-replay').addEventListener('click', function () {
      /* 预览重播：时间归零、重新播放全部动画（含 GLB 自带动画） */
      if (!App.preview) return;
      App.time = 0;
      App.playing = true;
      App.entries.forEach(function (e) {
        if (e.object3D.userData.clips && e.object3D.userData.clips.length) App.playEntryClips(e);
      });
      App.updatePlayUI();
    });

    $('#btn-help').addEventListener('click', function () { $('#modal').classList.remove('hidden'); });
    $('#modal-close').addEventListener('click', function () { $('#modal').classList.add('hidden'); });
    $('#modal').addEventListener('click', function (ev) {
      if (ev.target.id === 'modal') ev.target.classList.add('hidden');
    });

    document.querySelectorAll('#view-hud button').forEach(function (btn) {
      btn.addEventListener('click', function () { App.setView(btn.dataset.view); });
    });
  }

  /* ---------- 右侧 Tab ---------- */
  /* 切换右栏标签页；供标签点击与「导入后默认显示变换」复用 */
  App.showRightTab = function (which) {
    document.querySelectorAll('#right .tabs button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.tab === which);
    });
    document.querySelectorAll('#right .tab-page').forEach(function (p) {
      p.classList.toggle('on', p.id === 'tab-' + which);
    });
  };

  function bindTabs() {
    /* 只绑右栏按钮：左栏 tabs 同名类此前会被误绑，点击左栏会清空右栏选中态导致面板空白 */
    document.querySelectorAll('#right .tabs button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        App.showRightTab(btn.dataset.tab);
      });
    });
  }

  /* ---------- 变换面板 ---------- */
  function bindTransformPanel() {
    const deg = d => d * Math.PI / 180;
    const num = id => Number(document.querySelector(id).value) || 0;

    function applyVec() {
      const e = App.selected;
      if (!e) return;
      const o = e.object3D;
      o.position.set(num('#tf-px'), num('#tf-py'), num('#tf-pz'));
      o.rotation.set(deg(num('#tf-rx')), deg(num('#tf-ry')), deg(num('#tf-rz')));
      o.scale.set(num('#tf-sx'), num('#tf-sy'), num('#tf-sz'));
      App.three.boxHelper.update();
      App.setAutoKeys(e);
    }

    ['#tf-px', '#tf-py', '#tf-pz', '#tf-rx', '#tf-ry', '#tf-rz', '#tf-sx', '#tf-sy', '#tf-sz'].forEach(function (id) {
      document.querySelector(id).addEventListener('input', applyVec);
      document.querySelector(id).addEventListener('change', function () { App.commitUndo(); });
    });

    document.querySelector('#tf-name').addEventListener('change', function (ev) {
      const e = App.selected;
      if (!e) return;
      e.name = App.uniqueName(ev.target.value.trim() || e.name);
      e.object3D.name = e.name;
      ev.target.value = e.name;
      App.emit('entries');
    });

    document.querySelector('#tf-focus').addEventListener('click', function () {
      if (App.selected) App.focusEntry(App.selected);
    });
    document.querySelector('#tf-drop').addEventListener('click', function () {
      const e = App.selected;
      if (!e) return;
      const THREE = T();
      e.object3D.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(e.object3D);
      if (box.isEmpty()) return;
      e.object3D.position.y -= box.min.y; /* 贴回地面 */
      e.object3D.updateWorldMatrix(true, true);
      App.three.boxHelper.update();
      App.updateTransformPanel();
      App.commitUndo();
      App.toast('已落到地面 ⬇');
    });
    document.querySelector('#tf-reset').addEventListener('click', function () {
      const e = App.selected;
      if (!e) return;
      const o = e.object3D;
      const bs = e.baseScale || 1; /* 回到「导入时的正常大小」，而不是字面量 1 */
      o.rotation.set(0, 0, 0);
      o.scale.set(bs, bs, bs);
      o.position.set(0, 0, 0);
      o.updateWorldMatrix(true, true); /* 强制刷新世界矩阵，避免用旧包围盒算错 */
      const THREE = T();
      const box = new THREE.Box3().setFromObject(o);
      if (!box.isEmpty()) o.position.y -= box.min.y;
      o.updateWorldMatrix(true, true);
      App.three.boxHelper.update();
      App.setAutoKeys(e);
      App.updateTransformPanel();
      App.focusEntry(e); /* 相机立刻带到物体前，绝不“看不见” */
      App.commitUndo();
      App.toast('已归位并聚焦 ↺');
    });
    document.querySelector('#tf-dup').addEventListener('click', function () { App.duplicateEntry(App.selected); });
    document.querySelector('#tf-del').addEventListener('click', function () { App.deleteEntry(App.selected); });
  }

  App.updateTransformPanel = function () {
    const e = App.selected;
    const page = document.querySelector('#tab-transform');
    page.classList.toggle('has-sel', !!e);
    if (!e) return;
    const o = e.object3D;
    const rad = r => Math.round(r * 180 / Math.PI);
    function set(id, v) {
      const el = document.querySelector(id);
      if (document.activeElement !== el) el.value = App.fmt(v);
    }
    set('#tf-px', o.position.x); set('#tf-py', o.position.y); set('#tf-pz', o.position.z);
    set('#tf-rx', rad(o.rotation.x)); set('#tf-ry', rad(o.rotation.y)); set('#tf-rz', rad(o.rotation.z));
    set('#tf-sx', o.scale.x); set('#tf-sy', o.scale.y); set('#tf-sz', o.scale.z);
    const nameEl = document.querySelector('#tf-name');
    if (document.activeElement !== nameEl) nameEl.value = e.name;
  };

  App.refreshAllPanels = function () {
    App.updateTransformPanel();
    App.refreshMaterialPanel();
    App.buildRuleRows();
  };

  /* ---------- 快捷键 ---------- */
  /* ---------- 右键菜单：屏蔽浏览器默认菜单，按区域出平台菜单 ---------- */
  let rightDownAt = null;

  App.showContextMenu = function (x, y, items) {
    const menu = App.$('#ctx-menu');
    menu.innerHTML = '';
    items.forEach(function (it) {
      const btn = App.el('button', it.danger ? 'danger' : '');
      btn.innerHTML = '<i>' + (App.ICONS[it.icon] ? App.icon(it.icon, 15) : (it.icon || '')) + '</i><span>' + it.label + '</span>';
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        App.hideContextMenu();
        if (it.action) it.action();
      });
      menu.appendChild(btn);
    });
    menu.classList.remove('hidden');
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(6, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    menu.style.top = Math.max(6, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
  };
  App.hideContextMenu = function () {
    App.$('#ctx-menu').classList.add('hidden');
  };

  function bindContextMenu() {
    document.addEventListener('pointerdown', function (ev) {
      if (ev.button === 2) rightDownAt = { x: ev.clientX, y: ev.clientY };
    });
    document.addEventListener('contextmenu', function (ev) {
      const t = ev.target;
      if (t.closest && t.closest('input, textarea, select')) return; /* 输入框保留系统菜单 */
      ev.preventDefault();
      /* 右键拖动 = 转视角，不算右键点击 */
      if (rightDownAt && Math.hypot(ev.clientX - rightDownAt.x, ev.clientY - rightDownAt.y) > 6) return;

      /* 场景树条目：物体操作菜单 */
      const li = t.closest ? t.closest('#tree li') : null;
      if (li) {
        const entry = App.entries.find(function (e) { return e.id === li.dataset.id; });
        if (!entry) return;
        if (!App.preview) App.select(entry);
        const items = [
          { icon: 'focus', label: '聚焦', action: function () { App.focusEntry(entry); } },
          { icon: 'rename', label: '重命名', action: function () { App.startTreeRename(entry); } },
          { icon: 'copy', label: '复制', action: function () { App.duplicateEntry(entry); } },
          {
            icon: entry.object3D.visible ? 'eyeOn' : 'eyeOff',
            label: entry.object3D.visible ? '隐藏' : '显示',
            action: function () {
              entry.object3D.visible = !entry.object3D.visible;
              App.emit('entries');
              App.commitUndo();
            },
          },
          { icon: 'drop', label: '落地', action: function () { App.select(entry); App.dropSelected(); } },
          { icon: 'curve', label: '做动画', action: function () { App.select(entry); App.toast('用底部「一键动画」或「◆ 打关键帧」给它做动画'); } },
        ];
        if (entry.object3D.userData.assetKey && App.assets[entry.object3D.userData.assetKey]) {
          items.push({ icon: 'star', label: '收藏此模型', action: function () { App.saveUserFav(entry); } });
        }
        items.push({ icon: 'trash', label: '删除', danger: true, action: function () { App.deleteEntry(entry); } });
        App.showContextMenu(ev.clientX, ev.clientY, items);
        return;
      }

      /* 视口：物体菜单 / 空白菜单 */
      if (t.closest && t.closest('#viewport')) {
        if (App.preview) return; /* 预览中只屏蔽 */
        const entry = App.pickEntryAt(ev.clientX, ev.clientY);
        if (entry) {
          App.select(entry);
          App.showContextMenu(ev.clientX, ev.clientY, [
            { icon: 'move', label: '移动', action: function () { App.setGizmoMode('translate'); } },
            { icon: 'rotate', label: '旋转', action: function () { App.setGizmoMode('rotate'); } },
            { icon: 'scale', label: '缩放', action: function () { App.setGizmoMode('scale'); } },
            { icon: 'focus', label: '聚焦', action: function () { App.focusEntry(entry); } },
            { icon: 'copy', label: '复制', action: function () { App.duplicateEntry(entry); } },
            { icon: 'drop', label: '落地', action: function () { App.dropSelected(); } },
            { icon: 'trash', label: '删除', danger: true, action: function () { App.deleteEntry(entry); } },
          ]);
        } else {
          App.showContextMenu(ev.clientX, ev.clientY, [
            { icon: 'undo', label: '撤销', action: function () { App.undo(); } },
            { icon: 'redo', label: '重做', action: function () { App.redo(); } },
            { icon: 'resetView', label: '重置视角', action: function () { App.setView('reset'); } },
            { icon: 'sparkles', label: '加载示例作品', action: function () { App.loadDemoScene(); } },
          ]);
        }
        return;
      }

      /* 其余区域（左栏面板/时间轴等）：屏蔽浏览器菜单并关闭已有平台菜单 */
      App.hideContextMenu();
    });
    document.addEventListener('click', function () { App.hideContextMenu(); });
    window.addEventListener('blur', function () { App.hideContextMenu(); });
  }

  /* ---------- 快捷键 ---------- */
  function bindKeyboard() {
    window.addEventListener('keydown', function (ev) {
      const tag = (ev.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      const k = (ev.key || '').toLowerCase();
      if ((ev.ctrlKey || ev.metaKey) && k === 'z') { ev.preventDefault(); ev.shiftKey ? App.redo() : App.undo(); }
      else if ((ev.ctrlKey || ev.metaKey) && k === 'y') { ev.preventDefault(); App.redo(); }
      else if ((ev.ctrlKey || ev.metaKey) && k === 'd') { ev.preventDefault(); App.duplicateEntry(App.selected); }
      else if (k === 'w' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !App.preview) App.setGizmoMode('translate');
      else if (k === 'e' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !App.preview) App.setGizmoMode('rotate');
      else if (k === 'r' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !App.preview) App.setGizmoMode('scale');
      else if (k === 'f' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !App.preview) { if (App.selected) App.focusEntry(App.selected); }
      else if (ev.key === 'Delete' || ev.key === 'Backspace') { if (!App.preview) App.deleteEntry(App.selected); }
      else if (ev.key === ' ') { ev.preventDefault(); if (!App.preview) App.togglePlay(); }
      else if (ev.key === 'Escape') {
        App.hideContextMenu();
        if (App.preview) App.togglePreview(); else App.select(null);
      }
      else if ((ev.key.startsWith('Arrow') || ev.key === 'PageUp' || ev.key === 'PageDown') && App.selected && !App.preview) {
        /* 方向键微移：一次 0.1 格，Shift 加速到 0.5；PgUp/PgDn 升降。连按合并为一次撤销 */
        ev.preventDefault();
        const step = ev.shiftKey ? 0.5 : 0.1;
        const o = App.selected.object3D;
        if (ev.key === 'ArrowLeft') o.position.x -= step;
        else if (ev.key === 'ArrowRight') o.position.x += step;
        else if (ev.key === 'ArrowUp') o.position.z -= step;
        else if (ev.key === 'ArrowDown') o.position.z += step;
        else if (ev.key === 'PageUp') o.position.y += step;
        else if (ev.key === 'PageDown') o.position.y -= step;
        App.three.boxHelper.update();
        App.setAutoKeys(App.selected);
        App.updateTransformPanel();
        App._dirty = true;   /* 立即置脏：关页提醒不遗漏 */
        clearTimeout(App._nudgeTimer);   /* 连按合并：停手 500ms 后记一次撤销 */
        App._nudgeTimer = setTimeout(function () { App.commitUndo(); }, 500);
      }
    });
  }

})();

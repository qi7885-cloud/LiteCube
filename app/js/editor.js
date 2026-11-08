/* ═══ editor.js — three.js 场景核心：渲染、相机、选择、变换 gizmo、指针交互 ═══ */
(function () {
  'use strict';
  const App = window.App, T = () => window.THREE, A = () => window.ADDONS;

  App.three = { ready: false };

  App.initEditor = function () {
    const THREE = T(), canvas = App.$('#viewport');
    const wrap = App.$('#viewport-wrap');

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1a1d26');
    scene.fog = new THREE.Fog('#1a1d26', 30, 90);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
    camera.position.set(7, 5, 9);

    /* 轨道控制器：左键也能转视角（点选靠位移阈值区分） */
    const controls = new (A().OrbitControls)(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.target.set(0, 1, 0);
    controls.minDistance = 0.5; controls.maxDistance = 120;
    controls.maxPolarAngle = Math.PI * 0.55;
    /* 左键/右键转视角，中键平移，滚轮缩放 */
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE,
    };

    /* 灯光 */
    scene.add(new THREE.HemisphereLight('#cfd8ff', '#3a3428', 0.55));
    const sun = new THREE.DirectionalLight('#fff4e0', 1.6);
    sun.position.set(6, 10, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -15; sun.shadow.camera.right = 15;
    sun.shadow.camera.top = 15; sun.shadow.camera.bottom = -15;
    sun.shadow.bias = -0.0004;
    scene.add(sun);
    const fill = new THREE.DirectionalLight('#9db8ff', 0.35);
    fill.position.set(-6, 4, -5);
    scene.add(fill);

    /* 环境反射（金属/玻璃需要） */
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new (A().RoomEnvironment)(), 0.04).texture;
    } catch (e) { console.warn('环境贴图加载失败', e); }

    /* 地面：网格 + 阴影 */
    const grid = new THREE.GridHelper(24, 24, '#3d4457', '#262b38');
    grid.material.transparent = true; grid.material.opacity = 0.85;
    scene.add(grid);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ opacity: 0.32 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    /* 用户物体根节点 */
    const userRoot = new (T().Group)();
    userRoot.name = '__userRoot__';
    scene.add(userRoot);

    /* 选中框 */
    const boxHelper = new (T().BoxHelper)(undefined, '#ffc400');
    boxHelper.visible = false;
    scene.add(boxHelper);

    /* 变换 gizmo */
    const tctrl = new (A().TransformControls)(camera, canvas);
    tctrl.setSize(0.9);
    scene.add(tctrl);
    tctrl.addEventListener('dragging-changed', e => { controls.enabled = !e.value; });
    tctrl.addEventListener('objectChange', () => {
      boxHelper.update();
      if (App._updateMultiBoxes) App._updateMultiBoxes();
      App.updateTransformPanel && App.updateTransformPanel();
      if (App.autoKey && App.selected) App.setAutoKeys(App.selected);
    });
    tctrl.addEventListener('mouseUp', () => {
      /* 多选整体拖动结束后：先拆枢轴回写世界变换 → 记录撤销（此时坐标才是 userRoot 局部）→ 再重建枢轴 */
      const multi = App._multiPivotActive && App._multiPivotActive();
      if (multi) App._teardownMultiPivot();
      App.commitUndo && App.commitUndo();
      if (multi) App._setupMultiPivot();
    });

    /* 尺寸自适应 */
    function resize() {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(wrap);
    resize();

    Object.assign(App.three, { renderer, scene, camera, controls, tctrl, userRoot, boxHelper, ground, sun, grid, ready: true });

    /* ---------- 指针交互：选择 / 悬停 / 交互规则触发 ---------- */
    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    let downPos = null, hovered = null, hoverClock = 0;

    function pick(ev) {
      const r = canvas.getBoundingClientRect();
      ptr.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      ptr.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(ptr, camera);
      const hits = ray.intersectObjects(App.three.userRoot.children, true);
      for (const h of hits) {
        let o = h.object;
        while (o && o.parent !== App.three.userRoot) o = o.parent;
        if (o) {
          const entry = App.entries.find(e => e.object3D === o);
          if (entry) return entry;
        }
      }
      return null;
    }

    canvas.addEventListener('pointerdown', ev => { downPos = { x: ev.clientX, y: ev.clientY, b: ev.button }; });

    canvas.addEventListener('pointerup', ev => {
      if (!downPos || downPos.b !== 0) { downPos = null; return; }
      const moved = Math.hypot(ev.clientX - downPos.x, ev.clientY - downPos.y);
      downPos = null;
      if (moved > 6 || tctrl.dragging) return;              // 拖动视角/gizmo，不算点击
      const entry = pick(ev);
      if (App.preview) {
        if (entry) App.runRules(entry, 'click');
        return;
      }
      if (ev.shiftKey && entry) App.toggleSelect(entry);
      else App.select(entry);
    });

    canvas.addEventListener('dblclick', ev => {
      const entry = pick(ev);
      if (!entry) return;
      if (App.preview) { App.runRules(entry, 'dblclick'); return; }
      App.select(entry); App.focusEntry(entry);
    });

    canvas.addEventListener('pointermove', ev => {
      if (tctrl.dragging || downPos) { setHover(null); return; }
      const now = performance.now();
      if (now - hoverClock < 60) return;
      hoverClock = now;
      const entry = pick(ev);
      setHover(entry);
      canvas.style.cursor = entry ? 'pointer' : '';
    });
    canvas.addEventListener('pointerleave', () => setHover(null));

    /* 供右键菜单使用：按屏幕坐标拾取物体 */
    App.pickEntryAt = function (clientX, clientY) {
      return pick({ clientX: clientX, clientY: clientY });
    };

    function setHover(entry) {
      if (entry === hovered) return;
      if (hovered && App.preview) App.runRules(hovered, 'hoverOut');
      hovered = entry;
      if (entry && App.preview) App.runRules(entry, 'hover');
    }

    /* ---------- 拖拽导入（整个窗口都接收） ---------- */
    document.addEventListener('dragover', ev => {
      ev.preventDefault();
      if (ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files')) {
        App.$('#drop-mask').classList.remove('hidden');
      }
    });
    document.addEventListener('dragleave', ev => {
      if (!ev.relatedTarget) App.$('#drop-mask').classList.add('hidden');
    });
    document.addEventListener('drop', ev => {
      ev.preventDefault();
      App.$('#drop-mask').classList.add('hidden');
      const files = Array.from(ev.dataTransfer.files || []);
      if (!files.length) return;
      if (files.some(f => /\.obj$/i.test(f.name))) { App.importOBJFiles(files); return; }
      const file = files[0];
      if (/\.(glb|gltf)$/i.test(file.name)) App.importGLBFile(file);
      else if (file) App.toast('请拖入 .glb / .gltf / .obj 模型文件', 'warn');
    });

    /* ---------- 渲染循环 ---------- */
    const clock = new THREE.Clock();
    (function loop() {
      requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05);
      controls.update();

      App.hooks.tick.forEach(fn => fn(dt));   // 动画播放、补间、自转等

      /* 文字牌始终面向相机 */
      App.entries.forEach(function (e) {
        if (e.object3D.userData && e.object3D.userData.billboard) {
          e.object3D.quaternion.copy(camera.quaternion);
        }
      });

      if (boxHelper.visible && boxHelper.object) boxHelper.update();
      renderer.render(scene, camera);
      /* 渲染后钩子（GIF 抓帧等，须在渲染后同帧读取画布） */
      if (App.hooks.postRender) {
        for (let i = 0; i < App.hooks.postRender.length; i++) {
          try { App.hooks.postRender[i](dt); } catch (e) { /* 单个钩子异常不影响渲染 */ }
        }
      }
    })();
  };

  /* ---------- 视图切换 ---------- */
  App.setView = function (dir) {
    const { camera, controls } = App.three;
    const t = controls.target.clone();
    const d = camera.position.distanceTo(t) || 12;
    if (dir === 'reset') {
      App.tweenCamera(new (T().Vector3)(7, 5, 9), new (T().Vector3)(0, 1, 0), 0.5);
      return;
    }
    const map = {
      front: [0, d * 0.25, d], top: [0, d, 0.001], side: [d, d * 0.25, 0], persp: [d * 0.62, d * 0.45, d * 0.8],
    };
    const v = map[dir];
    if (v) App.tweenCamera(new (T().Vector3)(t.x + v[0], t.y + v[1], t.z + v[2]), t, 0.45);
  };

  /* ---------- 场景设置 ---------- */
  App.setSceneBg = function (hex) {
    App.three.scene.background.set(hex);
    App.three.scene.fog.color.set(hex);
  };

  App.setShadows = function (on) {
    App.three.renderer.shadowMap.enabled = on;
    App.three.sun.castShadow = on;
    App.three.scene.traverse(function (o) {
      if (o.isMesh && o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.needsUpdate = true; });
      }
    });
  };

  /* 保存当前画面为 PNG 图片（渲染一帧后立即截取，避免缓冲清空） */
  App.saveScreenshot = function () {
    const r = App.three.renderer;
    r.render(App.three.scene, App.three.camera);
    try {
      const dataURL = r.domElement.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataURL;
      a.download = (App._publishName || '我的3D作品') + '-截图.png';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { a.remove(); }, 800);
      App.toast('📷 画面已保存为图片');
    } catch (e) {
      App.toast('截图失败：' + (e && e.message ? e.message : e), 'err');
    }
  };

  App.focusEntry = function (entry) {
    const THREE = T();
    const box = new THREE.Box3().setFromObject(entry.object3D);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 2;
    const dir = App.three.camera.position.clone().sub(App.three.controls.target).normalize();
    App.tweenCamera(center.clone().add(dir.multiplyScalar(Math.max(size * 2.2, 2.5))), center, 0.5);
  };

  /* ---------- 相机补间 ---------- */
  App.tweenCamera = function (toPos, toTarget, dur = 0.6) {
    const { camera, controls } = App.three;
    const fromP = camera.position.clone(), fromT = controls.target.clone();
    const tween = { t: 0, dur };
    App.hooks.tick.push(function step(dt) {
      tween.t += dt;
      const k = App.easeInOut(Math.min(tween.t / tween.dur, 1));
      camera.position.lerpVectors(fromP, toPos, k);
      controls.target.lerpVectors(fromT, toTarget, k);
      if (tween.t >= tween.dur) { const i = App.hooks.tick.indexOf(step); if (i >= 0) App.hooks.tick.splice(i, 1); }
    });
  };

  /* ---------- 选中（含多选） ---------- */
  let extraBoxes = [];
  function syncExtraBoxes() {
    extraBoxes.forEach(function (b) {
      App.three.scene.remove(b);
      if (b.geometry) b.geometry.dispose();
    });
    extraBoxes = [];
    App.selection.slice(1).forEach(function (e) {
      const bh = new (T().BoxHelper)(e.object3D, '#ffc400');
      App.three.scene.add(bh);
      extraBoxes.push(bh);
    });
  }
  App._syncMultiBoxes = syncExtraBoxes;
  App._updateMultiBoxes = function () {
    extraBoxes.forEach(function (b) { if (b.object) b.update(); });
  };

  /* 多选整体移动：把选中物体临时挂到一个枢轴组上 */
  let multiPivot = null;
  App._setupMultiPivot = function () {
    const THREE = T();
    const sel = App.selection.filter(function (e) { return App.entries.includes(e); });
    if (sel.length < 2) return;
    App._teardownMultiPivot();
    const pivot = new THREE.Group();
    const center = new THREE.Vector3();
    sel.forEach(function (e) { center.add(e.object3D.position); });
    center.divideScalar(sel.length);
    pivot.position.copy(center);
    App.three.userRoot.add(pivot);
    sel.forEach(function (e) { pivot.attach(e.object3D); });
    multiPivot = pivot;
    App.three.tctrl.attach(pivot);
  };
  App._teardownMultiPivot = function () {
    if (!multiPivot) return;
    const userRoot = App.three.userRoot;
    multiPivot.children.slice().forEach(function (o) { userRoot.attach(o); });
    if (multiPivot.parent) multiPivot.parent.remove(multiPivot);
    multiPivot = null;
  };
  App._multiPivotActive = function () { return !!multiPivot; };

  App.select = function (entry, quiet) {
    const { tctrl, boxHelper } = App.three;
    if (!entry) { App.selection = []; App._teardownMultiPivot(); }
    else if (!App.selection.includes(entry)) App.selection = [entry];
    App.selected = entry || null;
    App.selectedKey = null;
    if (entry && App.selection.length === 1) {
      App._teardownMultiPivot();
      tctrl.attach(entry.object3D);
    } else if (entry && App.selection.length > 1) {
      App._setupMultiPivot();
    } else {
      tctrl.detach();
    }
    if (entry) {
      boxHelper.setFromObject(entry.object3D);
      boxHelper.visible = true;
    } else {
      boxHelper.visible = false;
    }
    syncExtraBoxes();
    if (!quiet) {
      App.emit('selection', App.selected);
      App.emit('multiselection');
      App.refreshAllPanels && App.refreshAllPanels();
    }
  };

  /* Shift+点击：加入/移出多选；最后点的是主选（面板作用于它） */
  App.toggleSelect = function (entry) {
    if (!entry) return;
    const i = App.selection.indexOf(entry);
    if (i >= 0) App.selection.splice(i, 1);
    else App.selection.push(entry);
    const primary = App.selection[App.selection.length - 1] || null;
    App.select(primary);
  };

  App.selectionCount = function () { return App.selection.filter(e => App.entries.includes(e)).length; };
})();

/* ═══ gizmo.js — 视口右上角视角方向指示器（XYZ 罗盘） ═══
   - 三条彩轴 + 带字母的正方向球（X红 / Y绿 / Z蓝）+ 负方向空心点
   - 姿态实时跟随主相机，帮助用户随时知道 XYZ 方向
   - 点击轴球：相机平滑对齐到该轴视角（+Y=顶视 / -Y=仰视 / ±X 侧视 / ±Z 正背视） */
(function () {
  'use strict';
  const App = window.App;
  const T = () => window.THREE;

  App.initGizmo = function () {
    if (!App.three.ready) return;
    const THREE = T();
    const wrap = App.$('#viewport-wrap');
    if (!wrap || App.$('#view-gizmo')) return;

    const SIZE = 132;
    const box = document.createElement('div');
    box.id = 'view-gizmo';
    box.title = '视角方向指示：X红 · Y绿 · Z蓝 · 点击圆点对齐到该轴视角';
    const cv = document.createElement('canvas');
    cv.width = SIZE * 2; cv.height = SIZE * 2;
    cv.style.width = SIZE + 'px'; cv.style.height = SIZE + 'px';
    box.appendChild(cv);
    wrap.appendChild(box);

    const renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true });
    renderer.setPixelRatio(2);
    renderer.setSize(SIZE, SIZE, false);

    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 10);

    /* 轴球贴图：正方向=实心圆+字母；负方向=暗底描边空心圆 */
    function posTexture(color, label) {
      const c = document.createElement('canvas');
      c.width = c.height = 96;
      const ctx = c.getContext('2d');
      ctx.beginPath(); ctx.arc(48, 48, 40, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 40px Arial';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, 48, 51);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }
    function negTexture(color) {
      const c = document.createElement('canvas');
      c.width = c.height = 96;
      const ctx = c.getContext('2d');
      ctx.beginPath(); ctx.arc(48, 48, 38, 0, Math.PI * 2);
      ctx.fillStyle = '#14161d'; ctx.fill();
      ctx.lineWidth = 9; ctx.strokeStyle = color; ctx.stroke();
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    const AXES = [
      { dir: new THREE.Vector3(1, 0, 0), color: '#ff5252', label: 'X' },
      { dir: new THREE.Vector3(0, 1, 0), color: '#7ddb4f', label: 'Y' },
      { dir: new THREE.Vector3(0, 0, 1), color: '#4d8dff', label: 'Z' },
    ];
    const pickables = [];

    AXES.forEach(function (a) {
      /* 正方向轴球 */
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: posTexture(a.color, a.label), depthTest: false }));
      sp.position.copy(a.dir).multiplyScalar(0.82);
      sp.scale.setScalar(0.58);
      sp.userData.axis = a.dir.clone();
      scene.add(sp);
      pickables.push(sp);
      /* 负方向空心点 */
      const sn = new THREE.Sprite(new THREE.SpriteMaterial({ map: negTexture(a.color), depthTest: false }));
      sn.position.copy(a.dir).multiplyScalar(-0.82);
      sn.scale.setScalar(0.42);
      sn.userData.axis = a.dir.clone().negate();
      scene.add(sn);
      pickables.push(sn);
      /* 轴线 */
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), a.dir.clone().multiplyScalar(0.72)]);
      scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: a.color })));
    });

    /* 每帧：姿态跟随主相机（视线方向 + up 一致） */
    function renderGizmo() {
      const { camera, controls } = App.three;
      cam.up.copy(camera.up);
      cam.position.copy(camera.position).sub(controls.target).setLength(2.6);
      cam.lookAt(0, 0, 0);
      renderer.render(scene, cam);
    }
    App.hooks.tick.push(function () { renderGizmo(); });

    /* 点击轴球 → 相机平滑对齐该轴视角 */
    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    let downAt = null;
    cv.addEventListener('pointerdown', function (ev) { downAt = { x: ev.clientX, y: ev.clientY }; });
    cv.addEventListener('pointerup', function (ev) {
      if (!downAt) return;
      const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
      downAt = null;
      if (moved > 5) return;
      const r = cv.getBoundingClientRect();
      ptr.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      ptr.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(ptr, cam);
      const hits = ray.intersectObjects(pickables);
      if (!hits.length) return;
      const axis = hits[0].object.userData.axis.clone();
      const { camera, controls } = App.three;
      const d = camera.position.distanceTo(controls.target) || 12;
      /* ±Y 视角对 up 向量有奇点，加微小偏移规避 */
      const eps = new THREE.Vector3(0, 0, axis.y !== 0 ? 0.001 * (axis.y > 0 ? 1 : -1) : 0);
      App.tweenCamera(
        controls.target.clone().add(axis.multiplyScalar(d)).add(eps),
        controls.target.clone(), 0.45
      );
    });
    cv.addEventListener('pointermove', function (ev) {
      const r = cv.getBoundingClientRect();
      ptr.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      ptr.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(ptr, cam);
      cv.style.cursor = ray.intersectObjects(pickables).length ? 'pointer' : '';
    });

    /* 供自动化验证 */
    App._gizmo = { cam: cam, canvas: cv, scene: scene, pickables: pickables };
  };
})();

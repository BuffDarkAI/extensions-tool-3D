// Chạy: node test/browser.test.js
// Chạy cả userscript (phần trình duyệt) với một CVAT GIẢ: store Redux, canvas 3D, camera, scene three.js giả.
// Mục đích: bắt lỗi trong code của script (phím, Ctrl+click, Shift+kéo, khoá mặt đất, tạo cuboid mới).
// KHÔNG thay cho thử trên CVAT thật: CVAT giả ở đây được viết theo cách script đoán CVAT hoạt động.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { scan, car, roughOf, GROUND_Z } = require('./sim.js');

let fails = 0;
function ok(name, cond, detail = '') {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name.padEnd(52)} ${detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const f2 = (v) => v.toFixed(2);

// ------------------------------------------------------------ DOM giả
let winListeners = {};
const win = {
  addEventListener(t, fn, cap) { (winListeners[t] = winListeners[t] || []).push({ fn, cap: !!cap }); },
  removeEventListener() {},
};
function runListeners(list, ev) {
  for (const l of list) { l.fn(ev); if (ev._immediate) return true; }
  return false;
}
function makeEvent(type, init = {}) {
  return Object.assign({
    type, defaultPrevented: false, _stopped: false, _immediate: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this._stopped = true; },
    stopImmediatePropagation() { this._stopped = true; this._immediate = true; },
  }, init);
}
// Phát sự kiện tới target: pha capture trên window, rồi listener của target, rồi pha bubble trên window
function dispatch(target, ev) {
  const capture = (winListeners[ev.type] || []).filter((l) => l.cap);
  if (runListeners(capture, ev)) return ev;
  if (ev._stopped) return ev;
  if (target && target.listeners) runListeners(target.listeners[ev.type] || [], ev);
  if (!ev._stopped) runListeners((winListeners[ev.type] || []).filter((l) => !l.cap), ev);
  return ev;
}
class Elem {
  constructor(rect, tag = 'CANVAS') { this.rect = rect; this.tagName = tag; this.listeners = {}; this.style = {}; }
  getBoundingClientRect() { const r = this.rect; return { left: r[0], top: r[1], width: r[2], height: r[3], right: r[0] + r[2], bottom: r[1] + r[3] }; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push({ fn }); }
  dispatchEvent(ev) { dispatch(this, ev); return !ev.defaultPrevented; }
  closest() { return null; }
}
class CustomEvent {
  constructor(type, init = {}) { Object.assign(this, makeEvent(type)); this.detail = init.detail; }
}

const W = 1280, Hp = 600;
const el = {
  perspective: new Elem([0, 0, W, Hp]),
  top: new Elem([0, Hp, 426, 300]),
  side: new Elem([426, Hp, 426, 300]),
  front: new Elem([852, Hp, 426, 300]),
};
const body = new Elem([0, 0, W, 900], 'BODY');

// ------------------------------------------------------------ three.js giả
class Vec3 { constructor() { this.x = 0; this.y = 0; this.z = 0; } }
class Attr { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; } }
class Geo { constructor() { this.attributes = {}; this.userData = {}; } setAttribute(n, a) { this.attributes[n] = a; } dispose() {} }
class Color {
  constructor() { this.r = 1; this.g = 1; this.b = 1; }
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
  clone() { return new Color().copy(this); }
  copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
  multiplyScalar(s) { this.r *= s; this.g *= s; this.b *= s; return this; }
}
class Mat { constructor() { this.size = 0.05; this.color = new Color(); this.userData = {}; } clone() { const m = new Mat(); m.size = this.size; return m; } dispose() {} }
class Obj {
  constructor() { this.children = []; this.userData = {}; this.position = new Vec3(); this.name = ''; }
  add(o) { this.children.push(o); }
  remove(o) { this.children = this.children.filter((c) => c !== o); }
  traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
}
class Points extends Obj {
  constructor(geo, mat) { super(); this.isPoints = true; this.geometry = geo; this.material = mat; this.matrixWorld = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }; }
  updateMatrixWorld() {}
}
class Mesh extends Obj { constructor() { super(); this.isMesh = true; } }

function lookAt(eye, target, up) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}
function perspective(fovy, aspect, near, far) {
  const t = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function ortho(half, aspect) {
  return [1 / (half * aspect), 0, 0, 0, 0, 1 / half, 0, 0, 0, 0, -2 / 200, 0, 0, 0, -1, 1];
}
const mulCM = (A, B) => {
  const C = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += A[k * 4 + r] * B[c * 4 + k]; C[c * 4 + r] = s; }
  return C;
};
const camera = (P, V) => ({ projectionMatrix: { elements: P }, matrixWorldInverse: { elements: V }, updateMatrixWorld() {} });

// ------------------------------------------------------------ cảnh: xe (đang chọn) + người ở xa
const carBox = car(8, 4, -20);
const ped = car(6, -3, 40, 0.7, 0.6, 1.75);
const pos = scan([carBox, ped]);
const cloud = new Points(new Geo(), new Mat());
cloud.geometry.setAttribute('position', new Attr(pos, 3));
const scenes = { perspective: new Obj(), top: new Obj(), side: new Obj(), front: new Obj() };
scenes.perspective.add(cloud);
const carMesh = new Mesh();
carMesh.name = '1';
scenes.perspective.add(carMesh);

const eye = [-2, -12, 6], look = [7, 1, -1];
const Vp = lookAt(eye, look, [0, 0, 1]), Pp = perspective(Math.PI / 3, W / Hp, 0.1, 300);
const PV = mulCM(Pp, Vp);
const views = {
  perspective: { scene: scenes.perspective, camera: camera(Pp, Vp) },
  // Top: nhìn từ trên xuống, x sang phải, y lên trên. Side: nhìn theo +y. Front: nhìn theo -x.
  top: { scene: scenes.top, camera: camera(ortho(5, 426 / 300), lookAt([8, 4, 50], [8, 4, 0], [0, 1, 0])) },
  side: { scene: scenes.side, camera: camera(ortho(5, 426 / 300), lookAt([8, -46, -1], [8, 4, -1], [0, 0, 1])) },
  front: { scene: scenes.front, camera: camera(ortho(5, 426 / 300), lookAt([58, 4, -1], [8, 4, -1], [0, 0, 1])) },
};
// Toạ độ màn hình (px) của một điểm 3D trên view perspective
function screenOf(p) {
  const q = [0, 1, 2, 3].map((r) => PV[r] * p[0] + PV[4 + r] * p[1] + PV[8 + r] * p[2] + PV[12 + r]);
  return [((q[0] / q[3] + 1) / 2) * W, ((1 - q[1] / q[3]) / 2) * Hp];
}

// ------------------------------------------------------------ store Redux + CVAT giả
const labels = [{ id: 1, name: 'car' }, { id: 2, name: 'pedestrian' }];
const makeState = (id, points, label) => ({ clientID: id, shapeType: 'cuboid', points: points.slice(), label });
const states = [makeState(1, roughOf(carBox, 0.5, -0.3, 25), labels[0])];
let activated = 1;
let curFrame = 0;
const actions = [];
const subs = [];
const canvasInstance = { html: () => el, view: { views } };
// Track giả (id 99, chưa nằm trong states) với keyframe ở frame 0, 5, 10: như cvat-core, annotations.get(frame)
// trả về ObjectState có keyframe, keyframes { prev, next, first, last } và save() lưu lại keyframe đó
const trackShapes = {};
const keyframeList = () => Object.keys(trackShapes).map(Number).sort((a, b) => a - b);
function trackStateAt(f) {
  const ks = keyframeList();
  const prev = ks.filter((k) => k < f).pop(), next = ks.find((k) => k > f);
  const base = trackShapes[f] || trackShapes[prev != null ? prev : next];
  return {
    clientID: 99, objectType: 'track', shapeType: 'cuboid', frame: f, label: labels[0],
    keyframe: f in trackShapes, outside: false, lock: false, points: base.slice(),
    keyframes: { prev: prev == null ? null : prev, next: next == null ? null : next, first: ks[0], last: ks[ks.length - 1] },
    save() { trackShapes[f] = this.points.slice(); return Promise.resolve(this); },
  };
}
const jobInstance = {
  annotations: { get: async (f) => (Object.keys(trackShapes).length ? [trackStateAt(f)] : []) },
  actions: { get: async () => ({ undo: [], redo: [] }) },
};
const getState = () => ({
  annotation: {
    canvas: { instance: canvasInstance },
    annotations: { activatedStateID: activated, states },
    job: { labels, instance: jobInstance },
    drawing: { activeLabelID: 2 },
    player: { frame: { number: curFrame } },
  },
});
const notify = () => subs.forEach((fn) => fn());
const store = {
  getState,
  dispatch(a) { actions.push(a); if (a.type === 'ACTIVATE_OBJECT') activated = a.payload.activatedStateID; notify(); return a; },
  subscribe(fn) { subs.push(fn); },
};
// CVAT: lưu khi canvas báo sửa xong / vẽ xong
el.perspective.addEventListener('canvas.edited', (ev) => {
  const s = states.find((x) => x.clientID === ev.detail.state.clientID);
  s.points = ev.detail.points.slice();
  if (s.clientID === 99) trackShapes[curFrame] = s.points.slice(); // sửa track ở 1 frame = lưu keyframe frame đó
  notify();
});
let nextId = 2;
el.perspective.addEventListener('canvas.drawn', (ev) => {
  states.push(makeState(nextId++, ev.detail.state.points, labels[1]));
  notify();
});
// CVAT tự kéo cuboid (không phải script): canvas phát canvas.edited với points mới
function cvatDrag(id, dx, dy, dz) {
  const s = states.find((x) => x.clientID === id);
  const p = s.points.slice();
  p[0] += dx; p[1] += dy; p[2] += dz;
  el.perspective.dispatchEvent(new CustomEvent('canvas.edited', { detail: { state: { ...s, points: s.points.slice() }, points: p } }));
}

const root = { __reactContainer$test: { memoizedProps: { store }, child: null, sibling: null } };
const attrs = {};
const storage = {};
const toasts = [];
const document = {
  title: 'CVAT',
  documentElement: { getAttribute: (k) => attrs[k] || null, setAttribute: (k, v) => { attrs[k] = v; }, appendChild() {} },
  head: { appendChild() {} },
  body: Object.assign(body, { appendChild(t) { t.isToast = true; } }),
  getElementById: (id) => (id === 'root' ? root : null),
  createElement: (tag) => {
    const e = { tagName: tag.toUpperCase(), style: {}, remove() {} };
    if (tag === 'div') {
      let txt = '';
      Object.defineProperty(e, 'textContent', { get: () => txt, set: (v) => { txt = v; toasts.push(v); } });
    }
    return e;
  },
};
const sandbox = {
  window: win, document, CustomEvent, console: { log() {}, warn() {}, table() {} },
  location: { hostname: 'localhost', href: 'http://localhost:8080/tasks/1/jobs/1' },
  localStorage: { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
  performance: { now: () => Date.now() },
  setTimeout, clearTimeout,
  setInterval: (fn, ms) => { const h = setInterval(fn, ms); h.unref(); return h; },
};
sandbox.window.cuboidHelper = undefined;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'cvat3d-cuboid-helper.user.js'), 'utf8'), sandbox);

const lastToast = () => toasts[toasts.length - 1] || '';
const key = (code, opt = {}) => dispatch(body, makeEvent('keydown', { code, target: body, repeat: false, ...opt }));
const mouseTo = (x, y) => dispatch(el.perspective, makeEvent('mousemove', { clientX: x, clientY: y, target: el.perspective }));
const pointer = (type, x, y, opt = {}) => dispatch(el.perspective, makeEvent(type, { clientX: x, clientY: y, button: 0, target: el.perspective, ...opt }));
const bottomOf = (p) => p[2] - p[8] / 2;
const s1 = () => states.find((x) => x.clientID === 1).points;

(async () => {
  const helper = sandbox.window.cuboidHelper;
  ok('script nạp xong, có window.cuboidHelper', !!helper);
  const c = helper.check();
  ok('check(): thấy store, canvas 3D, cuboid, point cloud', c.store && c.canvas3d && c.activeCuboid === 1 && c.cloudPoints === pos.length / 3,
    JSON.stringify(c));

  // G ở view 3D lớn: fit cuboid xe
  mouseTo(640, 300);
  let ev = key('KeyG');
  ok('G ở view 3D: phím bị chặn (không tới CVAT)', ev.defaultPrevented);
  let p = s1();
  ok('G ở view 3D: xe được fit (L, W, H, đáy)', Math.abs(p[6] - carBox.L - 0.2) < 0.3 && Math.abs(p[7] - carBox.W - 0.2) < 0.3 &&
    Math.abs(bottomOf(p) - GROUND_Z) < 0.05, `L ${f2(p[6])} W ${f2(p[7])} H ${f2(p[8])} đáy ${f2(bottomOf(p))}`);

  // CVAT tự kéo cuboid lên cao 1 m và sang ngang: khoá mặt đất đặt đáy lại xuống đất
  cvatDrag(1, 0.5, 0.2, 1.0);
  p = s1();
  ok('CVAT kéo cuboid bay lên 1 m: đáy về sát đất', Math.abs(bottomOf(p) - GROUND_Z) < 0.05, `đáy ${f2(bottomOf(p))}`);

  // J: tắt khoá -> kéo lên giữ nguyên; bật lại
  key('KeyJ');
  ok('J: tắt khoá mặt đất', helper.check().groundLock === false, lastToast());
  cvatDrag(1, 0, 0, 0.7);
  p = s1();
  ok('khoá tắt: CVAT kéo lên 0.7 m thì giữ nguyên', Math.abs(bottomOf(p) - GROUND_Z - 0.7) < 0.05, `đáy ${f2(bottomOf(p))}`);
  key('KeyJ');
  ok('J lần nữa: bật lại khoá', helper.check().groundLock === true);
  cvatDrag(1, -0.5, -0.2, 0);
  p = s1();
  ok('khoá bật: lần kéo sau lại về sát đất', Math.abs(bottomOf(p) - GROUND_Z) < 0.05, `đáy ${f2(bottomOf(p))}`);

  // WASD ở view Side: W nới mặt trên 2 cm
  await sleep(600);
  let before = s1().slice();
  mouseTo(640, 750);
  key('KeyW');
  p = s1();
  ok('W ở view Side: H tăng 2 cm, đáy giữ nguyên', Math.abs(p[8] - before[8] - 0.02) < 1e-6 && Math.abs(bottomOf(p) - bottomOf(before)) < 1e-6,
    `H ${f2(before[8])} -> ${f2(p[8])}`);

  // G ở view Top: gom lại 2D
  await sleep(600);
  before = s1().slice();
  mouseTo(200, 750);
  key('KeyG');
  p = s1();
  ok('G ở view Top: gom lại, giữ H và góc xoay', /Gom lại \(top\)/.test(lastToast()) && Math.abs(p[5] - before[5]) < 1e-9 && Math.abs(p[8] - before[8]) < 1e-9,
    lastToast().split('\n')[0]);
  await sleep(600);
  key('KeyG', { shiftKey: true });
  ok('Shift+G ở view Top: chạy được', /Gom lại \(top\)/.test(lastToast()), lastToast().replace(/\n/g, ' | '));

  // Shift + kéo cuboid trong view 3D lớn: trượt 2 m theo x trên mặt đất
  await sleep(600);
  before = s1().slice();
  const z0 = bottomOf(before);
  const a = screenOf([before[0], before[1], before[2]]);
  // điểm đích: cùng độ cao đáy, dời 2 m theo x
  const hit0 = helper.rayPlaneZ(helper.unprojectRay(PV, [a[0] / W * 2 - 1, 1 - a[1] / Hp * 2]), z0);
  const b = screenOf([hit0[0] + 2, hit0[1], z0]);
  ev = pointer('pointerdown', a[0], a[1], { shiftKey: true });
  ok('Shift+bấm trúng cuboid: bắt đầu kéo, CVAT không nhận', ev.defaultPrevented && ev._immediate);
  pointer('pointermove', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { shiftKey: true });
  pointer('pointermove', b[0], b[1], { shiftKey: true });
  ok('khi kéo: mesh cuboid đi theo chuột', Math.abs(carMesh.position.x - 2) < 0.05, `mesh dx ${f2(carMesh.position.x)}`);
  pointer('pointerup', b[0], b[1], { shiftKey: true });
  ev = pointer('click', b[0], b[1], { shiftKey: true });
  p = s1();
  ok('thả chuột: cuboid dời 2 m theo x, đáy sát đất', Math.abs(p[0] - before[0] - 2) < 0.05 && Math.abs(p[1] - before[1]) < 0.05 &&
    Math.abs(bottomOf(p) - GROUND_Z) < 0.05, `dx ${f2(p[0] - before[0])} dy ${f2(p[1] - before[1])} đáy ${f2(bottomOf(p))}`);
  ok('click theo sau bị nuốt (không đổi chọn trong CVAT)', ev._immediate);
  // Shift+bấm chỗ trống: để CVAT xử lý
  ev = pointer('pointerdown', 20, 20, { shiftKey: true });
  ok('Shift+bấm ngoài cuboid: không chặn', !ev.defaultPrevented);
  pointer('pointerup', 20, 20, { shiftKey: true });

  // Ctrl+click vào người (ngoài cuboid đang chọn): tạo cuboid mới với nhãn đang chọn
  await sleep(600);
  const pp = screenOf([ped.x, ped.y, ped.z]);
  ev = pointer('pointerdown', pp[0], pp[1], { ctrlKey: true });
  ok('Ctrl+click: CVAT không nhận cú bấm', ev.defaultPrevented && ev._immediate);
  pointer('pointerup', pp[0], pp[1], { ctrlKey: true });
  ev = pointer('click', pp[0], pp[1], { ctrlKey: true });
  ok('Ctrl+click: click theo sau bị nuốt', ev._immediate);
  await sleep(50);
  const added = states.find((x) => x.clientID === 2);
  ok('Ctrl+click vào người: tạo cuboid mới', !!added, lastToast().split('\n')[0]);
  if (added) {
    const q = added.points;
    ok('cuboid mới ôm người, đáy sát đất', Math.hypot(q[0] - ped.x, q[1] - ped.y) < 0.3 && Math.abs(bottomOf(q) - GROUND_Z) < 0.05 &&
      q[8] > 1.6 && q[8] < 2.1, `tâm (${f2(q[0])}, ${f2(q[1])}) L ${f2(q[6])} W ${f2(q[7])} H ${f2(q[8])}`);
  }
  await sleep(900);
  ok('sau khi tạo: chọn luôn cuboid mới (ACTIVATE_OBJECT)', activated === 2, JSON.stringify(actions.filter((x) => x.type === 'ACTIVATE_OBJECT')));

  // Ctrl+click vào xe trong khi đang chọn người: tạo thêm cuboid (bấm ngoài cuboid đang chọn)
  // Chọn lại xe rồi Ctrl+click vào xe: fit lại cuboid xe, không tạo mới
  activated = 1;
  const nStates = states.length;
  const carNow = s1();
  const cp = screenOf([carNow[0], carNow[1], carNow[2] + 0.3]);
  pointer('pointerdown', cp[0], cp[1], { ctrlKey: true });
  pointer('pointerup', cp[0], cp[1], { ctrlKey: true });
  pointer('click', cp[0], cp[1], { ctrlKey: true });
  await sleep(50);
  ok('Ctrl+click trong cuboid đang chọn: fit lại, không tạo mới', states.length === nStates && /Fit lại/.test(lastToast()),
    lastToast().split('\n')[0]);

  // Cuboid dạng track: G chỉ dời chỗ, không đổi kích thước
  await sleep(600);
  const st1 = states.find((x) => x.clientID === 1);
  st1.objectType = 'track';
  st1.points = [carBox.x + 0.6, carBox.y - 0.4, carBox.z + 0.55, 0, 0, carBox.yaw, carBox.L + 0.2, carBox.W + 0.2, carBox.H + 0.1, 0, 0, 0, 0, 0, 0, 0];
  before = st1.points.slice();
  activated = 1;
  mouseTo(640, 300);
  key('KeyG');
  p = s1();
  ok('track + G: giữ nguyên L, W, H và góc', [5, 6, 7, 8].every((k) => Math.abs(p[k] - before[k]) < 1e-9), lastToast().split('\n')[0]);
  ok('track + G: dời về đúng xe, đáy sát đất', Math.hypot(p[0] - carBox.x, p[1] - carBox.y) < 0.1 && Math.abs(bottomOf(p) - GROUND_Z) < 0.05,
    `tâm lệch ${f2(Math.hypot(p[0] - carBox.x, p[1] - carBox.y))} m, đáy ${f2(bottomOf(p))}`);
  await sleep(600);
  before = s1().slice();
  mouseTo(200, 750);
  key('KeyG');
  p = s1();
  ok('track + G ở view Top: giữ nguyên kích thước', [6, 7, 8].every((k) => Math.abs(p[k] - before[k]) < 1e-9), lastToast().split('\n')[0]);
  st1.objectType = 'shape';

  // Track có 3 keyframe (frame 0, 5, 10), đang ở frame 5: đổi kích thước ở frame 5 thì frame 0 và 10 đổi theo
  await sleep(600);
  const tk = (x) => [x, 4, GROUND_Z + 0.8, 0, 0, 0, 4.5, 1.9, 1.6, 0, 0, 0, 0, 0, 0, 0];
  trackShapes[0] = tk(6); trackShapes[5] = tk(8); trackShapes[10] = tk(10);
  curFrame = 5;
  const tState = { ...trackStateAt(5) };
  states.push(tState);
  activated = 99;
  mouseTo(640, 750); // view Side
  key('KeyW');
  key('KeyW');
  ok('track: W ở frame 5 tăng H 4 cm', Math.abs(trackShapes[5][8] - 1.64) < 1e-6, `H frame 5 = ${trackShapes[5][8].toFixed(2)}`);
  ok('track: chưa áp ngay (chờ thôi bấm)', Math.abs(trackShapes[0][8] - 1.6) < 1e-9);
  await sleep(1100);
  ok('track: keyframe 0 và 10 nhận H mới, đáy giữ nguyên',
    [0, 10].every((f) => Math.abs(trackShapes[f][8] - 1.64) < 1e-6 && Math.abs(bottomOf(trackShapes[f]) - GROUND_Z) < 1e-6),
    `H: ${[0, 5, 10].map((f) => trackShapes[f][8].toFixed(2)).join(' / ')} · ${lastToast()}`);
  // CVAT tự đổi kích thước (kéo cạnh ở view Side): L dài thêm 0.3 m
  const L0 = trackShapes[0][6], x0 = trackShapes[0][0];
  const cur = states.find((x) => x.clientID === 99);
  const resized = cur.points.slice();
  resized[6] += 0.3;
  el.perspective.dispatchEvent(new CustomEvent('canvas.edited', { detail: { state: { ...cur, points: cur.points.slice() }, points: resized } }));
  await sleep(1100);
  ok('track: CVAT kéo cạnh L +0.3 m, keyframe khác cũng dài ra', [0, 10].every((f) => Math.abs(trackShapes[f][6] - L0 - 0.3) < 1e-6),
    `L: ${[0, 5, 10].map((f) => trackShapes[f][6].toFixed(2)).join(' / ')}`);
  ok('track: keyframe khác giữ mặt sau (phía LiDAR), dài về phía trước', Math.abs(trackShapes[0][0] - trackShapes[0][6] / 2 - (x0 - L0 / 2)) < 1e-6,
    `mặt sau frame 0: ${(x0 - L0 / 2).toFixed(2)} -> ${(trackShapes[0][0] - trackShapes[0][6] / 2).toFixed(2)}`);
  // Phím E (xoay 90°, đổi chỗ L/W): kích thước thật không đổi nên không áp cho keyframe khác
  const before0 = trackShapes[0].slice();
  mouseTo(200, 750); // view Top
  key('KeyE');
  await sleep(1100);
  ok('track: xoay 90° (E) không đổi kích thước keyframe khác', trackShapes[0].every((v, k) => Math.abs(v - before0[k]) < 1e-9),
    `frame 5: L ${trackShapes[5][6].toFixed(2)} W ${trackShapes[5][7].toFixed(2)} · frame 0: L ${trackShapes[0][6].toFixed(2)} W ${trackShapes[0][7].toFixed(2)}`);
  ok('E ở view Top: xoay +90°, đổi chỗ L/W', Math.abs(trackShapes[5][6] - 1.9) < 1e-6 && Math.abs(trackShapes[5][7] - 4.8) < 1e-6);
  states.pop();
  activated = 1;
  curFrame = 0;

  // Phím mũi tên: dời cuboid theo hướng phím trên màn hình (view Top: → = +x, ↑ = +y), không đổi kích thước
  await sleep(600);
  before = s1().slice();
  mouseTo(200, 750);
  ev = key('ArrowRight');
  await sleep(600);
  key('ArrowUp', { shiftKey: true });
  p = s1();
  ok('→ rồi Shift+↑ ở view Top: dời +5 cm x, +1 cm y', ev.defaultPrevented && Math.abs(p[0] - before[0] - 0.05) < 1e-6 &&
    Math.abs(p[1] - before[1] - 0.01) < 1e-6 && [5, 6, 7, 8].every((k) => Math.abs(p[k] - before[k]) < 1e-9), lastToast());
  await sleep(600);
  before = s1().slice();
  mouseTo(640, 750); // view Side
  key('ArrowUp');
  p = s1();
  ok('↑ ở view Side khi khoá đất bật: không bay lên', Math.abs(p[2] - before[2]) < 1e-9, lastToast());
  mouseTo(640, 300);
  ev = key('ArrowRight');
  ok('mũi tên khi chuột ngoài 3 view: không chặn (CVAT xử lý)', !ev.defaultPrevented);

  // Phím G khi không chọn gì: không chặn (để CVAT dùng G như thường)
  activated = null;
  mouseTo(640, 300);
  ev = key('KeyG');
  ok('G khi chưa chọn cuboid: không chặn phím', !ev.defaultPrevented);

  console.log(fails ? `\n${fails} test FAIL` : '\nTất cả test đạt');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });

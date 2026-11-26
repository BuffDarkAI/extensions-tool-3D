// Chạy: node test/fit.test.js
const core = require('../cvat3d-cuboid-helper.user.js');
const { GROUND_Z, scan, car, roughOf } = require('./sim.js');

let fails = 0;
// Các test đo độ sát nên tắt khoảng hở FIT_MARGIN; có test riêng cho khoảng hở
const BASE = { ...core.CFG, FIT_MARGIN: 0 };
const f = (v) => (v >= 0 ? ' ' : '') + v.toFixed(2);

function report(name, p, target, tol, head, notes) {
  const err = {
    center: Math.hypot(p[0] - target.x, p[1] - target.y),
    bottom: Math.abs(p[2] - p[8] / 2 - (target.z - target.H / 2)),
    top: target.z + target.H / 2 - (p[2] + p[8] / 2),
    L: p[6] - target.L, W: p[7] - target.W, H: p[8] - target.H,
    // Hộp đối xứng: so hướng theo modulo 180°
    yaw: (Math.abs(core.normAngle(2 * (p[5] - target.yaw))) / 2) * 180 / Math.PI,
  };
  const bad = Object.keys(tol).filter((k) => !(Math.abs(err[k]) <= tol[k]));
  if (bad.length) fails++;
  console.log(`${bad.length ? 'FAIL' : 'ok  '} ${name.padEnd(40)} ${head}  ` +
    `tâm ${f(err.center)}  đáy ${f(err.bottom)}  đỉnh-thiếu ${f(err.top)}  ` +
    `dL ${f(err.L)} dW ${f(err.W)} dH ${f(err.H)}  yaw ${err.yaw.toFixed(1)}°` +
    (bad.length ? `  <-- ${bad.join(',')}` : '') + (notes && notes.length ? `\n      ${notes.join('; ')}` : ''));
}

function checkValue(name, got, want, tol) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(40)} ${got.toFixed(3)} (cần ${want.toFixed(3)} ± ${tol})`);
}

function checkTrue(name, cond, detail = '') {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name.padEnd(40)} ${detail}`);
}

// --------------------------------------------------------- G: fitCuboid
console.log('--- G (view 3D lớn): gom cụm như bản đầu');
function check(name, boxes, target, rough, label, tol, cfg = BASE) {
  const pos = scan(boxes);
  const { points: p, info } = core.fitCuboid(pos, pos.length / 3, rough, label, cfg);
  report(name, p, target, tol, `n=${String(info.n).padStart(4)}`, info.notes);
}

const c1 = car(8, 4, -20);
check('xe 9 m, thấy 2 mặt', [c1], c1, roughOf(c1, 0.5, -0.3, 25), 'car',
  { center: 0.25, bottom: 0.08, L: 0.3, W: 0.3, H: 0.3, yaw: 3 });

const c2 = car(20, -6, 28);
check('xe 21 m, thấy 2 mặt', [c2], c2, roughOf(c2, 0.5, 0.5, 20), 'car',
  { center: 0.4, bottom: 0.1, L: 0.5, W: 0.5, H: 0.5, yaw: 5 });

const c3 = car(0, 9, 0); // xe ngang trước mặt cảm biến: chỉ thấy hông
const PRIOR_CFG = { ...BASE, USE_PRIOR: true };
check('xe chỉ thấy hông (dùng prior W)', [c3], c3, roughOf(c3, 0, 0.4), 'car',
  { center: 0.35, bottom: 0.08, L: 0.4, W: 0.4, H: 0.4, yaw: 3 }, PRIOR_CFG);
// Mặc định: hộp bao sát mặt hông nhìn thấy (tâm ở giữa mặt hông, y = 9 - 0.95), chiều dài theo hông
const c3face = { ...c3, y: 9 - 0.95, W: 0 };
check('xe chỉ thấy hông (mặc định: bao sát)', [c3], c3face, roughOf(c3, 0, 0.4), 'car',
  { center: 0.1, bottom: 0.08, L: 0.4, W: 0.15, H: 0.4, yaw: 3 });

const c4 = car(12, 0, 0); // xe đi cùng chiều phía trước: chỉ thấy đuôi
check('xe chỉ thấy đuôi (dùng prior L)', [c4], c4, roughOf(c4, -1.5, 0.2), 'car',
  { center: 0.5, bottom: 0.08, L: 0.4, W: 0.4, H: 0.4, yaw: 3 }, PRIOR_CFG);

const ped = car(6, -3, 40, 0.7, 0.6, 1.75);
const pole = { x: 6.0, y: -4.4, z: GROUND_Z + 2, yaw: 0, L: 0.25, W: 0.25, H: 4 };
check('người 7 m, cột cách 1.2 m', [ped, pole], ped, roughOf(ped, 0.1, 0.1), 'pedestrian',
  { center: 0.25, bottom: 0.08, H: 0.3 });

const ped2 = car(5, 2, 0, 0.7, 0.6, 1.75);
const bush = { x: 5.2, y: 2.6, z: GROUND_Z + 0.5, yaw: 0, L: 1.0, W: 0.6, H: 1.0 };
check('người dính bụi cây (dự kiến lỗi)', [ped2, bush], ped2, roughOf(ped2, 0, 0), 'pedestrian', {});

// Xe có kính cách 12 m: tia xuyên qua kính nên thân (cao 0.25..1.05 m) và nóc (1.44..1.56 m) chỉ nối
// với nhau qua 4 trụ mảnh ở góc
const body = { x: 12, y: -4, z: GROUND_Z + 0.65, yaw: 0, L: 4.5, W: 1.9, H: 0.8 };
const roof = { x: 11.8, y: -4, z: GROUND_Z + 1.5, yaw: 0, L: 2.4, W: 1.7, H: 0.12 };
const pillars = [];
for (const dx of [-1.14, 1.14]) for (const dy of [-0.79, 0.79]) {
  pillars.push({ x: 11.8 + dx, y: -4 + dy, z: GROUND_Z + 1.245, yaw: 0, L: 0.12, W: 0.12, H: 0.39 });
}
const glassScene = [body, roof, ...pillars];
const glassCar = { ...body, z: GROUND_Z + 0.78, H: 1.56 };
check('xe có kính (thân, trụ, nóc)', glassScene, glassCar, roughOf(body, 0.3, 0.3), 'car',
  { center: 0.25, bottom: 0.08, top: 0.1, L: 0.3, W: 0.3, yaw: 3 });

// Khoảng hở mặc định: mỗi mặt bên + mặt trên chừa 0.1 m, đáy trên mặt đất
const m = core.CFG.FIT_MARGIN;
check('khoảng hở FIT_MARGIN mỗi mặt', [c1], { ...c1, L: c1.L + 2 * m, W: c1.W + 2 * m, H: c1.H + m, z: c1.z + m / 2 },
  roughOf(c1, 0.5, -0.3, 25), 'car', { center: 0.25, bottom: 0.08, L: 0.3, W: 0.3, H: 0.3, yaw: 3 }, core.CFG);

// Xe đỗ sát hàng rào dài (cách 0.45 m): G gom như bản đầu nên dính hàng rào, dùng Ctrl+click (bên dưới)
const c5 = car(8, 4, 0);
const fence = { x: 8, y: 4 + 0.95 + 0.45 + 0.05, z: GROUND_Z + 0.6, yaw: 0, L: 20, W: 0.1, H: 1.2 };
check('xe sát hàng rào 0.45 m (G: dự kiến dính)', [c5, fence], c5, roughOf(c5, 0.3, -0.3), 'car', {});

// ------------------------------------------------- Ctrl+click: fitAtPoint
console.log('--- Ctrl+click: gom chặt từ điểm bấm');
// Điểm người dùng bấm trúng: điểm quét được trên vật, gần tâm vật nhất (theo xy)
function pointOn(pos, b) {
  const c = Math.cos(-b.yaw), s = Math.sin(-b.yaw);
  let best = null, bestD = Infinity;
  for (let i = 0; i < pos.length / 3; i++) {
    const dx = pos[3 * i] - b.x, dy = pos[3 * i + 1] - b.y, dz = pos[3 * i + 2] - b.z;
    const u = dx * c - dy * s, v = dx * s + dy * c;
    if (Math.abs(u) > b.L / 2 + 0.05 || Math.abs(v) > b.W / 2 + 0.05 || Math.abs(dz) > b.H / 2 + 0.05) continue;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]]; }
  }
  return best;
}
function checkPick(name, boxes, target, clickOn, rough, label, tol, cfg = BASE) {
  const pos = scan(boxes);
  const P = pointOn(pos, clickOn);
  const { points: p, info } = core.fitAtPoint(pos, pos.length / 3, P, rough, label, cfg);
  report(name, p, target, tol, `n=${String(info.n).padStart(4)}`, info.notes);
}

checkPick('xe sát hàng rào 0.45 m, tạo mới', [c5, fence], c5, c5, null, 'car',
  { center: 0.3, bottom: 0.08, L: 0.3, W: 0.3, H: 0.3, yaw: 3 });
checkPick('xe sát hàng rào 0.45 m, fit lại cuboid chọn', [c5, fence], c5, c5, roughOf(c5, 0.3, -0.3), 'car',
  { center: 0.3, bottom: 0.08, L: 0.3, W: 0.3, H: 0.3, yaw: 3 });
checkPick('người 7 m, cột cách 1.2 m', [ped, pole], ped, ped, null, 'pedestrian',
  { center: 0.25, bottom: 0.08, H: 0.3 });
const cone = { x: 7, y: 2, z: GROUND_Z + 0.35, yaw: 0, L: 0.4, W: 0.4, H: 0.7 };
const wall = { x: 7, y: 2 + 0.2 + 0.4 + 0.1, z: GROUND_Z + 1.25, yaw: 0, L: 6, W: 0.2, H: 2.5 };
checkPick('cọc tiêu cách tường 0.4 m', [cone, wall], cone, cone, null, 'traffic_cone',
  { center: 0.2, bottom: 0.08, L: 0.2, W: 0.2, H: 0.15 });
checkPick('xe có kính (thân, trụ, nóc)', glassScene, glassCar, body, null, 'car',
  { center: 0.25, bottom: 0.08, top: 0.1, L: 0.3, W: 0.3, yaw: 3 });

// ------------------------------------------------- mặt đất cục bộ
console.log('--- Mặt đất ngay quanh cuboid (khoá sát đất)');
{
  const pos = scan([c1]);
  const floating = [c1.x, c1.y, c1.z + 1.2, 0, 0, c1.yaw, c1.L, c1.W, c1.H];
  checkValue('đáy hộp lơ lửng 1.2 m về mặt đất', core.snapZ(pos, pos.length / 3, floating) - c1.H / 2, GROUND_Z, 0.02);
}
{
  // Lề đường: đường z = -1.84 (y < 5), vỉa hè cao hơn 15 cm (y >= 5)
  const planes = [
    { a: 0, b: 0, c: GROUND_Z, region: (x, y) => y < 5 },
    { a: 0, b: 0, c: GROUND_Z + 0.15, region: (x, y) => y >= 5 },
  ];
  const carRoad = car(10, 3.4, 0);
  const pedWalk = { x: 8, y: 6.6, z: GROUND_Z + 0.15 + 0.875, yaw: 0, L: 0.7, W: 0.6, H: 1.75 };
  const pos = scan([carRoad, pedWalk], 0.02, 7, planes);
  const n = pos.length / 3;
  const fp = (b) => ({ x: b.x, y: b.y, yaw: b.yaw, hl: b.L / 2, hw: b.W / 2 });
  checkValue('xe dưới đường, cạnh vỉa hè 15 cm', core.groundAt(pos, n, fp(carRoad)).z, GROUND_Z, 0.03);
  checkValue('người đứng trên vỉa hè 15 cm', core.groundAt(pos, n, fp(pedWalk)).z, GROUND_Z + 0.15, 0.03);
}
{
  // Dốc 5% theo x: tại x = 10 mặt đất cao hơn chỗ đặt LiDAR 0.5 m
  const pos = scan([], 0.02, 7, [{ a: 0.05, b: 0, c: GROUND_Z }]);
  const g = core.groundAt(pos, pos.length / 3, { x: 10, y: 3, yaw: 0, hl: 1, hw: 0.5 });
  checkValue('dốc 5%, mặt đất tại x = 10 m', g.z, GROUND_Z + 0.5, 0.03);
}

{
  // Đường phẳng rồi lên dốc 10% từ x = 6 m, xe đỗ trên dốc. Một mặt phẳng RANSAC không theo được dốc:
  // bản cũ gom cả mặt dốc vào cụm (334 điểm đất, L 9.1 m). Gom cụm không được tính điểm mặt đất.
  const planes = [
    { a: 0, b: 0, c: GROUND_Z, region: (x) => x < 6 },
    { a: 0.1, b: 0, c: GROUND_Z - 0.6, region: (x) => x >= 6 },
  ];
  const gAt = (x) => (x < 6 ? GROUND_Z : GROUND_Z + 0.1 * (x - 6));
  const carR = { ...car(10, 3, 0), z: gAt(10) + 0.8 };
  const pos = scan([carR], 0.02, 7, planes), n = pos.length / 3;
  const groundIn = (idx) => idx.filter((i) => pos[3 * i + 2] - gAt(pos[3 * i]) < 0.15).length;
  const r = core.fitCuboid(pos, n, roughOf(carR, 0.3, -0.3), 'car', BASE);
  const p = r.points;
  checkTrue('xe trên dốc 10%: G không gom điểm mặt đất', groundIn(r.info.idx) <= 5 && Math.abs(p[6] - carR.L) < 0.3 && Math.abs(p[7] - carR.W) < 0.3,
    `${groundIn(r.info.idx)}/${r.info.idx.length} điểm đất · L ${p[6].toFixed(2)} W ${p[7].toFixed(2)}`);
  checkValue('  ... đáy cuboid trên mặt dốc', p[2] - p[8] / 2, gAt(10), 0.03);
  const P = pointOn(pos, carR);
  const q = core.fitAtPoint(pos, n, P, null, 'car', BASE);
  // Đầu xe chạm dốc chỉ còn 5 điểm rời rạc: gom chặt cắt mất đoạn đó (L ngắn ~0.8 m), G thì bắt được
  checkTrue('xe trên dốc 10%: Ctrl+click không gom điểm đất', groundIn(q.info.idx) <= 5 && Math.abs(q.points[6] - carR.L) < 1.0,
    `${groundIn(q.info.idx)}/${q.info.idx.length} điểm đất · L ${q.points[6].toFixed(2)} W ${q.points[7].toFixed(2)}`);
  const fly = [carR.x, carR.y, carR.z + 0.9, 0, 0, 0, carR.L, carR.W, carR.H];
  checkValue('  ... khoá đất: đáy về mặt dốc', core.snapZ(pos, n, fly) - carR.H / 2, gAt(10), 0.03);
}

// ------------------------------------------------- G trên view Top/Side/Front
console.log('--- G trên view Top/Side/Front: gom lại theo 2D');
function checkRefine(name, boxes, target, start, axes, tol, opts = {}) {
  const pos = scan(boxes);
  const { points: p, info } = core.refine2D(pos, pos.length / 3, start, axes, BASE, [0, 0, 0], opts);
  report(name, p, target, tol, `giữ ${info.n}/${info.total}`, info.notes);
}
// Cuboid đang quá to + có cột cách hông xe 0.5 m nằm trong vùng xét
const c6 = car(9, 3, 0);
const post = { x: 9, y: 3 - 0.95 - 0.5 - 0.1, z: GROUND_Z + 0.75, yaw: 0, L: 0.2, W: 0.2, H: 1.5 };
// Phần đầu xe (x > 11.0) bị nhìn chéo nên không có điểm: phần nhìn thấy dài 4.28 m, tâm x = 8.87
// (fit 3D cũng ra đúng như vậy). Cột phải bị bỏ ở view Top: W không được phình ra.
const seen6 = { ...c6, L: 4.28, x: 8.87 };
const big = [c6.x + 0.3, c6.y - 0.3, c6.z + 0.2, 0, 0, 0, c6.L + 0.8, c6.W + 0.8, c6.H + 0.6, 0, 0, 0, 0, 0, 0, 0];
checkRefine('view Top (bỏ cột)', [c6, post], { ...seen6, H: big[8], z: big[2] }, big, [0, 1],
  { center: 0.1, L: 0.1, W: 0.1, H: 1e-6 });
checkRefine('view Side (L, H)', [c6, post], { ...seen6, W: big[7], y: c6.y - 0.3 }, big, [0, 2],
  { center: 0.1, bottom: 0.08, L: 0.1, W: 1e-6, H: 0.25 });
// Shift+G ở view Top: cuboid lệch 8° được xoay lại theo cụm điểm
const skew = [c6.x + 0.2, c6.y - 0.2, c6.z, 0, 0, (8 * Math.PI) / 180, c6.L + 1.2, c6.W + 1.2, c6.H, 0, 0, 0, 0, 0, 0, 0];
checkRefine('Shift+G view Top: tìm lại góc 8° -> 0°', [c6, post], { ...seen6, H: c6.H }, skew, [0, 1],
  { center: 0.1, L: 0.1, W: 0.1, yaw: 1 }, { refineYaw: true });
// View Top + khoá sát đất: cuboid lơ lửng 0.5 m được đặt lại xuống đất
const fly = big.slice();
fly[2] += 0.5;
checkRefine('view Top + khoá đất (lơ lửng 0.5 m)', [c6, post], { ...seen6, H: big[8], z: GROUND_Z + big[8] / 2 }, fly, [0, 1],
  { center: 0.1, bottom: 0.03, L: 0.1, W: 0.1 }, { snapGround: true });
// View Side, xe có kính: nóc không bị cắt mất
const glassStart = [body.x, body.y, glassCar.z, 0, 0, 0, body.L + 0.4, body.W + 0.4, glassCar.H + 0.4, 0, 0, 0, 0, 0, 0, 0];
checkRefine('view Side, xe có kính (giữ nóc)', glassScene, { ...glassCar, W: glassStart[7] }, glassStart, [0, 2],
  { bottom: 0.05, top: 0.1 });

// ------------------------------------------------- track: giữ kích thước, chỉ dời
console.log('--- Track: giữ kích thước, chỉ dời tới chỗ nhiều điểm nhất');
// Cuboid track đúng kích thước (đã có khoảng hở) nhưng lệch chỗ và lơ lửng, như khi sang frame mới
const trackBox = (b, dx, dy, dz = 0.6, dyawDeg = 0) => [b.x + dx, b.y + dy, b.z + m / 2 + dz, 0, 0, b.yaw + (dyawDeg * Math.PI) / 180,
  b.L + 2 * m, b.W + 2 * m, b.H + m, 0, 0, 0, 0, 0, 0, 0];
function checkTrack(name, start, res, truth, tol) {
  const p = res.points;
  const err = {
    center: Math.hypot(p[0] - truth.x, p[1] - truth.y),
    bottom: Math.abs(p[2] - p[8] / 2 - (truth.z - truth.H / 2)),
    size: Math.max(...[6, 7, 8].map((k) => Math.abs(p[k] - start[k]))),
    yaw: (Math.abs(core.normAngle(2 * (p[5] - truth.yaw))) / 2) * 180 / Math.PI,
  };
  const bad = Object.keys(tol).filter((k) => !(Math.abs(err[k]) <= tol[k]));
  if (bad.length) fails++;
  console.log(`${bad.length ? 'FAIL' : 'ok  '} ${name.padEnd(40)} dời ${f(Math.hypot(p[0] - start[0], p[1] - start[1]))} m  ` +
    `tâm lệch ${f(err.center)}  đáy ${f(err.bottom)}  đổi kích thước ${err.size.toFixed(3)}  yaw ${err.yaw.toFixed(1)}°` +
    (bad.length ? `  <-- ${bad.join(',')}` : '') + (res.info.notes.length ? `\n      ${res.info.notes.join('; ')}` : ''));
}
const TRACK = { keepSize: true };
{
  const pos = scan([c1]), n = pos.length / 3, st = trackBox(c1, 0.8, -0.5);
  checkTrack('G track: xe thấy 2 mặt, lệch 0.94 m', st, core.fitCuboid(pos, n, st, 'car', core.CFG, [0, 0, 0], TRACK), c1,
    { center: 0.1, bottom: 0.03, size: 1e-9, yaw: 1e-6 });
}
{
  const pos = scan([c4]), n = pos.length / 3, st = trackBox(c4, 1.0, 0.3);
  checkTrack('G track: chỉ thấy đuôi xe, lệch 1.04 m', st, core.fitCuboid(pos, n, st, 'car', core.CFG, [0, 0, 0], TRACK), c4,
    { center: 0.15, bottom: 0.03, size: 1e-9 });
}
{
  const pos = scan([c5, fence]), n = pos.length / 3, st = trackBox(c5, -0.4, 0.3);
  checkTrack('G track: xe sát hàng rào (cụm dính rào)', st, core.fitCuboid(pos, n, st, 'car', core.CFG, [0, 0, 0], TRACK), c5,
    { center: 0.15, bottom: 0.03, size: 1e-9 });
  const P = pointOn(pos, c5);
  checkTrack('Ctrl+click track: xe sát hàng rào', st, core.fitAtPoint(pos, n, P, st, 'car', core.CFG, [0, 0, 0], TRACK), c5,
    { center: 0.15, bottom: 0.03, size: 1e-9 });
}
{
  // Xe có kính không có trụ: thân và nóc là 2 cụm rời, phải ghép lại (cụm ghép vẫn vừa cuboid)
  const pos = scan([body, roof]), n = pos.length / 3, st = trackBox(glassCar, 0.5, 0.3);
  const r = core.fitCuboid(pos, n, st, 'car', core.CFG, [0, 0, 0], TRACK);
  checkTrack('G track: thân và nóc xe rời nhau', st, r, glassCar, { center: 0.1, bottom: 0.03, size: 1e-9 });
  const roofIn = r.info.idx.filter((i) => pos[3 * i + 2] > GROUND_Z + 1.4).length;
  checkTrue('  ... cụm có cả điểm trên nóc', roofIn > 0, `${roofIn} điểm nóc`);
}
{
  // 2 xe đỗ nối đuôi cách 0.8 m: không được ghép xe sau vào
  const c7 = car(10, -5, 0), c8 = car(10 + 4.5 + 0.8, -5, 0);
  const pos = scan([c7, c8]), n = pos.length / 3, st = trackBox(c7, 0.5, 0.2);
  checkTrack('G track: 2 xe nối đuôi cách 0.8 m', st, core.fitCuboid(pos, n, st, 'car', core.CFG, [0, 0, 0], TRACK), c7,
    { center: 0.1, bottom: 0.03, size: 1e-9 });
}
{
  const pos = scan([c6, post]), n = pos.length / 3, st = trackBox(c6, 0.4, -0.3, 0);
  // Đầu xe không có điểm nhưng mặt đuôi nhìn thấy nên đặt được đúng tâm thật (9, 3)
  checkTrack('G view Top track: lệch 0.5 m, có cột', st, core.refine2D(pos, n, st, [0, 1], core.CFG, [0, 0, 0], TRACK), c6,
    { center: 0.1, size: 1e-9 });
  const r = core.refine2D(pos, n, st, [0, 2], core.CFG, [0, 0, 0], TRACK);
  checkTrack('G view Side track: chỉ dời theo L, đáy sát đất', st, r, { ...c6, y: st[1] }, { center: 0.1, bottom: 0.03, size: 1e-9 });
  const sk = trackBox(c6, 0.3, -0.2, 0, 8);
  checkTrack('Shift+G view Top track: xoay lại 8°', sk, core.refine2D(pos, n, sk, [0, 1], core.CFG, [0, 0, 0], { ...TRACK, refineYaw: true }), c6,
    { center: 0.1, size: 1e-9, yaw: 1 });
}

// ------------------------------------------------- track: đổi kích thước 1 keyframe -> các keyframe khác
console.log('--- Track: áp kích thước mới cho keyframe khác (giữ mặt phía LiDAR)');
{
  // Xe ở x = 10 phía trước LiDAR: L 4 -> 4.6 thì mặt sau (x = 8, phía LiDAR) giữ nguyên, đầu xe dài ra
  const p = [10, 0, -1.04, 0, 0, 0, 4, 1.8, 1.6];
  const q = core.resizeKeepVisible(p, [4.6, 2.0, 1.7]);
  checkTrue('L dài ra: mặt phía LiDAR giữ nguyên', Math.abs(q[0] - q[6] / 2 - 8) < 1e-9, `mặt sau x = ${(q[0] - q[6] / 2).toFixed(3)}`);
  checkTrue('W: LiDAR nằm giữa 2 mặt bên thì nới đều', Math.abs(q[7] - 2.0) < 1e-9 && Math.abs(q[1]) < 1e-9);
  checkTrue('H: đáy giữ nguyên', Math.abs(q[2] - q[8] / 2 - (p[2] - p[8] / 2)) < 1e-9 && q[8] === 1.7);
  // Xe quay 30° ở phía trước bên trái: theo W, mặt gần LiDAR giữ nguyên
  const r = [8, 6, -1.04, 0, 0, Math.PI / 6, 4.5, 1.8, 1.6];
  const t = core.resizeKeepVisible(r, [4.5, 2.2, 1.6]);
  const e2 = [-Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)];
  const nearFace = (b) => b[0] * e2[0] + b[1] * e2[1] - b[7] / 2;
  checkTrue('xe xoay 30°: mặt bên gần LiDAR giữ nguyên', Math.abs(nearFace(t) - nearFace(r)) < 1e-9, `${nearFace(r).toFixed(3)} -> ${nearFace(t).toFixed(3)}`);
}

// ------------------------------------------------- camera (Ctrl+click, Shift+kéo)
console.log('--- Camera: chọn điểm dưới con trỏ, tia chuột');
function lookAt(eye, target, up = [0, 0, 1]) {
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
{
  const pos = scan([ped, pole]);
  const PV = core.mul4(perspective(Math.PI / 4, 1.6, 0.1, 300), lookAt([-4, -9, 3], [ped.x, ped.y, ped.z]));
  const I = core.mul4(core.inv4(PV), PV);
  checkTrue('inv4(PV) * PV = I', I.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-9));
  const c = [ped.x, ped.y, ped.z, 1];
  const q = [0, 1, 2, 3].map((r) => PV[r] * c[0] + PV[4 + r] * c[1] + PV[8 + r] * c[2] + PV[12 + r] * c[3]);
  const ndc = [q[0] / q[3], q[1] / q[3]];
  const i = core.pickPoint(pos, pos.length / 3, PV, ndc, [1280, 800], 12);
  const P = [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
  const inPed = i >= 0 && Math.hypot(P[0] - ped.x, P[1] - ped.y) < 0.6 && Math.abs(P[2] - ped.z) < ped.H / 2 + 0.05;
  checkTrue('bấm giữa người: chọn trúng điểm trên người', inPed, i >= 0 ? `(${P.map((v) => v.toFixed(2)).join(', ')})` : 'không có điểm');
  const ray = core.unprojectRay(PV, ndc);
  const v = [ped.x - ray.o[0], ped.y - ray.o[1], ped.z - ray.o[2]];
  const t = v[0] * ray.d[0] + v[1] * ray.d[1] + v[2] * ray.d[2];
  const miss = Math.hypot(v[0] - t * ray.d[0], v[1] - t * ray.d[1], v[2] - t * ray.d[2]);
  checkTrue('tia qua con trỏ đi qua tâm người', miss < 1e-6, `lệch ${miss.toExponential(1)} m`);
  const pedBox = [ped.x, ped.y, ped.z, 0, 0, ped.yaw, ped.L, ped.W, ped.H];
  checkTrue('tia cắt cuboid của người', core.rayBoxHit(ray, pedBox) < Infinity);
  const away = { o: ray.o, d: ray.d.map((x) => -x) };
  checkTrue('tia ngược lại không cắt', core.rayBoxHit(away, pedBox) === Infinity);
  const g = core.rayPlaneZ(ray, GROUND_Z);
  checkTrue('tia cắt mặt đất phía sau người', !!g && Math.hypot(g[0] - ped.x, g[1] - ped.y) < 10);
}

console.log(fails ? `\n${fails} test FAIL` : '\nTất cả test đạt');
process.exitCode = fails ? 1 : 0;

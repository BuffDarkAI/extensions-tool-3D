// Chạy: node test/fit.test.js
const core = require('../cvat3d-cuboid-helper.user.js');
const { GROUND_Z, scan, car, roughOf } = require('./sim.js');

let fails = 0;
function check(name, boxes, target, rough, label, tol, cfg = core.CFG) {
  const pos = scan(boxes);
  const { points: p, info } = core.fitCuboid(pos, pos.length / 3, rough, label, cfg);
  const yawErr = Math.abs(core.normAngle(p[5] - target.yaw)) * 180 / Math.PI;
  const err = {
    center: Math.hypot(p[0] - target.x, p[1] - target.y),
    bottom: Math.abs(p[2] - p[8] / 2 - (target.z - target.H / 2)),
    top: target.z + target.H / 2 - (p[2] + p[8] / 2),
    L: p[6] - target.L, W: p[7] - target.W, H: p[8] - target.H, yaw: yawErr,
  };
  const bad = Object.keys(tol).filter((k) => Math.abs(err[k]) > tol[k]);
  if (bad.length) fails++;
  const f = (v) => (v >= 0 ? ' ' : '') + v.toFixed(2);
  console.log(`${bad.length ? 'FAIL' : 'ok  '} ${name.padEnd(34)} n=${String(info.n).padStart(4)}  ` +
    `tâm ${f(err.center)}  đáy ${f(err.bottom)}  đỉnh-thiếu ${f(err.top)}  ` +
    `dL ${f(err.L)} dW ${f(err.W)} dH ${f(err.H)}  yaw ${err.yaw.toFixed(1)}°` +
    (bad.length ? `  <-- ${bad.join(',')}` : '') + (info.notes.length ? `\n      ${info.notes.join('; ')}` : ''));
}

const c1 = car(8, 4, -20);
check('xe 9 m, thấy 2 mặt', [c1], c1, roughOf(c1, 0.5, -0.3, 25), 'car',
  { center: 0.25, bottom: 0.08, L: 0.3, W: 0.3, H: 0.3, yaw: 3 });

const c2 = car(20, -6, 28);
check('xe 21 m, thấy 2 mặt', [c2], c2, roughOf(c2, 0.5, 0.5, 20), 'car',
  { center: 0.4, bottom: 0.1, L: 0.5, W: 0.5, H: 0.5, yaw: 5 });

const c3 = car(0, 9, 0); // xe ngang trước mặt cảm biến: chỉ thấy hông
const PRIOR_CFG = { ...core.CFG, USE_PRIOR: true };
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

console.log(fails ? `\n${fails} test FAIL` : '\nTất cả test đạt');
process.exitCode = fails ? 1 : 0;

// Giả lập LiDAR cho test
// LiDAR 32 tia (bước dọc 1.33°, -30°..+10°) bắn vào cảnh có mặt đất + hộp, rồi fit.

const SENSOR_H = 1.84; // LiDAR đặt cao 1.84 m, mặt đất z = -1.84
const GROUND_Z = -SENSOR_H;

// Giao tia với hộp xoay quanh z (slab method trong hệ local)
function rayBox(o, d, box) {
  const c = Math.cos(-box.yaw), s = Math.sin(-box.yaw);
  const ox = (o[0] - box.x) * c - (o[1] - box.y) * s, oy = (o[0] - box.x) * s + (o[1] - box.y) * c, oz = o[2] - box.z;
  const dx = d[0] * c - d[1] * s, dy = d[0] * s + d[1] * c, dz = d[2];
  let t0 = -Infinity, t1 = Infinity;
  for (const [oo, dd, h] of [[ox, dx, box.L / 2], [oy, dy, box.W / 2], [oz, dz, box.H / 2]]) {
    if (Math.abs(dd) < 1e-12) { if (Math.abs(oo) > h) return Infinity; continue; }
    let a = (-h - oo) / dd, b = (h - oo) / dd;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  return t0 <= t1 && t0 > 0 ? t0 : Infinity;
}

function scan(boxes, noise = 0.02, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 2 * noise;
  const pts = [];
  for (let r = 0; r < 32; r++) {
    const el = ((-30.67 + r * 1.33) * Math.PI) / 180;
    for (let az = 0; az < 360; az += 0.33) {
      const a = (az * Math.PI) / 180;
      const d = [Math.cos(el) * Math.cos(a), Math.cos(el) * Math.sin(a), Math.sin(el)];
      let t = d[2] < 0 ? -SENSOR_H / d[2] : Infinity;
      for (const b of boxes) t = Math.min(t, rayBox([0, 0, 0], d, b));
      if (!isFinite(t) || t > 70) continue;
      pts.push(d[0] * t + rnd(), d[1] * t + rnd(), d[2] * t + rnd());
    }
  }
  return new Float32Array(pts);
}

const car = (x, y, yawDeg, L = 4.5, W = 1.9, H = 1.6) =>
  ({ x, y, z: GROUND_Z + H / 2, yaw: (yawDeg * Math.PI) / 180, L, W, H });

// Cuboid thô như người dùng đặt bằng 1 click: lệch tâm, yaw lệch, kích thước mặc định 1x1x1
const roughOf = (b, dx = 0.4, dy = -0.3, yawErrDeg = 0) =>
  [b.x + dx, b.y + dy, GROUND_Z + 0.8, 0, 0, b.yaw + (yawErrDeg * Math.PI) / 180, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];

module.exports = { SENSOR_H, GROUND_Z, rayBox, scan, car, roughOf };

// ==UserScript==
// @name         CVAT 3D Cuboid Helper (auto-fit + WASD)
// @namespace    tool_3d
// @version      0.1.6
// @description  Tự fit cuboid theo cụm điểm (phím G) và nới/thu từng mặt cuboid bằng WASD trong các view Top/Side/Front của CVAT 3D.
// @match        *://*/*
// @grant        none
// @sandbox      raw
// @run-at       document-idle
// ==/UserScript==
//
// THÊM ĐỊA CHỈ CVAT CỦA KHÓA HỌC vào một dòng @match ở trên, ví dụ:
//   // @match        *://cvat.ten-truong.edu.vn/*
//
// Phím (chỉ có tác dụng khi đang chọn một cuboid trong job 3D):
//   G            : fit lại cuboid đang chọn theo cụm điểm xung quanh nó
//   W / D        : (chuột trên view Top/Side/Front) nới mặt trên / mặt phải ra ngoài
//   S / A        : thu mặt dưới / mặt trái vào trong (mặt dịch lên / sang phải)
//   Shift+WASD   : đảo lại (Shift+W/D thu mặt trên/phải, Shift+S/A nới mặt dưới/trái)
//   Q/E          : (chỉ ở view Top) xoay yaw -/+ 1°, Shift: 0.2°
//   ] / [        : điểm to hơn / nhỏ hơn
//   B            : đổi độ sáng điểm (0 = gốc, 1, 2, 3)

(function () {
function main() {
  'use strict';

  // ---------------------------------------------------------------- config
  const CFG = {
    STEP: 0.02,            // m mỗi lần bấm WASD
    ROT_STEP_DEG: 1,       // độ mỗi lần bấm Q/E
    ROT_STEP_FINE_DEG: 0.2,
    FIT_KEY: 'KeyG',

    GROUND_RADIUS: 12,     // m, vùng lấy điểm để ước lượng mặt đất
    GROUND_THRESH: 0.15,   // m, ngưỡng inlier RANSAC
    GROUND_CLEAR: 0.20,    // m, điểm thấp hơn mức này so với đất bị coi là đất
    RANSAC_ITERS: 300,

    ROI_RADIUS: 8,         // m, chỉ xét điểm trong bán kính này quanh cuboid thô
    SEED_PAD: 0.3,         // m, nới cuboid thô khi lấy điểm hạt giống
    SEED_SEARCH: 2.0,      // m, nếu cuboid thô không chứa điểm nào: lấy điểm gần nhất trong bán kính này
    EPS_MIN: 0.35,         // m, khoảng cách gom điểm (tăng theo khoảng cách tới LiDAR)
    EPS_MAX: 0.9,
    EPS_PER_M: 0.015,
    Z_WEIGHT: 0.6,         // giảm trọng số trục z khi gom (khoảng hở giữa các tia theo chiều dọc lớn)
    MAX_L: 10, MAX_H: 5,   // giới hạn kích thước cụm

    MIN_POINTS_FIT: 12,    // ít hơn: không tự tìm hướng, dùng yaw của cuboid thô
    PRIOR_TRIGGER: 0.75,   // cạnh đo được < 75% kích thước mặc định -> dùng kích thước mặc định
    THIN_FACE: 0.5,        // m, cụm mỏng hơn mức này = chỉ thấy 1 mặt
    MIN_SIZE: 0.1,
    // false: tâm = tâm khung bao sát cụm điểm, chiều dài L theo cạnh dài nhất của cụm.
    // true : nới cạnh khuất theo kích thước mặc định của class (bảng PRIORS) khi chỉ thấy 1 mặt.
    USE_PRIOR: false,
  };

  // Kích thước mặc định theo class: [regex tên nhãn, L, W, H] (m). Thứ tự quan trọng: cụ thể trước.
  const PRIORS = [
    [/bus/i, 11.0, 2.9, 3.5],
    [/truck|trailer|construction/i, 7.0, 2.5, 2.9],
    [/motor/i, 2.1, 0.8, 1.5],
    [/bicycle|bike|cycl/i, 1.8, 0.6, 1.3],
    [/ped|person|human|người/i, 0.75, 0.7, 1.75],
    [/barrier/i, 2.5, 0.5, 1.0],
    [/cone/i, 0.4, 0.4, 0.75],
    [/car|vehicle|^xe/i, 4.6, 1.95, 1.7],
  ];

  // ------------------------------------------------------------- geometry
  // Ma trận quay theo Euler 'XYZ' của three.js: R = Rx * Ry * Rz. Cột k = trục local k trong world.
  function rotMat(rx, ry, rz) {
    const a = Math.cos(rx), b = Math.sin(rx), c = Math.cos(ry), d = Math.sin(ry);
    const e = Math.cos(rz), f = Math.sin(rz);
    const ae = a * e, af = a * f, be = b * e, bf = b * f;
    return [
      [c * e, -c * f, d],
      [af + be * d, ae - bf * d, -b * c],
      [bf - ae * d, be + af * d, a * c],
    ];
  }
  const col = (R, k) => [R[0][k], R[1][k], R[2][k]];

  function normAngle(t) {
    while (t > Math.PI) t -= 2 * Math.PI;
    while (t <= -Math.PI) t += 2 * Math.PI;
    return t;
  }

  function makeRng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function findPrior(labelName) {
    if (!labelName) return null;
    for (const [re, L, W, H] of PRIORS) if (re.test(labelName)) return { L, W, H };
    return null;
  }

  // Mặt đất cục bộ z = a*x + b*y + c bằng RANSAC (chỉ chấp nhận mặt gần nằm ngang) + bình phương tối thiểu.
  function fitGround(pos, roi, cfg) {
    const zs = roi.map((i) => pos[3 * i + 2]).sort((p, q) => p - q);
    const fallback = { a: 0, b: 0, c: zs[Math.floor(zs.length * 0.05)] || 0, ok: false };
    const zcut = zs[Math.floor(zs.length * 0.3)] + 0.6;
    const low = roi.filter((i) => pos[3 * i + 2] <= zcut);
    if (low.length < 10) return fallback;

    const rng = makeRng(12345);
    const stride = Math.max(1, Math.floor(low.length / 3000));
    let best = null, bestCnt = -1;
    for (let it = 0; it < cfg.RANSAC_ITERS; it++) {
      const i1 = low[(rng() * low.length) | 0], i2 = low[(rng() * low.length) | 0], i3 = low[(rng() * low.length) | 0];
      const p1 = [pos[3 * i1], pos[3 * i1 + 1], pos[3 * i1 + 2]];
      const v1 = [pos[3 * i2] - p1[0], pos[3 * i2 + 1] - p1[1], pos[3 * i2 + 2] - p1[2]];
      const v2 = [pos[3 * i3] - p1[0], pos[3 * i3 + 1] - p1[1], pos[3 * i3 + 2] - p1[2]];
      let n = [v1[1] * v2[2] - v1[2] * v2[1], v1[2] * v2[0] - v1[0] * v2[2], v1[0] * v2[1] - v1[1] * v2[0]];
      const len = Math.hypot(n[0], n[1], n[2]);
      if (len < 1e-6) continue;
      n = n.map((v) => v / len);
      if (Math.abs(n[2]) < 0.95) continue;
      const d = -(n[0] * p1[0] + n[1] * p1[1] + n[2] * p1[2]);
      let cnt = 0;
      for (let k = 0; k < low.length; k += stride) {
        const i = low[k];
        if (Math.abs(n[0] * pos[3 * i] + n[1] * pos[3 * i + 1] + n[2] * pos[3 * i + 2] + d) < cfg.GROUND_THRESH) cnt++;
      }
      if (cnt > bestCnt) { bestCnt = cnt; best = { n, d }; }
    }
    if (!best) return fallback;

    // Bình phương tối thiểu z = a x + b y + c trên các inlier
    let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, sn = 0, sxz = 0, syz = 0, sz = 0;
    for (const i of low) {
      const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
      if (Math.abs(best.n[0] * x + best.n[1] * y + best.n[2] * z + best.d) >= cfg.GROUND_THRESH) continue;
      sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y; sn++;
      sxz += x * z; syz += y * z; sz += z;
    }
    if (sn < 10) return fallback;
    const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, sn]];
    const B = [sxz, syz, sz];
    const det3 = (M) =>
      M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
      M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
      M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const D = det3(A);
    if (Math.abs(D) < 1e-9) {
      return { a: -best.n[0] / best.n[2], b: -best.n[1] / best.n[2], c: -best.d / best.n[2], ok: true, inliers: sn };
    }
    const sub = (k) => A.map((row, r) => row.map((v, c) => (c === k ? B[r] : v)));
    return { a: det3(sub(0)) / D, b: det3(sub(1)) / D, c: det3(sub(2)) / D, ok: true, inliers: sn };
  }

  // Gom cụm bắt đầu từ các điểm hạt giống, dùng lưới băm kích thước eps.
  function growCluster(pos, cand, seeds, eps, cfg) {
    const zw = cfg.Z_WEIGHT, inv = 1 / eps, eps2 = eps * eps;
    const cell = (i) => [Math.floor(pos[3 * i] * inv), Math.floor(pos[3 * i + 1] * inv), Math.floor(pos[3 * i + 2] * zw * inv)];
    const grid = new Map();
    for (const i of cand) {
      const [a, b, c] = cell(i);
      const k = a + ',' + b + ',' + c;
      let arr = grid.get(k);
      if (!arr) grid.set(k, (arr = []));
      arr.push(i);
    }
    const visited = new Set(seeds);
    const out = seeds.slice();
    const queue = seeds.slice();
    const ext = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
    const addExt = (i) => {
      ext[0] = Math.min(ext[0], pos[3 * i]); ext[1] = Math.max(ext[1], pos[3 * i]);
      ext[2] = Math.min(ext[2], pos[3 * i + 1]); ext[3] = Math.max(ext[3], pos[3 * i + 1]);
      ext[4] = Math.min(ext[4], pos[3 * i + 2]); ext[5] = Math.max(ext[5], pos[3 * i + 2]);
    };
    seeds.forEach(addExt);
    let truncated = false;
    while (queue.length) {
      const i = queue.pop();
      const [a, b, c] = cell(i);
      const xi = pos[3 * i], yi = pos[3 * i + 1], zi = pos[3 * i + 2];
      for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) for (let dc = -1; dc <= 1; dc++) {
        const arr = grid.get(a + da + ',' + (b + db) + ',' + (c + dc));
        if (!arr) continue;
        for (const j of arr) {
          if (visited.has(j)) continue;
          const dx = pos[3 * j] - xi, dy = pos[3 * j + 1] - yi, dz = (pos[3 * j + 2] - zi) * zw;
          if (dx * dx + dy * dy + dz * dz > eps2) continue;
          const x = pos[3 * j], y = pos[3 * j + 1], z = pos[3 * j + 2];
          if (Math.max(ext[1], x) - Math.min(ext[0], x) > cfg.MAX_L ||
              Math.max(ext[3], y) - Math.min(ext[2], y) > cfg.MAX_L ||
              Math.max(ext[5], z) - Math.min(ext[4], z) > cfg.MAX_H) { truncated = true; continue; }
          visited.add(j);
          addExt(j);
          out.push(j);
          queue.push(j);
        }
      }
    }
    return { idx: out, truncated };
  }

  // Tìm hướng hình chữ nhật nhìn từ trên bằng tiêu chí "closeness" (Zhang et al. 2017, L-shape fitting).
  function lshapeTheta(xs, ys) {
    const n = xs.length, d0 = 0.01;
    const c1 = new Float64Array(n), c2 = new Float64Array(n);
    const score = (t) => {
      const c = Math.cos(t), s = Math.sin(t);
      let mn1 = Infinity, mx1 = -Infinity, mn2 = Infinity, mx2 = -Infinity;
      for (let i = 0; i < n; i++) {
        c1[i] = xs[i] * c + ys[i] * s; c2[i] = -xs[i] * s + ys[i] * c;
        if (c1[i] < mn1) mn1 = c1[i]; if (c1[i] > mx1) mx1 = c1[i];
        if (c2[i] < mn2) mn2 = c2[i]; if (c2[i] > mx2) mx2 = c2[i];
      }
      let beta = 0;
      for (let i = 0; i < n; i++) {
        const d1 = Math.min(mx1 - c1[i], c1[i] - mn1), d2 = Math.min(mx2 - c2[i], c2[i] - mn2);
        beta += 1 / Math.max(Math.min(d1, d2), d0);
      }
      return beta;
    };
    let best = 0, bestS = -Infinity;
    for (let deg = 0; deg < 90; deg += 1) {
      const sc = score((deg * Math.PI) / 180);
      if (sc > bestS) { bestS = sc; best = deg; }
    }
    let fine = best;
    for (let deg = best - 1; deg <= best + 1; deg += 0.1) {
      const sc = score((deg * Math.PI) / 180);
      if (sc > bestS) { bestS = sc; fine = deg; }
    }
    return (fine * Math.PI) / 180;
  }

  // Nới [lo,hi] lên độ dài target, giữ mặt nhìn thấy (phía LiDAR), kéo mặt khuất ra xa.
  function extendAway(lo, hi, s, target) {
    if (hi - lo >= target) return [lo, hi];
    if (s <= lo) return [lo, lo + target];
    if (s >= hi) return [hi - target, hi];
    const m = (lo + hi) / 2;
    return [m - target / 2, m + target / 2];
  }

  /**
   * Fit cuboid. pos: Float32Array xyz, rough: points của cuboid CVAT
   * [x,y,z, rx,ry,rz, L,W,H, ...]. Trả về { points, info } hoặc ném Error.
   */
  function fitCuboid(pos, count, rough, labelName, cfg = CFG, sensor = [0, 0, 0]) {
    const [px, py, pz, rx, ry, rz, sx, sy, sz] = rough;
    const R = rotMat(rx, ry, rz);
    const notes = [];

    const gr2 = cfg.GROUND_RADIUS * cfg.GROUND_RADIUS;
    const roi = [];
    for (let i = 0; i < count; i++) {
      const dx = pos[3 * i] - px, dy = pos[3 * i + 1] - py;
      if (dx * dx + dy * dy < gr2) roi.push(i);
    }
    if (!roi.length) throw new Error('Không có điểm nào quanh cuboid.');

    const ground = fitGround(pos, roi, cfg);
    if (!ground.ok) notes.push('mặt đất ước lượng thô');
    const gz = (x, y) => ground.a * x + ground.b * y + ground.c;

    const r2 = cfg.ROI_RADIUS * cfg.ROI_RADIUS;
    const cand = [];
    for (const i of roi) {
      const x = pos[3 * i], y = pos[3 * i + 1];
      const dx = x - px, dy = y - py;
      if (dx * dx + dy * dy > r2) continue;
      const h = pos[3 * i + 2] - gz(x, y);
      if (h > cfg.GROUND_CLEAR && h < cfg.MAX_H + 0.5) cand.push(i);
    }

    // Hạt giống: điểm nằm trong cuboid thô (đã nới SEED_PAD)
    const hx = sx / 2 + cfg.SEED_PAD, hy = sy / 2 + cfg.SEED_PAD, hz = sz / 2 + cfg.SEED_PAD;
    let seeds = cand.filter((i) => {
      const d = [pos[3 * i] - px, pos[3 * i + 1] - py, pos[3 * i + 2] - pz];
      const lx = R[0][0] * d[0] + R[1][0] * d[1] + R[2][0] * d[2];
      const ly = R[0][1] * d[0] + R[1][1] * d[1] + R[2][1] * d[2];
      const lz = R[0][2] * d[0] + R[1][2] * d[1] + R[2][2] * d[2];
      return Math.abs(lx) <= hx && Math.abs(ly) <= hy && Math.abs(lz) <= hz;
    });
    // Thêm hạt giống trong bán kính SEED_SEARCH: cuboid thô nhỏ đặt giữa xe thường không chứa
    // điểm nào trên thân (LiDAR chỉ thấy bề mặt), hoặc chỉ chứa vài điểm trên nóc.
    const classPrior = findPrior(labelName);
    const prior = cfg.USE_PRIOR ? classPrior : null;
    const rs = Math.max(cfg.SEED_SEARCH, classPrior ? classPrior.L / 2 + 0.5 : 0, Math.max(sx, sy) / 2 + cfg.SEED_PAD);
    const r2s = rs * rs;
    const seedSet = new Set(seeds);
    for (const i of cand) {
      const dx = pos[3 * i] - px, dy = pos[3 * i + 1] - py;
      if (dx * dx + dy * dy < r2s) seedSet.add(i);
    }
    if (!seedSet.size) throw new Error('Không có điểm nào (ngoài mặt đất) trong hoặc gần cuboid thô. Đặt cuboid lên vật rồi bấm lại.');

    const range = Math.hypot(px - sensor[0], py - sensor[1]);
    const eps = Math.min(cfg.EPS_MAX, Math.max(cfg.EPS_MIN, cfg.EPS_MIN + cfg.EPS_PER_M * range));
    // Gom từ từng hạt giống chưa thuộc cụm nào. Chọn cụm có điểm cao nhất:
    // số điểm / (1 + khoảng cách² từ trọng tâm cụm tới tâm cuboid thô).
    let idx = [], truncated = false, bestScore = -1;
    const taken = new Set();
    for (const s of seedSet) {
      if (taken.has(s)) continue;
      const g = growCluster(pos, cand, [s], eps, cfg);
      g.idx.forEach((i) => taken.add(i));
      let mx = 0, my = 0;
      for (const i of g.idx) { mx += pos[3 * i]; my += pos[3 * i + 1]; }
      mx /= g.idx.length; my /= g.idx.length;
      const score = g.idx.length / (1 + (mx - px) ** 2 + (my - py) ** 2);
      if (score > bestScore) { bestScore = score; idx = g.idx; truncated = g.truncated; }
    }
    if (truncated) notes.push('cụm chạm giới hạn kích thước: có thể dính vật bên cạnh');
    const n = idx.length;
    const xs = idx.map((i) => pos[3 * i]), ys = idx.map((i) => pos[3 * i + 1]), zs = idx.map((i) => pos[3 * i + 2]);

    const sparse = n < cfg.MIN_POINTS_FIT;
    if (sparse) notes.push(`chỉ ${n} điểm: giữ hướng cuboid thô` + (prior ? ', dùng kích thước mặc định' : ''));

    const theta = sparse ? rz : lshapeTheta(xs, ys);
    const e1 = [Math.cos(theta), Math.sin(theta)], e2 = [-Math.sin(theta), Math.cos(theta)];
    let lo1 = Infinity, hi1 = -Infinity, lo2 = Infinity, hi2 = -Infinity;
    for (let k = 0; k < n; k++) {
      const a = xs[k] * e1[0] + ys[k] * e1[1], b = xs[k] * e2[0] + ys[k] * e2[1];
      lo1 = Math.min(lo1, a); hi1 = Math.max(hi1, a); lo2 = Math.min(lo2, b); hi2 = Math.max(hi2, b);
    }
    const s1 = sensor[0] * e1[0] + sensor[1] * e1[1], s2 = sensor[0] * e2[0] + sensor[1] * e2[1];
    const d1 = hi1 - lo1, d2 = hi2 - lo2;

    // Trục nào là chiều dài L?
    let lenIsAxis1 = sparse ? true : d1 >= d2;
    if (!sparse && prior) {
      const face = Math.max(d1, d2), thin = Math.min(d1, d2);
      if (thin < cfg.THIN_FACE && face < cfg.PRIOR_TRIGGER * prior.L &&
          Math.abs(face - prior.W) < Math.abs(face - prior.L)) {
        lenIsAxis1 = !lenIsAxis1; // chỉ thấy mặt trước/sau: mặt nhìn thấy là chiều rộng
        notes.push('chỉ thấy mặt trước/sau');
      }
    }
    // uL = trục dài, uW = z × uL (hệ tay phải)
    let uL, loL, hiL, sL, uW, loW, hiW, sW;
    if (lenIsAxis1) {
      uL = e1; loL = lo1; hiL = hi1; sL = s1;
      uW = e2; loW = lo2; hiW = hi2; sW = s2;
    } else {
      uL = e2; loL = lo2; hiL = hi2; sL = s2;
      uW = [-e1[0], -e1[1]]; loW = -hi1; hiW = -lo1; sW = -s1;
    }
    // Chọn chiều (±180°) gần yaw của cuboid thô nhất
    let yaw = Math.atan2(uL[1], uL[0]);
    if (Math.abs(normAngle(yaw - rz)) > Math.PI / 2) {
      yaw = normAngle(yaw + Math.PI);
      uL = [-uL[0], -uL[1]]; [loL, hiL] = [-hiL, -loL]; sL = -sL;
      uW = [-uW[0], -uW[1]]; [loW, hiW] = [-hiW, -loW]; sW = -sW;
    }

    const target = (measured, priorV, roughV) => {
      if (prior) return measured < cfg.PRIOR_TRIGGER * priorV ? priorV : measured;
      return sparse ? Math.max(measured, roughV) : measured;
    };
    const dL = hiL - loL, dW = hiW - loW;
    const tL = Math.max(cfg.MIN_SIZE, target(dL, prior && prior.L, sx));
    const tW = Math.max(cfg.MIN_SIZE, target(dW, prior && prior.W, sy));
    if (prior && (tL > dL + 1e-9 || tW > dW + 1e-9)) notes.push('đã nới cạnh khuất theo kích thước mặc định');
    [loL, hiL] = extendAway(loL, hiL, sL, tL);
    [loW, hiW] = extendAway(loW, hiW, sW, tW);
    const mL = (loL + hiL) / 2, mW = (loW + hiW) / 2;
    const cx = mL * uL[0] + mW * uW[0], cy = mL * uL[1] + mW * uW[1];

    const bottom = gz(cx, cy);
    // Chiều cao: thêm các điểm rời rạc nằm trong khung đáy (vd. tia quét trúng nóc xe ở xa hơn mặt bên),
    // chỉ nhận điểm cao hơn đỉnh hiện tại tối đa 1 khoảng hở giữa 2 tia (cộng dồn từng bước).
    let top = Math.max(...zs);
    const gap = Math.max(0.3, range * Math.tan((1.6 * Math.PI) / 180));
    const inFoot = [];
    for (const i of cand) {
      const a = pos[3 * i] * uL[0] + pos[3 * i + 1] * uL[1], b = pos[3 * i] * uW[0] + pos[3 * i + 1] * uW[1];
      if (a >= loL - 0.05 && a <= hiL + 0.05 && b >= loW - 0.05 && b <= hiW + 0.05) inFoot.push(pos[3 * i + 2]);
    }
    inFoot.sort((p, q) => p - q);
    for (const z of inFoot) if (z > top && z <= top + gap) top = z;
    const measuredH = top - bottom;
    const H = Math.max(cfg.MIN_SIZE, target(measuredH, prior && prior.H, sz));
    const cz = bottom + H / 2;

    const points = rough.slice();
    points[0] = cx; points[1] = cy; points[2] = cz;
    points[3] = 0; points[4] = 0; points[5] = yaw;
    points[6] = hiL - loL; points[7] = hiW - loW; points[8] = H;
    return {
      points,
      info: { n, eps, range, ground, notes, measured: { L: dL, W: dW, H: measuredH }, prior, idx, seeds: seedSet.size },
    };
  }

  const core = { CFG, PRIORS, rotMat, fitGround, growCluster, lshapeTheta, extendAway, fitCuboid, findPrior, normAngle };
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }
  if (typeof window === 'undefined') return;
  // Chỉ chạy 1 lần trên mỗi trang (thuộc tính DOM thấy được từ mọi "world")
  if (document.documentElement.getAttribute('data-cuboid-helper')) return;
  document.documentElement.setAttribute('data-cuboid-helper', '1');

  // =========================================================== browser side
  let store = null;

  function findStore() {
    if (store) return store;
    const root = document.getElementById('root');
    if (!root) return null;
    let fiber = null;
    const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
    if (key) fiber = root[key];
    else if (root._reactRootContainer) {
      const rc = root._reactRootContainer;
      fiber = (rc._internalRoot && rc._internalRoot.current) || rc.current;
    }
    const stack = [fiber];
    let steps = 0;
    while (stack.length && steps++ < 20000) {
      const f = stack.pop();
      if (!f) continue;
      const p = f.memoizedProps;
      const cand = p && (p.store || (p.value && p.value.store));
      if (cand && typeof cand.getState === 'function' && typeof cand.dispatch === 'function') {
        store = cand;
        store.subscribe(onStoreChange);
        return store;
      }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    return null;
  }

  function getViewImpl(canvas) {
    if (canvas.view && canvas.view.views) return canvas.view;
    for (const k of Object.keys(canvas)) {
      const v = canvas[k];
      if (v && v.views && v.views.perspective) return v;
    }
    return null;
  }

  function getCtx() {
    const s = findStore();
    if (!s) return null;
    const st = s.getState();
    const ann = st && st.annotation;
    const canvas = ann && ann.canvas && ann.canvas.instance;
    if (!canvas || typeof canvas.html !== 'function') return null;
    let html;
    try { html = canvas.html(); } catch (e) { return null; }
    if (!html || !html.perspective || !html.top) return null; // không phải canvas 3D
    const id = ann.annotations && ann.annotations.activatedStateID;
    const states = (ann.annotations && ann.annotations.states) || [];
    const state = id == null ? null : states.find((x) => x.clientID === id) || null;
    const cuboid = state && String(state.shapeType).toLowerCase() === 'cuboid' && state.points && state.points.length >= 9
      ? state : null;
    return { store: s, st, canvas, html, view: getViewImpl(canvas), state: cuboid, rawState: state };
  }

  // Lấy point cloud đang hiển thị (đối tượng THREE.Points lớn nhất trong scene perspective)
  function getCloud(ctx) {
    const scene = ctx.view && ctx.view.views && ctx.view.views.perspective && ctx.view.views.perspective.scene;
    if (!scene) return null;
    let best = null;
    const visit = (o) => {
      if (o.isPoints && !o.userData.chOverlay && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        const c = o.geometry.attributes.position.count;
        if (!best || c > best.geometry.attributes.position.count) best = o;
      }
      (o.children || []).forEach(visit);
    };
    visit(scene);
    if (!best) return null;
    const attr = best.geometry.attributes.position;
    const src = attr.array, count = attr.count, stride = attr.itemSize || 3;
    if (best.updateMatrixWorld) best.updateMatrixWorld(true);
    const m = best.matrixWorld && best.matrixWorld.elements;
    const identity = !m || m.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-9);
    if (identity && stride === 3) return { pos: src, count, obj: best };
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x = src[i * stride], y = src[i * stride + 1], z = src[i * stride + 2];
      if (identity) { pos[3 * i] = x; pos[3 * i + 1] = y; pos[3 * i + 2] = z; continue; }
      pos[3 * i] = m[0] * x + m[4] * y + m[8] * z + m[12];
      pos[3 * i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      pos[3 * i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    return { pos, count, obj: best };
  }

  // ----------------------------------------------------------- commit
  let pending = null; // { id, points, t }
  let useFallback = false;
  let verified = false;

  const samePoints = (a, b) => a && b && [0, 1, 2, 5, 6, 7, 8].every((k) => Math.abs(a[k] - b[k]) < 1e-6);

  function onStoreChange() {
    if (!pending || !store) return;
    const ann = store.getState().annotation;
    const s = ann && ann.annotations && (ann.annotations.states || []).find((x) => x.clientID === pending.id);
    if (s && samePoints(s.points, pending.points)) { pending = null; verified = true; }
  }

  async function commitFallback(ctx, points) {
    ctx.state.points = points;
    const saved = await ctx.state.save();
    let history;
    try { history = await ctx.st.annotation.job.instance.actions.get(); } catch (e) { /* bỏ qua */ }
    ctx.store.dispatch({ type: 'UPDATE_ANNOTATIONS_SUCCESS', payload: { states: [saved], history } });
  }

  function commit(ctx, points) {
    pending = { id: ctx.state.clientID, points, t: Date.now() };
    if (useFallback) {
      commitFallback(ctx, points).catch((e) => toast('Lỗi lưu: ' + e.message, true)).finally(() => onStoreChange());
      return;
    }
    // Cách CVAT tự làm khi bạn kéo cuboid: canvas phát sự kiện 'canvas.edited' trên view perspective
    ctx.html.perspective.dispatchEvent(new CustomEvent('canvas.edited', { detail: { state: ctx.state, points } }));
    if (!verified) {
      setTimeout(() => {
        if (pending && pending.points === points) {
          console.warn('[cuboid-helper] canvas.edited không được xử lý, chuyển sang cách lưu dự phòng');
          useFallback = true;
          commit(ctx, points);
        }
      }, 600);
    }
  }

  const busy = () => pending && Date.now() - pending.t < 500;

  // ------------------------------------------------------------- views / keys
  const mouse = { x: -1, y: -1 };
  window.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, true);

  function hoveredView(ctx) {
    for (const name of ['top', 'side', 'front']) {
      const el = ctx.html[name];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width && mouse.x >= r.left && mouse.x <= r.right && mouse.y >= r.top && mouse.y <= r.bottom) return name;
    }
    return null;
  }

  function project(camera, p) {
    camera.updateMatrixWorld && camera.updateMatrixWorld();
    const v = camera.matrixWorldInverse.elements, P = camera.projectionMatrix.elements;
    const c = [0, 1, 2, 3].map((i) => v[i] * p[0] + v[4 + i] * p[1] + v[8 + i] * p[2] + v[12 + i]);
    const q = [0, 1, 2, 3].map((i) => P[i] * c[0] + P[4 + i] * c[1] + P[8 + i] * c[2] + P[12 + i] * c[3]);
    return [q[0] / q[3], q[1] / q[3]];
  }

  // Trục local (có dấu) của cuboid trùng nhất với hướng phím trên màn hình của view này
  function axisForKey(ctx, viewName, keyDir) {
    const cam = ctx.view && ctx.view.views[viewName] && ctx.view.views[viewName].camera;
    if (!cam) return null;
    const pts = ctx.state.points;
    const R = rotMat(pts[3], pts[4], pts[5]);
    const c0 = [pts[0], pts[1], pts[2]];
    const p0 = project(cam, c0);
    const rect = ctx.html[viewName].getBoundingClientRect();
    let best = null;
    for (let k = 0; k < 3; k++) {
      const a = col(R, k);
      const p1 = project(cam, [c0[0] + a[0], c0[1] + a[1], c0[2] + a[2]]);
      const v = [(p1[0] - p0[0]) * rect.width, (p1[1] - p0[1]) * rect.height];
      const len = Math.hypot(v[0], v[1]);
      if (len < 1e-6) continue;
      const dot = (v[0] * keyDir[0] + v[1] * keyDir[1]) / len;
      if (!best || Math.abs(dot) > Math.abs(best.dot)) best = { k, dot, sign: Math.sign(dot), dir: a };
    }
    return best && Math.abs(best.dot) > 0.5 ? best : null;
  }

  const KEY_DIR = { KeyW: [0, 1], KeyS: [0, -1], KeyA: [-1, 0], KeyD: [1, 0] }; // NDC, y hướng lên
  const AXIS_NAME = ['L', 'W', 'H'];
  const swallowed = new Set();

  function swallow(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    swallowed.add(e.code);
  }

  function isTyping(t) {
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  // ------------------------------------------------- điểm to + sáng hơn
  const VIS_KEY = 'cuboidHelperVis';
  let VIS = { size: 1.8, bright: 2 };
  try { Object.assign(VIS, JSON.parse(localStorage.getItem(VIS_KEY) || '{}')); } catch (e) { /* bỏ qua */ }
  const saveVis = () => { try { localStorage.setItem(VIS_KEY, JSON.stringify(VIS)); } catch (e) { /* bỏ qua */ } };
  const visStamp = () => VIS.size + '|' + VIS.bright;

  function styleCloud(o) {
    const mat = o.material, geo = o.geometry;
    if (!mat || !geo) return;
    const stamp = visStamp();
    if (mat.userData.chStamp !== stamp) {
      if (mat.userData.chBaseSize === undefined) mat.userData.chBaseSize = mat.size;
      mat.size = mat.userData.chBaseSize * VIS.size;
      if (!geo.attributes.color && mat.color) {
        if (!mat.userData.chBaseColor) mat.userData.chBaseColor = mat.color.clone();
        mat.color.copy(mat.userData.chBaseColor).multiplyScalar(1 + 0.6 * VIS.bright);
      }
      mat.needsUpdate = true;
      mat.userData.chStamp = stamp;
    }
    const col = geo.attributes.color;
    if (col && geo.userData.chStamp !== stamp) {
      const a = col.array;
      const max = (a instanceof Uint8Array || a instanceof Uint8ClampedArray) ? 255 : 1;
      if (!geo.userData.chOrig) geo.userData.chOrig = a.slice();
      const orig = geo.userData.chOrig, gain = 1 + 0.6 * VIS.bright, lift = 0.12 * VIS.bright * max;
      for (let i = 0; i < a.length; i++) a[i] = Math.min(max, orig[i] * gain + lift);
      col.needsUpdate = true;
      geo.userData.chStamp = stamp;
    }
  }

  function styleAllClouds() {
    const ctx = getCtx();
    if (!ctx || !ctx.view || !ctx.view.views) return;
    for (const name of Object.keys(ctx.view.views)) {
      const scene = ctx.view.views[name] && ctx.view.views[name].scene;
      if (!scene) continue;
      const visit = (o) => {
        if (o.isPoints && !o.userData.chOverlay && o.geometry && o.geometry.attributes && o.geometry.attributes.position) styleCloud(o);
        (o.children || []).forEach(visit);
      };
      visit(scene);
    }
  }

  // Tô màu hồng các điểm thuộc cụm vừa gom (lớp phủ riêng, tự xóa sau vài giây)
  let overlays = [], overlayTimer = 0;
  function clearHighlight() {
    for (const { o, scene } of overlays) {
      scene.remove(o);
      if (o.geometry.dispose) o.geometry.dispose();
      if (o.material.dispose) o.material.dispose();
    }
    overlays = [];
  }
  function showHighlight(ctx, cloud, idx, ms = 6000) {
    clearHighlight();
    if (!cloud.obj || !idx.length) return;
    const arr = new Float32Array(idx.length * 3);
    idx.forEach((i, k) => { arr[3 * k] = cloud.pos[3 * i]; arr[3 * k + 1] = cloud.pos[3 * i + 1]; arr[3 * k + 2] = cloud.pos[3 * i + 2]; });
    const src = cloud.obj;
    const Geo = src.geometry.constructor, Attr = src.geometry.attributes.position.constructor, Pts = src.constructor;
    const scenes = new Set();
    for (const name of Object.keys(ctx.view.views)) {
      const sc = ctx.view.views[name] && ctx.view.views[name].scene;
      if (sc) scenes.add(sc);
    }
    for (const scene of scenes) {
      const geo = new Geo();
      geo.setAttribute('position', new Attr(arr.slice(), 3));
      const mat = src.material.clone();
      mat.vertexColors = false;
      if (mat.color) mat.color.setRGB(1, 0.15, 0.85);
      mat.size = (src.material.size || 0.05) * 1.5;
      mat.depthTest = false;
      mat.needsUpdate = true;
      const o = new Pts(geo, mat);
      o.renderOrder = 999;
      o.userData.chOverlay = true;
      scene.add(o);
      overlays.push({ o, scene });
    }
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(clearHighlight, ms);
  }

  setInterval(() => { try { styleAllClouds(); } catch (e) { /* bỏ qua */ } }, 700);

  function onVisKey(code) {
    if (code === 'BracketRight') VIS.size = Math.min(10, +(VIS.size * 1.25).toFixed(3));
    else if (code === 'BracketLeft') VIS.size = Math.max(0.3, +(VIS.size / 1.25).toFixed(3));
    else if (code === 'KeyB') VIS.bright = (VIS.bright + 1) % 4;
    else return false;
    saveVis();
    styleAllClouds();
    toast(`Điểm: cỡ ×${VIS.size.toFixed(2)} · độ sáng ${VIS.bright}/3`, false, 1200);
    return true;
  }

  function onKeyDown(e) {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const code = e.code;
    if (code === 'BracketRight' || code === 'BracketLeft' || code === 'KeyB') {
      if (!getCtx()) return;
      swallow(e);
      onVisKey(code);
      return;
    }
    const isMove = code in KEY_DIR;
    const isRot = code === 'KeyQ' || code === 'KeyE';
    const isFit = code === CFG.FIT_KEY;
    if (!isMove && !isRot && !isFit) return;
    const ctx = getCtx();
    if (!ctx) return;

    if (isFit) {
      if (!ctx.state) {
        // không chặn phím, để CVAT xử lý G như bình thường, chỉ báo cho người dùng
        toast(ctx.rawState ? 'Đối tượng đang chọn không phải cuboid' : 'Chưa chọn cuboid: bấm vào cuboid (hoặc chọn trong danh sách bên phải) rồi bấm G');
        return;
      }
      swallow(e);
      if (!e.repeat) doFit(ctx);
      return;
    }

    const viewName = hoveredView(ctx);
    if (!viewName) return; // chuột không ở trên Top/Side/Front: giữ nguyên phím của CVAT
    swallow(e); // chặn D (lùi frame) v.v. khi chuột ở trên view
    if (!ctx.state) { toast('Chưa chọn cuboid nào'); return; }
    if (busy()) return;

    const pts = ctx.state.points.slice();
    if (isRot) {
      if (viewName !== 'top') return;
      const deg = (e.shiftKey ? CFG.ROT_STEP_FINE_DEG : CFG.ROT_STEP_DEG) * (code === 'KeyQ' ? -1 : 1);
      pts[5] = normAngle(pts[5] + (deg * Math.PI) / 180);
      commit(ctx, pts);
      return;
    }

    const ax = axisForKey(ctx, viewName, KEY_DIR[code]);
    if (!ax) { toast('Không xác định được trục ở view này'); return; }
    const old = pts[6 + ax.k];
    // W/D: nới mặt trên/phải ra ngoài. S/A: thu mặt dưới/trái vào trong (mặt di chuyển lên/sang phải).
    // Shift đảo lại: Shift+W/D thu mặt trên/phải, Shift+S/A nới mặt dưới/trái.
    const grow = (code === 'KeyW' || code === 'KeyD') !== e.shiftKey;
    const next = Math.max(CFG.MIN_SIZE, old + (grow ? CFG.STEP : -CFG.STEP));
    const delta = next - old;
    if (!delta) return;
    pts[6 + ax.k] = next;
    for (let i = 0; i < 3; i++) pts[i] += (ax.dir[i] * ax.sign * delta) / 2;
    commit(ctx, pts);
    toast(`${AXIS_NAME[ax.k]} = ${next.toFixed(2)} m`, false, 700);
  }

  function onKeyOther(e) {
    if (swallowed.has(e.code)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.type === 'keyup') swallowed.delete(e.code);
    }
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keypress', onKeyOther, true);
  window.addEventListener('keyup', onKeyOther, true);

  function doFit(ctx) {
    const cloud = getCloud(ctx);
    if (!cloud) { toast('Không tìm thấy point cloud trong canvas 3D', true); return; }
    const label = ctx.state.label && ctx.state.label.name;
    try {
      const t0 = performance.now();
      const before = ctx.state.points.slice(0, 9);
      const res = fitCuboid(cloud.pos, cloud.count, ctx.state.points, label);
      commit(ctx, res.points);
      const p = res.points, i = res.info;
      try { showHighlight(ctx, cloud, i.idx); } catch (err) { console.warn('[cuboid-helper] không tô được cụm:', err); }
      console.log('[cuboid-helper] fit', {
        label, cloudPoints: cloud.count, seeds: i.seeds, clusterPoints: i.n, eps: i.eps, range: i.range,
        ground: i.ground, measured: i.measured, before, after: p.slice(0, 9), notes: i.notes,
      });
      const ms = (performance.now() - t0).toFixed(0);
      toast(
        `Fit ${label || ''}: ${i.n} điểm, cách ${i.range.toFixed(1)} m · ` +
        `L ${p[6].toFixed(2)} W ${p[7].toFixed(2)} H ${p[8].toFixed(2)} · yaw ${((p[5] * 180) / Math.PI).toFixed(1)}° (${ms} ms)` +
        (i.notes.length ? '\n⚠ ' + i.notes.join('; ') : ''),
        false, 5000,
      );
    } catch (err) {
      toast(err.message, true);
    }
  }

  // ------------------------------------------------------------------ toast
  let toastEl = null, toastTimer = 0;
  function toast(msg, isErr = false, ms = 3000) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      Object.assign(toastEl.style, {
        position: 'fixed', left: '12px', bottom: '12px', zIndex: 99999, maxWidth: '520px',
        padding: '8px 12px', borderRadius: '6px', font: '13px/1.4 system-ui, sans-serif',
        color: '#fff', whiteSpace: 'pre-line', pointerEvents: 'none', boxShadow: '0 2px 8px rgba(0,0,0,.3)',
      });
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.background = isErr ? '#b42318' : 'rgba(20,20,20,.85)';
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, ms);
  }

  // Dùng trong DevTools console để kiểm tra: cuboidHelper.check()
  window.cuboidHelper = {
    ...core,
    getCtx, getCloud,
    check() {
      const ctx = getCtx();
      const cloud = ctx && getCloud(ctx);
      const r = {
        store: !!findStore(), canvas3d: !!ctx, viewImpl: !!(ctx && ctx.view),
        activeCuboid: ctx && ctx.state ? ctx.state.clientID : null,
        cloudPoints: cloud ? cloud.count : 0, fallbackSave: useFallback,
      };
      console.table(r);
      return r;
    },
  };
  console.log('[cuboid-helper] đã nạp. Gõ cuboidHelper.check() trong console để kiểm tra.');
}

  // Node (test): chạy trực tiếp để xuất module
  if (typeof module !== 'undefined' && module.exports) { main(); return; }
  // Chỉ kích hoạt trên trang CVAT (tiêu đề trang hoặc tên miền có chữ "cvat")
  if (!/cvat/i.test(document.title) && !/cvat/i.test(location.hostname)) return;
  console.log('[cuboid-helper] khởi động trên', location.href);
  if (document.documentElement.getAttribute('data-cuboid-helper')) return;
  // Tampermonkey có thể chạy script trong vùng tách biệt (isolated world), không đọc được
  // React/Redux của CVAT. Chèn code thành thẻ <script> để chạy trong chính trang.
  try {
    const s = document.createElement('script');
    s.textContent = '(' + main.toString() + ')();';
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  } catch (e) { /* CSP chặn */ }
  if (!document.documentElement.getAttribute('data-cuboid-helper')) {
    console.warn('[cuboid-helper] không chèn được vào trang (có thể do CSP), chạy trực tiếp');
    main();
  }
})();

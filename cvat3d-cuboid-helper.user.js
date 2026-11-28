// ==UserScript==
// @name         CVAT 3D Cuboid Helper (auto-fit + WASD)
// @namespace    tool_3d
// @version      0.4.0
// @description  Tự fit cuboid theo cụm điểm (G, Ctrl+click), gom lại theo view 2D, giữ cuboid sát mặt đất, nới/thu từng mặt bằng WASD trong CVAT 3D.
// @match        http://localhost:8080/*
// @match        http://127.0.0.1:8080/*
// @match        https://cvat.edufun.ai/*
// @grant        none
// @sandbox      raw
// @run-at       document-idle
// ==/UserScript==
//
// Đang để chạy với CVAT local tại http://localhost:8080 (hoặc http://127.0.0.1:8080) và CVAT online https://cvat.edufun.ai.
// Dùng server khác thì thêm một dòng @match ở trên, ví dụ:
//   // @match        *://cvat.ten-truong.edu.vn/*
//
// Phím và chuột trong job 3D:
//   G            : (chuột ở view 3D lớn) fit lại cuboid đang chọn theo cụm điểm quanh nó (bắt trọn ô tô)
//   Ctrl + click trái : (view 3D lớn) fit cuboid quanh vật chạm tới điểm vừa bấm, gom chặt cho vật nhỏ.
//                  Bấm trong cuboid đang chọn: fit lại cuboid đó. Bấm chỗ khác: tạo cuboid mới (nhãn đang chọn).
//   G (chuột trên view Top/Side/Front): gom lại các phần điểm dày trên mặt phẳng của view đó,
//                  fit 2 trục của view, giữ nguyên trục chiều sâu và góc xoay
//   Shift+G      : (view Top) như G, đồng thời tìm lại góc xoay theo cụm vừa gom
//   Shift + kéo  : (view 3D lớn) kéo cuboid đang chọn trượt trên mặt đất (Esc: huỷ)
//   J            : bật/tắt khoá sát mặt đất (mặc định bật): cuboid di chuyển hoặc tạo mới luôn có đáy
//                  nằm trên mặt đất, không kéo bay lên được
//   Cuboid dạng TRACK: G, Ctrl+click (fit lại) và G trên Top/Side/Front không đổi kích thước nữa, chỉ dời
//                  cuboid tới chỗ có nhiều điểm nhất (Shift+G ở Top: xoay lại nữa). Dạng SHAPE vẫn như trên.
//                  Đổi L/W/H ở 1 keyframe (WASD hoặc kéo cạnh) thì mọi keyframe khác của track đổi theo.
//                  Chỉnh 1 track xong, sang frame sau tool tự gom cụm (dời) track đó và lưu thành keyframe.
//   U            : đồng nhất kích thước mọi keyframe của track đang chọn theo kích thước ở frame đang xem
//                  (popup có thêm nút đồng nhất tất cả track trong job, theo trung vị các keyframe)
//   Bật/tắt: popup của extension (tự dính mặt đất, tự gom track frame sau, áp kích thước track),
//                  hoặc trong Console: cuboidHelper.set({ groundLock: true, autoTrack: false, trackSyncSize: true })
//   W / D        : (chuột trên view Top/Side/Front) nới mặt trên / mặt phải ra ngoài
//   S / A        : thu mặt dưới / mặt trái vào trong (mặt dịch lên / sang phải)
//   Shift+WASD   : đảo lại (Shift+W/D thu mặt trên/phải, Shift+S/A nới mặt dưới/trái)
//   Q            : (chỉ ở view Top) xoay yaw −1°, Shift: −0.2°
//   E            : (chỉ ở view Top) xoay +90° (Shift+E: −90°), đổi chỗ L và W nên khung đáy giữ nguyên
//   ↑ ↓ ← →      : (chuột trên view Top/Side/Front) dời cuboid 5 cm theo hướng phím, Shift: 1 cm
//   ] / [        : điểm to hơn / nhỏ hơn
//   B            : đổi độ sáng điểm (0 = gốc, 1, 2, 3)

(function () {
function main() {
  'use strict';
  const VERSION = '0.4.0';

  // ---------------------------------------------------------------- config
  const CFG = {
    STEP: 0.02,            // m mỗi lần bấm WASD
    ROT_STEP_DEG: 1,       // độ mỗi lần bấm Q
    MOVE_STEP: 0.05,       // m mỗi lần bấm phím mũi tên (Shift: MOVE_STEP_FINE)
    MOVE_STEP_FINE: 0.01,
    ROT_STEP_FINE_DEG: 0.2,
    FIT_KEY: 'KeyG',
    LOCK_KEY: 'KeyJ',      // bật/tắt khoá sát mặt đất
    UNIFY_KEY: 'KeyU',     // đồng nhất kích thước mọi keyframe của track đang chọn (lấy kích thước ở frame đang xem)

    GROUND_RADIUS: 12,     // m, vùng lấy điểm để ước lượng mặt đất (RANSAC, dùng để bỏ điểm đất khi gom)
    GROUND_THRESH: 0.15,   // m, ngưỡng inlier RANSAC
    GROUND_CLEAR: 0.20,    // m, điểm thấp hơn mức này so với đất bị coi là đất
    RANSAC_ITERS: 300,

    // Mặt đất ngay quanh cuboid (đặt đáy, khoá sát đất). Nhìn ngang (view Side) thì mặt đất là mức z
    // thấp có nhiều điểm trùng nhau nhất: lấy histogram z của các điểm trong vành quanh khung đáy.
    GROUND_NEAR: 1.0,      // m, vành rộng chừng này quanh khung đáy (thiếu điểm thì nới x2, x4)
    GROUND_BIN: 0.04,      // m, bước histogram theo z
    GROUND_PEAK_FRAC: 0.3, // lấy đỉnh THẤP NHẤT có >= tỉ lệ này * đỉnh cao nhất
    GROUND_PEAK_MIN: 8,    // đỉnh phải có >= ngần này điểm
    GROUND_LAYER: 0.1,     // m, lớp điểm mặt đất = trong khoảng ± chừng này quanh đỉnh
    GROUND_MAX_SLOPE: 0.2, // độ dốc lớn nhất nhận được khi fit mặt phẳng cho lớp đất (20%)
    GROUND_REF_TOL: 0.5,   // m, lệch hơn chừng này so với bản đồ mặt đất thì bỏ (vd. nhận nhầm nóc xe)
    // Bản đồ mặt đất theo ô (để bỏ điểm đất khi gom cụm, kể cả khi đường dốc, có gờ, lề đường)
    GROUND_CELL: 2.0,      // m, kích thước ô
    GROUND_CELL_TOL: 1.5,  // m, chỉ xét điểm cách mặt RANSAC không quá chừng này
    GROUND_STEP: 0.2,      // m, ô cao hơn các ô xung quanh quá chừng này: không phải đất (vạch điểm thấp trên thành xe)

    // G (chuột ở view 3D lớn): gom cụm như bản đầu, bắt trọn ô tô
    ROI_RADIUS: 8,         // m, chỉ xét điểm trong bán kính này quanh cuboid thô
    SEED_PAD: 0.3,         // m, nới cuboid thô khi lấy điểm hạt giống
    SEED_SEARCH: 2.0,      // m, nếu cuboid thô không chứa điểm nào: lấy điểm gần nhất trong bán kính này
    EPS_MIN: 0.35,         // m, khoảng cách gom điểm (tăng theo khoảng cách tới LiDAR)
    EPS_MAX: 0.9,
    EPS_PER_M: 0.015,
    Z_WEIGHT: 0.6,         // giảm trọng số trục z khi gom (khoảng hở giữa các tia theo chiều dọc lớn)
    MAX_L: 10, MAX_H: 5,   // giới hạn kích thước cụm
    TRACK_SEARCH: 1.0,     // m, cuboid dạng track: tìm điểm trong cuboid nới thêm chừng này (sang frame mới cuboid thường lệch chỗ)
    TRACK_SYNC_SIZE: true, // đổi L/W/H ở 1 keyframe của track thì áp cho mọi keyframe khác của track đó
    TRACK_SYNC_DELAY: 800, // ms, chờ ngần này sau lần đổi kích thước cuối (bấm WASD liên tục) rồi mới áp
    AUTO_TRACK: true,      // chỉnh 1 track xong, sang frame sau tự gom cụm (dời) track đó rồi lưu keyframe
    AUTO_TRACK_MAX_MOVE: 3.0, // m, phải dời xa hơn chừng này so với vị trí đoán trước: dừng theo track đó
    AUTO_TRACK_MIN_POINTS: 8, // cụm ít điểm hơn: dừng theo track đó
    AUTO_TRACK_WAIT: 6000, // ms, chờ point cloud của frame mới tải xong tối đa chừng này
    AUTO_TRACK_PREDICT_MAX: 5, // frame, đoán vị trí theo vận tốc khi frame mới cách frame đã gom không quá chừng này

    // Ctrl + click trái (view 3D lớn): gom chặt từ điểm bấm, cho vật nhỏ, không lan sang hàng rào
    PICK_PX: 12,           // px, lấy điểm gần camera nhất trong bán kính này quanh con trỏ
    PICK_SEED_MAX: 1.0,    // m, bấm trúng mặt đất: lấy điểm của vật gần nhất trong bán kính này
    PICK_EPS_MIN: 0.25, PICK_EPS_MAX: 0.7, PICK_EPS_PER_M: 0.012,
    PICK_Z_WEIGHT: 0.5,
    PICK_CORE_MIN: 3,      // điểm phải có >= ngần này hàng xóm mới được lan tiếp (không bò theo dãy điểm lẻ)
    PICK_REACH: 3,         // m, không lan xa hơn chừng này tính từ điểm bấm (nhãn không có trong PRIORS)
    CLASS_REACH: 1.25,     // nhãn có trong PRIORS: không lan xa hơn CLASS_REACH * L + 0.5 m
    PICK_NEAR_SELECTED: 1.0, // m, bấm trong khung đáy cuboid đang chọn (nới chừng này): fit lại cuboid đó

    MIN_POINTS_FIT: 12,    // ít hơn: không tự tìm hướng, dùng yaw của cuboid thô
    PRIOR_TRIGGER: 0.75,   // cạnh đo được < 75% kích thước mặc định -> dùng kích thước mặc định
    THIN_FACE: 0.5,        // m, cụm mỏng hơn mức này = chỉ thấy 1 mặt
    MIN_SIZE: 0.1,
    // false: tâm = tâm khung bao sát cụm điểm, chiều dài L theo cạnh dài nhất của cụm.
    // true : nới cạnh khuất theo kích thước mặc định của class (bảng PRIORS) khi chỉ thấy 1 mặt.
    USE_PRIOR: false,
    FIT_MARGIN: 0.1,       // m, khoảng hở thêm vào MỖI mặt sau khi fit (mỗi chiều rộng thêm 2 lần số này). Đáy vẫn đặt trên mặt đất.

    // G khi chuột ở trên view Top/Side/Front: gom lại theo mật độ trên mặt phẳng 2D của view đó
    REFINE_PAD: 0.3,       // m, lấy điểm trong cuboid nới thêm chừng này (theo 2 trục của view)
    REFINE_DEPTH_PAD: 0.1, // m, nới theo trục chiều sâu (trục vuông góc với view)
    REFINE_MIN_PTS: 3,     // điểm có >= ngần này hàng xóm (trong khoảng gom) mới coi là "dày"
    REFINE_EPS_MIN: 0.25, REFINE_EPS_MAX: 0.6, REFINE_EPS_PER_M: 0.012, // khoảng gom theo trục ngang
    REFINE_VGAP: 0.5,      // m, theo trục đứng nối qua khoảng hở tới chừng này (kính xe, khoảng giữa 2 tia)
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

  function median(arr) {
    const s = Float64Array.from(arr).sort();
    const n = s.length;
    if (!n) return NaN;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  // Mặt đất z = a*x + b*y + c bằng RANSAC (chỉ chấp nhận mặt gần nằm ngang) + bình phương tối thiểu.
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

  // Bình phương tối thiểu z = a*(x-x0) + b*(y-y0) + c. spread: độ trải (m) theo hướng hẹp nhất của các điểm.
  function planeFit(pos, idx, x0, y0) {
    const n = idx.length;
    if (n < 6) return null;
    let mx = 0, my = 0, mz = 0;
    for (const i of idx) { mx += pos[3 * i] - x0; my += pos[3 * i + 1] - y0; mz += pos[3 * i + 2]; }
    mx /= n; my /= n; mz /= n;
    let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
    for (const i of idx) {
      const x = pos[3 * i] - x0 - mx, y = pos[3 * i + 1] - y0 - my, z = pos[3 * i + 2] - mz;
      sxx += x * x; sxy += x * y; syy += y * y; sxz += x * z; syz += y * z;
    }
    const det = sxx * syy - sxy * sxy;
    if (det <= 1e-12) return null;
    const a = (sxz * syy - syz * sxy) / det, b = (syz * sxx - sxz * sxy) / det;
    const lmin = (sxx + syy) / 2 - Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
    return { a, b, c: mz - a * mx - b * my, spread: Math.sqrt(Math.max(0, lmin) / n) };
  }

  // Đỉnh THẤP NHẤT đủ dày của histogram các giá trị vals (độ cao, bước GROUND_BIN): đỉnh có >= GROUND_PEAK_FRAC
  // lần đỉnh cao nhất và >= GROUND_PEAK_MIN điểm. Trả về giá trị giữa đỉnh, hoặc null.
  function lowestPeak(vals, cfg) {
    if (vals.length < cfg.GROUND_PEAK_MIN) return null;
    let lo = Infinity, hi = -Infinity;
    for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const bin = cfg.GROUND_BIN, nb = Math.min(4000, Math.floor((hi - lo) / bin) + 1);
    const h = new Float64Array(nb);
    for (const v of vals) h[Math.min(nb - 1, Math.floor((v - lo) / bin))]++;
    const s = new Float64Array(nb);
    let M = 0;
    for (let k = 0; k < nb; k++) {
      s[k] = (k > 0 ? h[k - 1] : 0) + 2 * h[k] + (k + 1 < nb ? h[k + 1] : 0);
      if (s[k] > M) M = s[k];
    }
    for (let k = 0; k < nb; k++) {
      if (s[k] < cfg.GROUND_PEAK_FRAC * M) continue;
      if ((k > 0 && s[k - 1] > s[k]) || (k + 1 < nb && s[k + 1] > s[k])) continue; // chưa tới đỉnh
      if (h[k] + (k > 0 ? h[k - 1] : 0) + (k + 1 < nb ? h[k + 1] : 0) >= cfg.GROUND_PEAK_MIN) return lo + (k + 0.5) * bin;
    }
    return null;
  }

  /**
   * Các điểm "trống phía trên" trong idx: không có điểm nào cao hơn 5..80 cm trong bán kính 15 cm theo xy.
   * Điểm trên thành xe, tường, cột luôn có điểm của tia kế trên nằm ngay phía trên nên không bao giờ được coi
   * là đất; điểm mặt đất thì tia kế trên rơi xuống đất ở xa hơn.
   */
  function bareFilter(pos, idx) {
    const cs = 0.15, inv = 1 / cs, grid = new Map();
    const key = (a, b) => (a + 65536) * 131072 + (b + 65536);
    for (const i of idx) {
      const k = key(Math.floor(pos[3 * i] * inv), Math.floor(pos[3 * i + 1] * inv));
      let arr = grid.get(k);
      if (!arr) grid.set(k, (arr = []));
      arr.push(i);
    }
    const out = [];
    for (const i of idx) {
      const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
      const gx = Math.floor(x * inv), gy = Math.floor(y * inv);
      let covered = false;
      for (let a = -1; a <= 1 && !covered; a++) for (let b = -1; b <= 1 && !covered; b++) {
        const arr = grid.get(key(gx + a, gy + b));
        if (!arr) continue;
        for (const j of arr) {
          const dz = pos[3 * j + 2] - z;
          if (dz > 0.05 && dz < 0.8 && (pos[3 * j] - x) ** 2 + (pos[3 * j + 1] - y) ** 2 < cs * cs) { covered = true; break; }
        }
      }
      if (!covered) out.push(i);
    }
    return out;
  }

  /**
   * Mô hình mặt đất quanh (cx, cy): mặt phẳng RANSAC (bán kính GROUND_RADIUS) cộng bản đồ độ cao theo ô
   * GROUND_CELL. Mỗi ô lấy lớp điểm thấp dày nhất. Ô cao hơn hẳn các ô xung quanh (> GROUND_STEP) bị bỏ: thường
   * là vạch điểm thấp nhất trên thành xe khi dưới xe không thấy đất. Ô trống lấy trung bình các ô bên cạnh.
   * Nhờ vậy theo được dốc, gờ, lề đường mà một mặt phẳng không theo được. at(x, y): độ cao mặt đất.
   */
  function groundModel(pos, count, cx, cy, cfg = CFG) {
    const gr2 = cfg.GROUND_RADIUS * cfg.GROUND_RADIUS;
    const roi = [];
    for (let i = 0; i < count; i++) {
      const dx = pos[3 * i] - cx, dy = pos[3 * i + 1] - cy;
      if (dx * dx + dy * dy < gr2) roi.push(i);
    }
    if (!roi.length) return null;
    const plane = fitGround(pos, roi, cfg);
    const P = (x, y) => plane.a * x + plane.b * y + plane.c;
    const cs = cfg.GROUND_CELL;
    const cells = new Map();
    const near = roi.filter((i) => Math.abs(pos[3 * i + 2] - P(pos[3 * i], pos[3 * i + 1])) <= cfg.GROUND_CELL_TOL);
    for (const i of bareFilter(pos, near)) {
      const x = pos[3 * i], y = pos[3 * i + 1], r = pos[3 * i + 2] - P(x, y);
      const ix = Math.floor(x / cs), iy = Math.floor(y / cs), k = ix + ',' + iy;
      let c = cells.get(k);
      if (!c) cells.set(k, (c = { ix, iy, r: [] }));
      c.r.push(r);
    }
    const est = new Map(); // ô -> { ix, iy, v: độ cao lớp đất so với mặt RANSAC }
    for (const [k, c] of cells) {
      const v = lowestPeak(c.r, cfg);
      if (v == null) continue;
      est.set(k, { ix: c.ix, iy: c.iy, v: median(c.r.filter((r) => Math.abs(r - v) <= cfg.GROUND_LAYER)) });
    }
    const around = (ix, iy, rad) => {
      const out = [];
      for (let a = -rad; a <= rad; a++) for (let b = -rad; b <= rad; b++) {
        if (!a && !b) continue;
        const e = est.get(ix + a + ',' + (iy + b));
        if (e) out.push(e.v);
      }
      return out;
    };
    const drop = [];
    for (const [k, e] of est) {
      const nb = around(e.ix, e.iy, 2);
      if (nb.length < 3) continue;
      const d = e.v - median(nb);
      if (d > cfg.GROUND_STEP || d < -1.5 * cfg.GROUND_STEP) drop.push(k);
    }
    for (const k of drop) est.delete(k);
    const filled = new Map();
    const offset = (x, y) => {
      const ix = Math.floor(x / cs), iy = Math.floor(y / cs), k = ix + ',' + iy;
      const e = est.get(k);
      if (e) return e.v;
      if (filled.has(k)) return filled.get(k);
      let v = 0;
      for (const rad of [1, 2, 3]) {
        const nb = around(ix, iy, rad);
        if (nb.length) { v = nb.reduce((p, q) => p + q, 0) / nb.length; break; }
      }
      filled.set(k, v);
      return v;
    };
    return { ok: plane.ok || est.size > 0, plane, at: (x, y) => P(x, y) + offset(x, y), cells: est.size, dropped: drop.length };
  }

  // Lớp mặt đất trong tập điểm idx: đỉnh histogram z THẤP NHẤT đủ dày, rồi fit mặt phẳng (hoặc lấy
  // trung vị nếu điểm không trải đủ 2 chiều). Trả về { ok, z (tại x0,y0), a, b, n } hoặc null.
  function groundLayer(pos, idx, x0, y0, cfg) {
    const zPeak = lowestPeak(idx.map((i) => pos[3 * i + 2]), cfg);
    if (zPeak == null) return null;
    let a = 0, b = 0, c = zPeak, plane = false;
    let inl = idx.filter((i) => Math.abs(pos[3 * i + 2] - zPeak) <= cfg.GROUND_LAYER);
    for (let it = 0; it < 3 && inl.length >= cfg.GROUND_PEAK_MIN; it++) {
      const p = planeFit(pos, inl, x0, y0);
      // Mặt phẳng đi qua trọng tâm lớp đất; chỉ nhận khi dốc vừa phải và điểm trải đủ 2 chiều (không ngoại suy bừa).
      // Lần đầu dễ hơn (đường dốc: dải điểm quanh đỉnh thấp nhất chỉ là 1 vệt hẹp), các lần sau lấy lại cả lớp đất.
      if (p && Math.hypot(p.a, p.b) <= cfg.GROUND_MAX_SLOPE && p.spread >= (it === 0 ? 0.25 : 0.5)) {
        a = p.a; b = p.b; c = p.c; plane = true;
      } else {
        a = 0; b = 0; c = median(inl.map((i) => pos[3 * i + 2])); plane = false;
      }
      const next = idx.filter((i) =>
        Math.abs(pos[3 * i + 2] - (a * (pos[3 * i] - x0) + b * (pos[3 * i + 1] - y0) + c)) <= cfg.GROUND_LAYER);
      if (next.length < cfg.GROUND_PEAK_MIN) break;
      inl = next;
    }
    return { ok: true, z: c, a, b, n: inl.length, plane };
  }

  /**
   * Mặt đất ngay quanh khung đáy fp = { x, y, yaw, hl, hw } (tâm, góc, nửa dài, nửa rộng).
   * Chỉ lấy điểm trong vành quanh khung đáy: điểm bên trong khung là của chính vật (thành xe tạo các
   * vạch điểm dày theo z, dễ nhận nhầm là đất). Trong vành chỉ lấy điểm "trống phía trên" (bareFilter), nên
   * thành của vật khác nằm trong vành cũng không bị tính. Thiếu điểm thì nới vành x2, x4.
   * refZ: mặt đất theo bản đồ tại tâm; kết quả lệch quá GROUND_REF_TOL thì bỏ.
   */
  function localGround(pos, count, fp, cfg = CFG, refZ = null) {
    const c = Math.cos(fp.yaw || 0), s = Math.sin(fp.yaw || 0);
    const m0 = cfg.GROUND_NEAR, mMax = m0 * 4;
    const ex = fp.hl + 0.05, ey = fp.hw + 0.05;
    const R2 = (Math.hypot(fp.hl, fp.hw) + mMax * Math.SQRT2) ** 2;
    const ring = []; // [độ nới cần để chứa điểm, chỉ số điểm]
    for (let i = 0; i < count; i++) {
      const dx = pos[3 * i] - fp.x, dy = pos[3 * i + 1] - fp.y;
      if (dx * dx + dy * dy > R2) continue;
      const u = Math.abs(dx * c + dy * s), v = Math.abs(-dx * s + dy * c);
      if (u <= ex && v <= ey) continue;
      const need = Math.max(u - fp.hl, v - fp.hw);
      if (need <= mMax) ring.push(need, i);
    }
    const all = [];
    for (let k = 1; k < ring.length; k += 2) all.push(ring[k]);
    const bare = new Set(bareFilter(pos, all));
    for (const m of [m0, m0 * 2, mMax]) {
      const idx = [];
      for (let k = 0; k < ring.length; k += 2) if (ring[k] <= m && bare.has(ring[k + 1])) idx.push(ring[k + 1]);
      const g = groundLayer(pos, idx, fp.x, fp.y, cfg);
      if (g && (refZ == null || Math.abs(g.z - refZ) <= cfg.GROUND_REF_TOL)) { g.margin = m; return g; }
    }
    return { ok: false };
  }

  // Mặt đất dưới khung đáy fp: lớp đất cục bộ (localGround), không được thì bản đồ mặt đất (groundModel).
  // model: groundModel đã tính (nếu có). Trả về { ok, z (tại tâm), a, b (độ dốc theo x, y), src: 'local' | 'map' }.
  function groundAt(pos, count, fp, cfg = CFG, model = null) {
    if (!model) model = groundModel(pos, count, fp.x, fp.y, cfg);
    const ref = model && model.ok ? model.at(fp.x, fp.y) : null;
    const g = localGround(pos, count, fp, cfg, ref);
    if (g.ok) { g.src = 'local'; return g; }
    if (ref != null) return { ok: true, z: ref, a: model.plane.a, b: model.plane.b, src: 'map' };
    return { ok: false, src: 'none' };
  }

  // z tâm để đáy cuboid (points CVAT) nằm trên mặt đất ngay dưới nó; null nếu không ước lượng được
  function snapZ(pos, count, pts, cfg = CFG) {
    const g = groundAt(pos, count, { x: pts[0], y: pts[1], yaw: pts[5], hl: pts[6] / 2, hw: pts[7] / 2 }, cfg);
    return g.ok ? g.z + pts[8] / 2 : null;
  }

  // Gom cụm bắt đầu từ các điểm hạt giống, dùng lưới băm kích thước eps.
  // opts.zWeight: trọng số trục z (mặc định cfg.Z_WEIGHT).
  // opts.coreMin: điểm không phải hạt giống chỉ lan tiếp khi có >= coreMin hàng xóm (kiểu DBSCAN; mặc định 1 = lan hết).
  // opts.center/maxR: không nhận điểm xa hơn maxR (theo xy) tính từ center.
  function growCluster(pos, cand, seeds, eps, cfg, opts = {}) {
    const zw = opts.zWeight || cfg.Z_WEIGHT, coreMin = opts.coreMin || 1;
    const center = opts.center, maxR2 = opts.maxR ? opts.maxR * opts.maxR : Infinity;
    const seedSet = new Set(seeds);
    const inv = 1 / eps, eps2 = eps * eps;
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
      const nb = [];
      let nbCount = 0;
      for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) for (let dc = -1; dc <= 1; dc++) {
        const arr = grid.get(a + da + ',' + (b + db) + ',' + (c + dc));
        if (!arr) continue;
        for (const j of arr) {
          if (j === i) continue;
          const dx = pos[3 * j] - xi, dy = pos[3 * j + 1] - yi, dz = (pos[3 * j + 2] - zi) * zw;
          if (dx * dx + dy * dy + dz * dz > eps2) continue;
          nbCount++;
          if (!visited.has(j)) nb.push(j);
        }
      }
      // Điểm biên (ít hàng xóm) vẫn thuộc cụm nhưng không lan tiếp
      if (nbCount < coreMin && !seedSet.has(i)) continue;
      for (const j of nb) {
        if (visited.has(j)) continue;
        const x = pos[3 * j], y = pos[3 * j + 1], z = pos[3 * j + 2];
        if (center && (x - center[0]) ** 2 + (y - center[1]) ** 2 > maxR2) { truncated = true; continue; }
        if (Math.max(ext[1], x) - Math.min(ext[0], x) > cfg.MAX_L ||
            Math.max(ext[3], y) - Math.min(ext[2], y) > cfg.MAX_L ||
            Math.max(ext[5], z) - Math.min(ext[4], z) > cfg.MAX_H) { truncated = true; continue; }
        visited.add(j);
        addExt(j);
        out.push(j);
        queue.push(j);
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

  // Mô hình mặt đất quanh (cx, cy) và các điểm KHÔNG phải đất trong bán kính ROI_RADIUS: điểm cao hơn mặt đất
  // ngay dưới nó (bản đồ mặt đất theo ô) không quá GROUND_CLEAR bị bỏ, không bao giờ được gom vào cụm.
  function prepare(pos, count, cx, cy, cfg) {
    const ground = groundModel(pos, count, cx, cy, cfg);
    if (!ground) throw new Error('Không có điểm nào quanh cuboid.');
    const r2 = cfg.ROI_RADIUS * cfg.ROI_RADIUS;
    const cand = [];
    for (let i = 0; i < count; i++) {
      const x = pos[3 * i], y = pos[3 * i + 1];
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const h = pos[3 * i + 2] - ground.at(x, y);
      if (h > cfg.GROUND_CLEAR && h < cfg.MAX_H + 0.5) cand.push(i);
    }
    return { ground, cand };
  }

  // Từ cụm điểm idx tính hộp [x,y,z, 0,0,yaw, L,W,H]. o: { cfg, prior, sensor, range, notes, rz (yaw tham
  // chiếu), dims (kích thước cuboid thô, dùng khi quá ít điểm), ground (RANSAC), hasRough }.
  function boxFromCluster(pos, count, idx, cand, o) {
    const { cfg, prior, sensor, range, notes, rz, ground } = o;
    const [sx, sy, sz] = o.dims;
    const n = idx.length;
    const xs = idx.map((i) => pos[3 * i]), ys = idx.map((i) => pos[3 * i + 1]);
    let zmax = -Infinity;
    for (const i of idx) zmax = Math.max(zmax, pos[3 * i + 2]);

    const sparse = n < cfg.MIN_POINTS_FIT;
    if (sparse) notes.push(`chỉ ${n} điểm: ` + (o.hasRough ? 'giữ hướng cuboid thô' : 'không tự tìm hướng') + (prior ? ', dùng kích thước mặc định' : ''));

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
    // Chọn chiều (±180°) gần yaw tham chiếu nhất
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

    // Đáy: mặt đất ngay quanh khung đáy (mức thấp có nhiều điểm trùng nhau nhất), không được thì mặt RANSAC
    const g = groundAt(pos, count, { x: cx, y: cy, yaw, hl: (hiL - loL) / 2, hw: (hiW - loW) / 2 }, cfg, ground);
    const bottom = g.ok ? g.z : ground.at(cx, cy);
    // Chiều cao: thêm các điểm rời rạc nằm trong khung đáy (vd. tia quét trúng nóc xe ở xa hơn mặt bên),
    // chỉ nhận điểm cao hơn đỉnh hiện tại tối đa 1 khoảng hở giữa 2 tia (cộng dồn từng bước).
    let top = zmax;
    const gap = Math.max(0.3, range * Math.tan((1.6 * Math.PI) / 180));
    const inFoot = [];
    for (const i of cand) {
      const a = pos[3 * i] * uL[0] + pos[3 * i + 1] * uL[1], b = pos[3 * i] * uW[0] + pos[3 * i + 1] * uW[1];
      if (a >= loL - 0.05 && a <= hiL + 0.05 && b >= loW - 0.05 && b <= hiW + 0.05) inFoot.push(pos[3 * i + 2]);
    }
    inFoot.sort((p, q) => p - q);
    for (const z of inFoot) if (z > top && z <= top + gap) top = z;
    const measuredH = top - bottom;
    const m = cfg.FIT_MARGIN || 0;
    // Khoảng hở m ở mỗi mặt bên và mặt trên; đáy giữ trên mặt đất
    const H = Math.max(cfg.MIN_SIZE, target(measuredH, prior && prior.H, sz)) + m;
    return {
      box: [cx, cy, bottom + H / 2, 0, 0, yaw, hiL - loL + 2 * m, hiW - loW + 2 * m, H],
      measured: { L: dL, W: dW, H: measuredH },
      groundSrc: g.ok ? g.src : 'map',
    };
  }

  // Hướng hình chữ nhật (L-shape) của các điểm idx, chọn trong các hướng cách nhau 90° hướng gần ref nhất
  // (giữ nguyên trục nào là L, trục nào là W)
  function yawNear(pos, idx, ref) {
    const th = lshapeTheta(idx.map((i) => pos[3 * i]), idx.map((i) => pos[3 * i + 1]));
    let yaw = ref, bestD = Infinity;
    for (let k = -4; k <= 4; k++) {
      const c = normAngle(th + (k * Math.PI) / 2), d = Math.abs(normAngle(c - ref));
      if (d < bestD) { bestD = d; yaw = c; }
    }
    return yaw;
  }

  /**
   * Giữ nguyên kích thước và góc (cuboid dạng track): dời cuboid tới chỗ chứa nhiều điểm của cụm nhất.
   * Trong các chỗ chứa nhiều điểm nhất, lấy chỗ gần tâm cũ nhất; rồi đặt mặt nhìn thấy (phía LiDAR) sát
   * điểm, mặt khuất kéo ra xa (thấy mỗi đuôi xe thì thân xe vẫn đủ dài về phía trước).
   * box: points CVAT. moveAxes: trục local được dời (0 = L, 1 = W). Trả về { dx, dy (world), inside }.
   */
  function placeFixed(pos, idx, box, moveAxes, cfg = CFG, sensor = [0, 0, 0]) {
    const px = box[0], py = box[1], c = Math.cos(box[5]), s = Math.sin(box[5]);
    const mv = [moveAxes.includes(0), moveAxes.includes(1)];
    if (!idx.length || (!mv[0] && !mv[1])) return { dx: 0, dy: 0, inside: idx.length };
    const m = cfg.FIT_MARGIN || 0;
    // Phần bên trong khoảng hở: điểm nằm trong, cách mặt cuboid FIT_MARGIN
    const size = [box[6], box[7]].map((S) => (S - 2 * m >= cfg.MIN_SIZE ? S - 2 * m : S));
    const loc = idx.map((i) => {
      const dx = pos[3 * i] - px, dy = pos[3 * i + 1] - py;
      return [dx * c + dy * s, -dx * s + dy * c];
    });
    const sdx = sensor[0] - px, sdy = sensor[1] - py;
    const sl = [sdx * c + sdy * s, -sdx * s + sdy * c];
    // Cửa sổ kích thước size chứa nhiều điểm nhất: lưới g + tổng tiền tố 2D
    const g = 0.05, lo = [0, 0], n = [1, 1], w = [1, 1];
    for (let k = 0; k < 2; k++) {
      if (!mv[k]) continue;
      let a = Infinity, b = -Infinity;
      for (const p of loc) { if (p[k] < a) a = p[k]; if (p[k] > b) b = p[k]; }
      lo[k] = a;
      n[k] = Math.floor((b - a) / g) + 1;
      w[k] = Math.max(1, Math.round(size[k] / g));
    }
    const cellOf = (p, k) => (mv[k] ? Math.min(n[k] - 1, Math.floor((p[k] - lo[k]) / g)) : 0);
    const N = n[1] + 1;
    const S = new Int32Array((n[0] + 1) * N);
    for (const p of loc) S[(cellOf(p, 0) + 1) * N + cellOf(p, 1) + 1]++;
    for (let a = 1; a <= n[0]; a++) for (let b = 1; b <= n[1]; b++) {
      S[a * N + b] += S[(a - 1) * N + b] + S[a * N + b - 1] - S[(a - 1) * N + b - 1];
    }
    const countAt = (a0, b0) => {
      const a1 = Math.min(n[0], a0 + w[0]), b1 = Math.min(n[1], b0 + w[1]);
      const A0 = Math.max(0, a0), B0 = Math.max(0, b0);
      if (a1 <= A0 || b1 <= B0) return 0;
      return S[a1 * N + b1] - S[A0 * N + b1] - S[a1 * N + B0] + S[A0 * N + B0];
    };
    let best = -1, bestD = Infinity, ba = 0, bb = 0;
    for (let a = mv[0] ? 1 - w[0] : 0; a <= (mv[0] ? n[0] - 1 : 0); a++) {
      for (let b = mv[1] ? 1 - w[1] : 0; b <= (mv[1] ? n[1] - 1 : 0); b++) {
        const cnt = countAt(a, b);
        if (cnt < best) continue;
        const cu = mv[0] ? lo[0] + (a + w[0] / 2) * g : 0, cv = mv[1] ? lo[1] + (b + w[1] / 2) * g : 0;
        const d = cu * cu + cv * cv;
        if (cnt > best || d < bestD) { best = cnt; bestD = d; ba = a; bb = b; }
      }
    }
    const inl = loc.filter((p) => (!mv[0] || (cellOf(p, 0) >= ba && cellOf(p, 0) < ba + w[0])) &&
      (!mv[1] || (cellOf(p, 1) >= bb && cellOf(p, 1) < bb + w[1])));
    const off = [0, 0];
    for (let k = 0; k < 2; k++) {
      if (!mv[k] || !inl.length) continue;
      let a = Infinity, b = -Infinity;
      for (const p of inl) { if (p[k] < a) a = p[k]; if (p[k] > b) b = p[k]; }
      const [e0, e1] = extendAway(a, b, sl[k], size[k]);
      off[k] = (e0 + e1) / 2;
    }
    return { dx: off[0] * c - off[1] * s, dy: off[0] * s + off[1] * c, inside: inl.length };
  }

  /**
   * Cụm điểm của vật cho cuboid dạng track (biết sẵn kích thước). Gom chặt (như Ctrl+click) từ các hạt giống,
   * chỉ giữ cụm vừa với kích thước cuboid (bỏ hàng rào, tường dài dù chúng dày điểm hơn), lấy cụm có điểm cao
   * nhất (nhiều điểm, gần tâm cuboid), rồi ghép thêm các mảnh khác của vật (nóc, đầu xe...) miễn tổng vẫn vừa cuboid.
   */
  function trackCluster(pos, cand, seeds, box, range, cfg, labelName) {
    const px = box[0], py = box[1], c = Math.cos(box[5]), s = Math.sin(box[5]), L = box[6], W = box[7];
    const eps = Math.min(cfg.PICK_EPS_MAX, Math.max(cfg.PICK_EPS_MIN, cfg.PICK_EPS_MIN + cfg.PICK_EPS_PER_M * range));
    const classPrior = findPrior(labelName);
    const reach = Math.max(classPrior ? cfg.CLASS_REACH * classPrior.L + 0.5 : cfg.PICK_REACH, Math.hypot(L, W));
    const taken = new Set(), clusters = [];
    for (const s0 of seeds) {
      if (taken.has(s0)) continue;
      const g = growCluster(pos, cand, [s0], eps, cfg, {
        zWeight: cfg.PICK_Z_WEIGHT, coreMin: cfg.PICK_CORE_MIN, center: [pos[3 * s0], pos[3 * s0 + 1]], maxR: reach,
      });
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity, mx = 0, my = 0;
      for (const i of g.idx) {
        taken.add(i);
        const dx = pos[3 * i] - px, dy = pos[3 * i + 1] - py, u = dx * c + dy * s, v = -dx * s + dy * c;
        a0 = Math.min(a0, u); a1 = Math.max(a1, u); b0 = Math.min(b0, v); b1 = Math.max(b1, v);
        mx += pos[3 * i]; my += pos[3 * i + 1];
      }
      const n = g.idx.length;
      clusters.push({ idx: g.idx, n, a0, a1, b0, b1, mx: mx / n, my: my / n });
    }
    const compact = clusters.filter((k) => k.a1 - k.a0 <= 1.2 * L + 0.5 && k.b1 - k.b0 <= 1.2 * W + 0.5);
    const pool = compact.length ? compact : clusters;
    const score = (k) => k.n / (1 + (k.mx - px) ** 2 + (k.my - py) ** 2);
    pool.sort((p, q) => score(q) - score(p));
    const main = pool[0];
    let idx = main.idx.slice(), A0 = main.a0, A1 = main.a1, B0 = main.b0, B1 = main.b1;
    if (compact.length) {
      const rest = compact.slice(1).sort((p, q) =>
        (p.mx - main.mx) ** 2 + (p.my - main.my) ** 2 - (q.mx - main.mx) ** 2 - (q.my - main.my) ** 2);
      for (const k of rest) {
        const n0 = Math.min(A0, k.a0), n1 = Math.max(A1, k.a1), m0 = Math.min(B0, k.b0), m1 = Math.max(B1, k.b1);
        if (n1 - n0 > L + 0.3 || m1 - m0 > W + 0.3) continue;
        A0 = n0; A1 = n1; B0 = m0; B1 = m1;
        for (const i of k.idx) idx.push(i);
      }
    }
    return { idx, eps, compact: compact.length > 0 };
  }

  /**
   * Đổi kích thước cuboid p (points CVAT) sang dims [L, W, H]: theo L và W giữ mặt nhìn thấy (phía LiDAR),
   * nới/thu mặt khuất; LiDAR nằm giữa 2 mặt thì nới đều 2 bên. Đáy giữ nguyên độ cao. Dùng khi đổi kích thước
   * 1 keyframe của track rồi áp cho mọi keyframe khác.
   */
  function resizeKeepVisible(p, dims, sensor = [0, 0, 0]) {
    const q = p.slice();
    const c = Math.cos(p[5]), s = Math.sin(p[5]);
    const axes = [[c, s], [-s, c]];
    for (let k = 0; k < 2; k++) {
      const S0 = p[6 + k], S1 = dims[k], u = axes[k];
      if (Math.abs(S1 - S0) < 1e-9) continue;
      const sl = (sensor[0] - p[0]) * u[0] + (sensor[1] - p[1]) * u[1];
      let shift = 0;
      if (sl <= -S0 / 2) shift = (S1 - S0) / 2;      // LiDAR ở phía mặt "âm": giữ mặt đó
      else if (sl >= S0 / 2) shift = -(S1 - S0) / 2; // LiDAR ở phía mặt "dương": giữ mặt đó
      q[0] += shift * u[0];
      q[1] += shift * u[1];
      q[6 + k] = S1;
    }
    q[2] = p[2] - p[8] / 2 + dims[2] / 2;
    q[8] = dims[2];
    return q;
  }

  // Track: giữ L, W, H và góc của box, chỉ dời tới chỗ nhiều điểm nhất của cụm idx, đáy đặt trên mặt đất
  function moveOnly(pos, count, box, idx, ground, cfg, sensor, notes) {
    const pl = placeFixed(pos, idx, box, [0, 1], cfg, sensor);
    const points = box.slice();
    points[0] += pl.dx; points[1] += pl.dy;
    const g = groundAt(pos, count, { x: points[0], y: points[1], yaw: points[5], hl: points[6] / 2, hw: points[7] / 2 }, cfg, ground);
    if (g.ok) points[2] = g.z + points[8] / 2;
    else notes.push('không đặt được đáy lên mặt đất');
    notes.push('track: giữ nguyên kích thước, chỉ dời chỗ');
    if (pl.inside < idx.length) notes.push(`cuboid chứa ${pl.inside}/${idx.length} điểm của cụm`);
    return { points, groundSrc: g.ok ? g.src : 'none' };
  }

  /**
   * Phím G: fit cuboid theo cụm điểm quanh cuboid thô (cách gom như bản đầu, bắt trọn ô tô).
   * pos: Float32Array xyz, rough: points của cuboid CVAT [x,y,z, rx,ry,rz, L,W,H, ...].
   * opts.keepSize (cuboid dạng track): giữ kích thước và góc, chỉ dời tới chỗ nhiều điểm nhất.
   * Trả về { points, info } hoặc ném Error.
   */
  function fitCuboid(pos, count, rough, labelName, cfg = CFG, sensor = [0, 0, 0], opts = {}) {
    const [px, py, pz, rx, ry, rz, sx, sy, sz] = rough;
    const R = rotMat(rx, ry, rz);
    const notes = [];
    const { ground, cand } = prepare(pos, count, px, py, cfg);
    if (!ground.plane.ok) notes.push('mặt đất ước lượng thô');

    // Hạt giống: điểm nằm trong cuboid thô (đã nới SEED_PAD; track: nới thêm TRACK_SEARCH)
    const pad = cfg.SEED_PAD + (opts.keepSize ? cfg.TRACK_SEARCH : 0);
    const hx = sx / 2 + pad, hy = sy / 2 + pad, hz = sz / 2 + pad;
    const seeds = cand.filter((i) => {
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
    const rs = Math.max(cfg.SEED_SEARCH, classPrior ? classPrior.L / 2 + 0.5 : 0, Math.max(sx, sy) / 2 + pad);
    const r2s = rs * rs;
    const seedSet = new Set(seeds);
    for (const i of cand) {
      const dx = pos[3 * i] - px, dy = pos[3 * i + 1] - py;
      if (dx * dx + dy * dy < r2s) seedSet.add(i);
    }
    if (!seedSet.size) throw new Error('Không có điểm nào (ngoài mặt đất) trong hoặc gần cuboid thô. Đặt cuboid lên vật rồi bấm lại.');

    const range = Math.hypot(px - sensor[0], py - sensor[1]);
    if (opts.keepSize) {
      // Track: gom chặt, chỉ lấy cụm vừa kích thước track, rồi dời cuboid (không đổi kích thước)
      const seedList = [...seedSet].sort((i, j) =>
        (pos[3 * i] - px) ** 2 + (pos[3 * i + 1] - py) ** 2 - (pos[3 * j] - px) ** 2 - (pos[3 * j + 1] - py) ** 2);
      const tc = trackCluster(pos, cand, seedList, rough, range, cfg, labelName);
      if (!tc.compact) notes.push('không có cụm nào vừa kích thước track: dùng cụm gần nhất');
      const r = moveOnly(pos, count, rough, tc.idx, ground, cfg, sensor, notes);
      return {
        points: r.points,
        info: { n: tc.idx.length, eps: tc.eps, range, ground, groundSrc: r.groundSrc, notes, measured: null, prior, idx: tc.idx, seeds: seedSet.size },
      };
    }
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

    const b = boxFromCluster(pos, count, idx, cand, {
      cfg, prior, sensor, range, notes, rz, dims: [sx, sy, sz], ground, hasRough: true,
    });
    const points = rough.slice();
    for (let k = 0; k < 9; k++) points[k] = b.box[k];
    return {
      points,
      info: { n: idx.length, eps, range, ground, groundSrc: b.groundSrc, notes, measured: b.measured, prior, idx, seeds: seedSet.size },
    };
  }

  /**
   * Ctrl + click: fit cuboid quanh vật chạm tới điểm `point` [x,y,z]. Gom chặt: khoảng gom nhỏ, điểm phải
   * đủ hàng xóm mới lan tiếp, không lan xa hơn kích thước class.
   * rough: cuboid đang chọn (giữ hướng ±180° và các giá trị khác) hoặc null để tạo cuboid mới.
   * opts.keepSize (cuboid đang chọn dạng track): giữ kích thước và góc, chỉ dời tới chỗ nhiều điểm nhất.
   */
  function fitAtPoint(pos, count, point, rough, labelName, cfg = CFG, sensor = [0, 0, 0], opts = {}) {
    const notes = [];
    const { ground, cand } = prepare(pos, count, point[0], point[1], cfg);
    if (!ground.plane.ok) notes.push('mặt đất ước lượng thô');
    // Điểm của vật (không phải đất) gần điểm bấm nhất
    let seed = -1, best = cfg.PICK_SEED_MAX * cfg.PICK_SEED_MAX;
    for (const i of cand) {
      const d = (pos[3 * i] - point[0]) ** 2 + (pos[3 * i + 1] - point[1]) ** 2 + (pos[3 * i + 2] - point[2]) ** 2;
      if (d <= best) { best = d; seed = i; }
    }
    if (seed < 0) throw new Error('Chỗ vừa bấm chỉ có mặt đất. Ctrl+click trúng vào vật.');
    const range = Math.hypot(pos[3 * seed] - sensor[0], pos[3 * seed + 1] - sensor[1]);
    const eps = Math.min(cfg.PICK_EPS_MAX, Math.max(cfg.PICK_EPS_MIN, cfg.PICK_EPS_MIN + cfg.PICK_EPS_PER_M * range));
    const classPrior = findPrior(labelName);
    const prior = cfg.USE_PRIOR ? classPrior : null;
    const reach = classPrior ? cfg.CLASS_REACH * classPrior.L + 0.5 : cfg.PICK_REACH;
    const g = growCluster(pos, cand, [seed], eps, cfg, {
      zWeight: cfg.PICK_Z_WEIGHT, coreMin: cfg.PICK_CORE_MIN, center: [pos[3 * seed], pos[3 * seed + 1]], maxR: reach,
    });
    if (g.truncated) notes.push(`cụm bị cắt ở ${reach.toFixed(1)} m quanh điểm bấm: có thể dính vật bên cạnh`);
    if (opts.keepSize && rough) {
      const r = moveOnly(pos, count, rough, g.idx, ground, cfg, sensor, notes);
      return { points: r.points, info: { n: g.idx.length, eps, range, reach, notes, measured: null, idx: g.idx, seed, groundSrc: r.groundSrc } };
    }
    // Kích thước luôn lấy theo điểm đo được (không dùng kích thước cuboid đang chọn)
    const b = boxFromCluster(pos, count, g.idx, cand, {
      cfg, prior, sensor, range, notes, rz: rough ? rough[5] : 0, dims: [0, 0, 0], ground, hasRough: !!rough,
    });
    const points = rough ? rough.slice() : new Array(16).fill(0);
    for (let k = 0; k < 9; k++) points[k] = b.box[k];
    return {
      points,
      info: { n: g.idx.length, eps, range, reach, notes, measured: b.measured, idx: g.idx, seed, groundSrc: b.groundSrc },
    };
  }

  /**
   * Gom lại trên mặt phẳng 2D của một view (Top/Side/Front) rồi fit 2 trục của view đó.
   * box: points của cuboid hiện tại. axes: 2 trục local [0=L,1=W,2=H] hiện trên view.
   * Trục còn lại (chiều sâu) giữ nguyên. opts.refineYaw (view Top): tìm lại góc xoay theo cụm đã gom.
   * opts.snapGround (view Top): đặt lại đáy lên mặt đất tại tâm mới. Trả về { points, info } hoặc ném Error.
   */
  function refine2D(pos, count, box, axes, cfg = CFG, sensor = [0, 0, 0], opts = {}) {
    const [px, py, pz, rx, ry, rz, sx, sy, sz] = box;
    const R = rotMat(rx, ry, rz);
    const half = [sx / 2, sy / 2, sz / 2];
    const [ka, kb] = axes;
    const kd = [0, 1, 2].find((k) => k !== ka && k !== kb);
    const vertical = Math.abs(R[2][2]) > 0.9 ? 2 : -1; // trục H có đứng thẳng không
    const notes = [];

    const g0 = groundAt(pos, count, { x: px, y: py, yaw: rz, hl: half[0], hw: half[1] }, cfg);
    if (!g0.ok) throw new Error('Không ước lượng được mặt đất quanh cuboid.');
    const gz = (x, y) => g0.z + g0.a * (x - px) + g0.b * (y - py);

    // Điểm (không phải đất) trong cuboid nới thêm REFINE_PAD, đổi sang toạ độ local
    const pad = [0, 0, 0];
    pad[ka] = cfg.REFINE_PAD; pad[kb] = cfg.REFINE_PAD; pad[kd] = cfg.REFINE_DEPTH_PAD;
    const reach2 = (half[0] + pad[0]) ** 2 + (half[1] + pad[1]) ** 2 + (half[2] + pad[2]) ** 2;
    const pts = []; // [u, v, i]
    for (let i = 0; i < count; i++) {
      const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
      const dx = x - px, dy = y - py, dz = z - pz;
      if (dx * dx + dy * dy + dz * dz > reach2) continue;
      if (z - gz(x, y) <= cfg.GROUND_CLEAR) continue;
      const l = [0, 1, 2].map((k) => R[0][k] * dx + R[1][k] * dy + R[2][k] * dz);
      if (Math.abs(l[0]) > half[0] + pad[0] || Math.abs(l[1]) > half[1] + pad[1] || Math.abs(l[2]) > half[2] + pad[2]) continue;
      pts.push([l[ka], l[kb], i]);
    }
    if (pts.length < 3) throw new Error('Quá ít điểm trong cuboid để gom lại.');

    const range = Math.hypot(px - sensor[0], py - sensor[1]);
    const eps = Math.min(cfg.REFINE_EPS_MAX, Math.max(cfg.REFINE_EPS_MIN, cfg.REFINE_EPS_MIN + cfg.REFINE_EPS_PER_M * range));
    const ringGap = range * Math.tan((1.6 * Math.PI) / 180);
    // Trục đứng: nối qua khoảng hở giữa 2 tia và khoảng kính xe (tia xuyên qua kính, thân và nóc rời nhau)
    const link = (k) => (k === vertical ? Math.max(eps, 1.5 * ringGap, cfg.REFINE_VGAP) : eps);

    // DBSCAN 2D (khoảng cách chuẩn hoá theo link của từng trục): điểm "dày" có >= REFINE_MIN_PTS
    // hàng xóm, chỉ điểm dày được lan tiếp; điểm lẻ không có hàng xóm dày nào bị bỏ.
    // Chọn cụm có điểm cao nhất: số điểm / (1 + khoảng cách² trọng tâm cụm -> tâm cuboid).
    const la = link(ka), lb = link(kb);
    const key = (a, b) => a + ',' + b;
    const grid = new Map();
    pts.forEach((p, n) => {
      const k = key(Math.floor(p[0] / la), Math.floor(p[1] / lb));
      let arr = grid.get(k);
      if (!arr) grid.set(k, (arr = []));
      arr.push(n);
    });
    const nbs = pts.map((p) => {
      const a = Math.floor(p[0] / la), b = Math.floor(p[1] / lb), out = [];
      for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) {
        const arr = grid.get(key(a + da, b + db));
        if (!arr) continue;
        for (const j of arr) {
          const du = (pts[j][0] - p[0]) / la, dv = (pts[j][1] - p[1]) / lb;
          if (pts[j] !== p && du * du + dv * dv <= 1) out.push(j);
        }
      }
      return out;
    });
    const isCore = nbs.map((l) => l.length >= cfg.REFINE_MIN_PTS);
    const done = new Uint8Array(pts.length);
    let best = null;
    for (let s = 0; s < pts.length; s++) {
      if (!isCore[s] || done[s]) continue;
      done[s] = 1;
      const comp = [s], queue = [s];
      while (queue.length) {
        const n = queue.pop();
        if (!isCore[n]) continue;
        for (const j of nbs[n]) {
          if (done[j]) continue;
          done[j] = 1;
          comp.push(j); queue.push(j);
        }
      }
      let mu = 0, mv = 0;
      for (const n of comp) { mu += pts[n][0]; mv += pts[n][1]; }
      mu /= comp.length; mv /= comp.length;
      const score = comp.length / (1 + mu * mu + mv * mv);
      if (!best || score > best.score) best = { comp, score };
    }
    if (!best) throw new Error('Không có vùng điểm nào đủ dày trong cuboid.');
    const kept = [];
    let loA = Infinity, hiA = -Infinity, loB = Infinity, hiB = -Infinity;
    for (const n of best.comp) {
      const p = pts[n];
      kept.push(p[2]);
      loA = Math.min(loA, p[0]); hiA = Math.max(hiA, p[0]);
      loB = Math.min(loB, p[1]); hiB = Math.max(hiB, p[1]);
    }
    if (kept.length < pts.length) notes.push(`bỏ ${pts.length - kept.length} điểm thưa/rời`);

    const m = cfg.FIT_MARGIN || 0;
    const points = box.slice();
    const topView = kd === 2 && vertical === 2;
    const canYaw = opts.refineYaw && topView && kept.length >= cfg.MIN_POINTS_FIT;
    if (opts.keepSize) {
      // Track: giữ L, W, H; chỉ dời (Shift+G ở view Top: xoay lại nữa) tới chỗ có nhiều điểm dày nhất
      if (canYaw) {
        points[5] = yawNear(pos, kept, rz);
        notes.push(`hướng ${((rz * 180) / Math.PI).toFixed(1)}° → ${((points[5] * 180) / Math.PI).toFixed(1)}°`);
      } else if (opts.refineYaw) notes.push('ít điểm hoặc không phải view Top: giữ góc xoay');
      const pl = placeFixed(pos, kept, points, axes.filter((k) => k !== vertical && k < 2), cfg, sensor);
      points[0] += pl.dx; points[1] += pl.dy;
      if (vertical >= 0 && axes.includes(vertical)) points[2] = gz(points[0], points[1]) + points[8] / 2;
      notes.push('track: giữ nguyên kích thước, chỉ dời chỗ');
      if (pl.inside < kept.length) notes.push(`cuboid chứa ${pl.inside}/${kept.length} điểm dày`);
    } else if (canYaw) {
      // Tìm lại hướng trên cụm đã gom (L-shape), chọn hướng gần yaw hiện tại nhất (giữ trục L/W)
      const xs = kept.map((i) => pos[3 * i]), ys = kept.map((i) => pos[3 * i + 1]);
      const yaw = yawNear(pos, kept, rz);
      const e1 = [Math.cos(yaw), Math.sin(yaw)], e2 = [-Math.sin(yaw), Math.cos(yaw)];
      let lo1 = Infinity, hi1 = -Infinity, lo2 = Infinity, hi2 = -Infinity;
      for (let k = 0; k < xs.length; k++) {
        const a = xs[k] * e1[0] + ys[k] * e1[1], b = xs[k] * e2[0] + ys[k] * e2[1];
        lo1 = Math.min(lo1, a); hi1 = Math.max(hi1, a); lo2 = Math.min(lo2, b); hi2 = Math.max(hi2, b);
      }
      lo1 -= m; hi1 += m; lo2 -= m; hi2 += m;
      const m1 = (lo1 + hi1) / 2, m2 = (lo2 + hi2) / 2;
      points[0] = m1 * e1[0] + m2 * e2[0];
      points[1] = m1 * e1[1] + m2 * e2[1];
      points[5] = yaw;
      points[6] = Math.max(cfg.MIN_SIZE, hi1 - lo1);
      points[7] = Math.max(cfg.MIN_SIZE, hi2 - lo2);
      notes.push(`hướng ${((rz * 180) / Math.PI).toFixed(1)}° → ${((yaw * 180) / Math.PI).toFixed(1)}°`);
    } else {
      if (opts.refineYaw) notes.push('ít điểm hoặc không phải view Top: giữ góc xoay');
      const ext = { [ka]: [loA - m, hiA + m], [kb]: [loB - m, hiB + m] };
      // Tâm mới theo các trục ngang trước, để tính mặt đất dưới tâm
      const c = [px, py, pz];
      for (const k of axes) {
        if (k === vertical) continue;
        const mid = (ext[k][0] + ext[k][1]) / 2;
        for (let r = 0; r < 3; r++) c[r] += mid * R[r][k];
      }
      if (vertical >= 0 && axes.includes(vertical)) {
        // Đáy đặt trên mặt đất (không thêm khoảng hở dưới đất), đỉnh + khoảng hở
        const g = gz(c[0], c[1]) - pz;
        if (g < ext[vertical][1]) ext[vertical][0] = g;
        else notes.push('không đặt được đáy lên mặt đất');
        const mid = (ext[vertical][0] + ext[vertical][1]) / 2;
        for (let r = 0; r < 3; r++) c[r] += mid * R[r][vertical];
      }
      points[0] = c[0]; points[1] = c[1]; points[2] = c[2];
      for (const k of axes) points[6 + k] = Math.max(cfg.MIN_SIZE, ext[k][1] - ext[k][0]);
    }
    if (opts.snapGround && topView) {
      const z = gz(points[0], points[1]) + points[8] / 2;
      if (Math.abs(z - points[2]) > 0.005) notes.push('đặt lại đáy sát mặt đất');
      points[2] = z;
    }
    return { points, info: { n: kept.length, total: pts.length, idx: kept, axes, eps, range, notes, groundSrc: g0.src } };
  }

  // ---------------------------------------------------------- camera math
  // Ma trận 4x4 lưu theo cột như three.js: phần tử (hàng r, cột c) ở vị trí c*4 + r.
  function mul4(A, B) {
    const C = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += A[k * 4 + r] * B[c * 4 + k];
      C[c * 4 + r] = s;
    }
    return C;
  }

  function inv4(a) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det || !isFinite(det)) return null;
    const k = 1 / det;
    return [
      (a11 * b11 - a12 * b10 + a13 * b09) * k, (a02 * b10 - a01 * b11 - a03 * b09) * k,
      (a31 * b05 - a32 * b04 + a33 * b03) * k, (a22 * b04 - a21 * b05 - a23 * b03) * k,
      (a12 * b08 - a10 * b11 - a13 * b07) * k, (a00 * b11 - a02 * b08 + a03 * b07) * k,
      (a32 * b02 - a30 * b05 - a33 * b01) * k, (a20 * b05 - a22 * b02 + a23 * b01) * k,
      (a10 * b10 - a11 * b08 + a13 * b06) * k, (a01 * b08 - a00 * b10 - a03 * b06) * k,
      (a30 * b04 - a31 * b02 + a33 * b00) * k, (a21 * b02 - a20 * b04 - a23 * b00) * k,
      (a11 * b07 - a10 * b09 - a12 * b06) * k, (a00 * b09 - a01 * b07 + a02 * b06) * k,
      (a31 * b01 - a30 * b03 - a32 * b00) * k, (a20 * b03 - a21 * b01 + a22 * b00) * k,
    ];
  }

  const xform4 = (M, v) => [0, 1, 2, 3].map((r) => M[r] * v[0] + M[4 + r] * v[1] + M[8 + r] * v[2] + M[12 + r] * v[3]);

  // Tia từ camera qua điểm ndc [x, y] (-1..1) trên màn hình. PV = projection * view.
  function unprojectRay(PV, ndc) {
    const inv = inv4(PV);
    if (!inv) return null;
    const a = xform4(inv, [ndc[0], ndc[1], -1, 1]), b = xform4(inv, [ndc[0], ndc[1], 1, 1]);
    if (!a[3] || !b[3]) return null;
    const o = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
    const d = [b[0] / b[3] - o[0], b[1] / b[3] - o[1], b[2] / b[3] - o[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    return len > 0 ? { o, d: [d[0] / len, d[1] / len, d[2] / len] } : null;
  }

  // Điểm trong bán kính radiusPx quanh con trỏ, lấy điểm gần camera nhất (điểm nhìn thấy ở trước). -1 nếu không có.
  function pickPoint(pos, count, PV, ndc, sizePx, radiusPx) {
    const hw = sizePx[0] / 2, hh = sizePx[1] / 2, r2 = radiusPx * radiusPx;
    let best = -1, bestW = Infinity;
    for (let i = 0; i < count; i++) {
      const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
      const w = PV[3] * x + PV[7] * y + PV[11] * z + PV[15];
      if (w <= 1e-6 || w >= bestW) continue;
      const dx = ((PV[0] * x + PV[4] * y + PV[8] * z + PV[12]) / w - ndc[0]) * hw;
      const dy = ((PV[1] * x + PV[5] * y + PV[9] * z + PV[13]) / w - ndc[1]) * hh;
      if (dx * dx + dy * dy > r2) continue;
      const cz = (PV[2] * x + PV[6] * y + PV[10] * z + PV[14]) / w;
      if (cz < -1 || cz > 1) continue;
      bestW = w; best = i;
    }
    return best;
  }

  // Tia cắt cuboid (points CVAT, nới thêm pad)? Trả về khoảng cách t hoặc Infinity.
  function rayBoxHit(ray, pts, pad = 0) {
    const R = rotMat(pts[3], pts[4], pts[5]);
    const o = [ray.o[0] - pts[0], ray.o[1] - pts[1], ray.o[2] - pts[2]];
    let t0 = -Infinity, t1 = Infinity;
    for (let k = 0; k < 3; k++) {
      const oo = R[0][k] * o[0] + R[1][k] * o[1] + R[2][k] * o[2];
      const dd = R[0][k] * ray.d[0] + R[1][k] * ray.d[1] + R[2][k] * ray.d[2];
      const h = pts[6 + k] / 2 + pad;
      if (Math.abs(dd) < 1e-12) { if (Math.abs(oo) > h) return Infinity; continue; }
      let a = (-h - oo) / dd, b = (h - oo) / dd;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    }
    return t0 <= t1 && t1 > 0 ? Math.max(t0, 0) : Infinity;
  }

  // Giao điểm (x, y) của tia với mặt phẳng ngang z; null nếu tia song song hoặc mặt phẳng ở sau camera
  function rayPlaneZ(ray, z) {
    if (Math.abs(ray.d[2]) < 1e-6) return null;
    const t = (z - ray.o[2]) / ray.d[2];
    return t > 0 ? [ray.o[0] + t * ray.d[0], ray.o[1] + t * ray.d[1]] : null;
  }

  // Các điểm rải dọc 12 cạnh của cuboid (để vẽ bóng cuboid khi kéo)
  function boxEdges(pts, step = 0.05) {
    const R = rotMat(pts[3], pts[4], pts[5]), h = [pts[6] / 2, pts[7] / 2, pts[8] / 2];
    const corner = (a, b, c) => [0, 1, 2].map((r) => pts[r] + R[r][0] * a * h[0] + R[r][1] * b * h[1] + R[r][2] * c * h[2]);
    const out = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      for (const [p, q] of [[corner(-1, a, b), corner(1, a, b)], [corner(a, -1, b), corner(a, 1, b)], [corner(a, b, -1), corner(a, b, 1)]]) {
        const n = Math.max(2, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) / step));
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          out.push(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t);
        }
      }
    }
    return new Float32Array(out);
  }

  const core = {
    CFG, PRIORS, rotMat, fitGround, localGround, groundAt, snapZ, growCluster, lshapeTheta, extendAway,
    fitCuboid, fitAtPoint, refine2D, placeFixed, yawNear, resizeKeepVisible, findPrior, normAngle, mul4, inv4, unprojectRay,
    pickPoint, rayBoxHit, rayPlaneZ, boxEdges,
  };
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
    const identity = !m || Array.prototype.every.call(m, (v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-9);
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
  let selfDispatch = false; // đang phát sự kiện của chính script: bộ khoá mặt đất bỏ qua

  const samePoints = (a, b) => a && b && [0, 1, 2, 5, 6, 7, 8].every((k) => Math.abs(a[k] - b[k]) < 1e-6);

  let lastFrame = null;
  function onStoreChange() {
    if (!store) return;
    if (pending) {
      const ann = store.getState().annotation;
      const s = ann && ann.annotations && (ann.annotations.states || []).find((x) => x.clientID === pending.id);
      if (s && samePoints(s.points, pending.points)) { pending = null; verified = true; }
    }
    // Đổi frame: tự gom cụm cho các track đang theo
    const f = currentFrame();
    if (f != null && f !== lastFrame) {
      const prev = lastFrame;
      lastFrame = f;
      if (prev != null) onFrameChanged(prev, f);
    }
  }

  async function commitFallback(ctx, points, state = ctx.state) {
    state.points = points;
    const saved = await state.save();
    let history;
    try { history = await ctx.st.annotation.job.instance.actions.get(); } catch (e) { /* bỏ qua */ }
    ctx.store.dispatch({ type: 'UPDATE_ANNOTATIONS_SUCCESS', payload: { states: [saved], history } });
  }

  // Lưu points mới cho state (mặc định: cuboid đang chọn)
  function commit(ctx, points, state = ctx.state) {
    if (isTrack(state)) {
      // Đổi kích thước 1 track (vd. WASD): hẹn áp kích thước mới cho mọi keyframe khác
      if (isSizeChange(state.points, points)) scheduleTrackSize(state.clientID, points.slice(6, 9));
      // Bạn vừa chỉnh track này: sang frame sau tự gom cụm cho nó (không tính lần tự gom của chính tool)
      if (!autoCommitting) markFollow(state, points);
    }
    pending = { id: state.clientID, points, t: Date.now() };
    if (useFallback) {
      commitFallback(ctx, points, state).catch((e) => toast('Lỗi lưu: ' + e.message, true)).finally(() => onStoreChange());
      return;
    }
    // Cách CVAT tự làm khi bạn kéo cuboid: canvas phát sự kiện 'canvas.edited' trên view perspective
    selfDispatch = true;
    try {
      ctx.html.perspective.dispatchEvent(new CustomEvent('canvas.edited', { detail: { state, points } }));
    } finally { selfDispatch = false; }
    if (!verified) {
      setTimeout(() => {
        if (pending && pending.points === points) {
          console.warn('[cuboid-helper] canvas.edited không được xử lý, chuyển sang cách lưu dự phòng');
          useFallback = true;
          commit(ctx, points, state);
        }
      }, 600);
    }
  }

  // Tạo cuboid mới như khi vẽ xong 1 cuboid: canvas phát 'canvas.drawn', CVAT gán nhãn đang chọn.
  function createCuboid(ctx, points) {
    const ann = ctx.st.annotation;
    const before = new Set(((ann.annotations && ann.annotations.states) || []).map((s) => s.clientID));
    const frame = ann.player && ann.player.frame ? ann.player.frame.number : undefined;
    const detail = { state: { shapeType: 'cuboid', frame, points, attributes: {} }, continue: false, duration: 0 };
    selfDispatch = true;
    try {
      ctx.html.perspective.dispatchEvent(new CustomEvent('canvas.drawn', { bubbles: false, cancelable: true, detail }));
    } catch (e) {
      console.warn('[cuboid-helper] canvas.drawn lỗi:', e);
    } finally { selfDispatch = false; }
    setTimeout(() => {
      const st = store && store.getState();
      const states = (st && st.annotation && st.annotation.annotations && st.annotation.annotations.states) || [];
      const added = states.find((s) => !before.has(s.clientID) && String(s.shapeType).toLowerCase() === 'cuboid');
      if (!added) {
        toast('Không tạo được cuboid mới bằng Ctrl+click trên CVAT này.\nHãy chọn (hoặc vẽ) 1 cuboid, rồi Ctrl+click vào vật nằm trong nó để fit lại.', true, 7000);
        return;
      }
      // Chọn luôn cuboid vừa tạo để chỉnh tiếp (G, WASD...)
      try {
        store.dispatch({ type: 'ACTIVATE_OBJECT', payload: { activatedStateID: added.clientID, activatedElementID: null, activatedAttributeID: null } });
      } catch (e) { /* bỏ qua */ }
    }, 800);
  }

  const busy = () => pending && Date.now() - pending.t < 500;

  // ------------------------------------------------------------- views / keys
  const mouse = { x: -1, y: -1 };
  window.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, true);

  function viewAt(ctx, x, y) {
    for (const name of ['top', 'side', 'front']) {
      const el = ctx.html[name];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return name;
    }
    return null;
  }
  const hoveredView = (ctx) => viewAt(ctx, mouse.x, mouse.y);

  function project(camera, p) {
    camera.updateMatrixWorld && camera.updateMatrixWorld();
    const v = camera.matrixWorldInverse.elements, P = camera.projectionMatrix.elements;
    const c = [0, 1, 2, 3].map((i) => v[i] * p[0] + v[4 + i] * p[1] + v[8 + i] * p[2] + v[12 + i]);
    const q = [0, 1, 2, 3].map((i) => P[i] * c[0] + P[4 + i] * c[1] + P[8 + i] * c[2] + P[12 + i] * c[3]);
    return [q[0] / q[3], q[1] / q[3]];
  }

  function camPV(camera) {
    camera.updateMatrixWorld && camera.updateMatrixWorld();
    return mul4(camera.projectionMatrix.elements, camera.matrixWorldInverse.elements);
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

  // Hướng trong world ứng với hướng keyDir (NDC, y lên) trên màn hình của view: trục phải/lên của camera
  function screenDir(ctx, viewName, keyDir) {
    const cam = ctx.view && ctx.view.views[viewName] && ctx.view.views[viewName].camera;
    if (!cam) return null;
    cam.updateMatrixWorld && cam.updateMatrixWorld();
    const V = cam.matrixWorldInverse.elements; // hàng 0 = trục phải, hàng 1 = trục lên của camera (trong world)
    const d = [0, 1, 2].map((c) => keyDir[0] * V[c * 4] + keyDir[1] * V[c * 4 + 1]);
    const len = Math.hypot(d[0], d[1], d[2]);
    return len > 1e-9 ? d.map((v) => v / len) : null;
  }

  // 2 trục local của cuboid hiện rõ nhất trên view (trục còn lại là chiều sâu)
  function viewAxes(ctx, viewName) {
    const cam = ctx.view && ctx.view.views[viewName] && ctx.view.views[viewName].camera;
    if (!cam) return null;
    const pts = ctx.state.points;
    const R = rotMat(pts[3], pts[4], pts[5]);
    const c0 = [pts[0], pts[1], pts[2]];
    const p0 = project(cam, c0);
    const rect = ctx.html[viewName].getBoundingClientRect();
    const lens = [0, 1, 2].map((k) => {
      const a = col(R, k);
      const p1 = project(cam, [c0[0] + a[0], c0[1] + a[1], c0[2] + a[2]]);
      return { k, len: Math.hypot((p1[0] - p0[0]) * rect.width, (p1[1] - p0[1]) * rect.height) };
    }).filter((x) => isFinite(x.len));
    if (lens.length < 3) return null;
    lens.sort((p, q) => q.len - p.len);
    return [lens[0].k, lens[1].k];
  }

  const KEY_DIR = { KeyW: [0, 1], KeyS: [0, -1], KeyA: [-1, 0], KeyD: [1, 0] }; // NDC, y hướng lên
  const ARROW_DIR = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }; // NDC, y hướng lên
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

  // Lớp điểm phủ riêng (tô cụm vừa gom, bóng cuboid khi kéo), theo tên nhóm; tự xoá sau ms (0 = giữ)
  const overlayGroups = {};
  function clearOverlay(tag) {
    const g = overlayGroups[tag];
    if (!g) return;
    clearTimeout(g.timer);
    for (const { o, scene } of g.items) {
      scene.remove(o);
      if (o.geometry.dispose) o.geometry.dispose();
      if (o.material.dispose) o.material.dispose();
    }
    delete overlayGroups[tag];
  }
  function showOverlay(ctx, srcObj, arr, tag, rgb, sizeMul, ms, viewNames) {
    clearOverlay(tag);
    if (!srcObj || !arr.length) return;
    const Geo = srcObj.geometry.constructor, Attr = srcObj.geometry.attributes.position.constructor, Pts = srcObj.constructor;
    const scenes = new Set();
    for (const name of viewNames || Object.keys(ctx.view.views)) {
      const sc = ctx.view.views[name] && ctx.view.views[name].scene;
      if (sc) scenes.add(sc);
    }
    const g = { items: [], timer: 0 };
    for (const scene of scenes) {
      const geo = new Geo();
      geo.setAttribute('position', new Attr(arr.slice(), 3));
      const mat = srcObj.material.clone();
      mat.vertexColors = false;
      if (mat.color) mat.color.setRGB(rgb[0], rgb[1], rgb[2]);
      mat.size = (srcObj.material.size || 0.05) * sizeMul;
      mat.depthTest = false;
      mat.needsUpdate = true;
      const o = new Pts(geo, mat);
      o.renderOrder = 999;
      o.userData.chOverlay = true;
      scene.add(o);
      g.items.push({ o, scene });
    }
    overlayGroups[tag] = g;
    if (ms) g.timer = setTimeout(() => clearOverlay(tag), ms);
  }
  // Tô màu hồng các điểm thuộc cụm vừa gom
  function showHighlight(ctx, cloud, idx, ms = 6000) {
    if (!cloud.obj || !idx || !idx.length) { clearOverlay('hl'); return; }
    const arr = new Float32Array(idx.length * 3);
    idx.forEach((i, k) => { arr[3 * k] = cloud.pos[3 * i]; arr[3 * k + 1] = cloud.pos[3 * i + 1]; arr[3 * k + 2] = cloud.pos[3 * i + 2]; });
    showOverlay(ctx, cloud.obj, arr, 'hl', [1, 0.15, 0.85], 1.5, ms);
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

  // ------------------------------------------------- cài đặt bật/tắt
  // Lưu trong localStorage của trang. Khi chạy dạng extension, popup đổi cài đặt qua bridge.js (postMessage).
  const SETTINGS_LS = 'cuboidHelperSettings';
  const SETTING_NAMES = {
    groundLock: 'Tự dính mặt đất',
    autoTrack: 'Tự gom track ở frame sau',
    trackSyncSize: 'Áp kích thước track cho mọi keyframe',
  };
  const SET = { groundLock: true, autoTrack: CFG.AUTO_TRACK, trackSyncSize: CFG.TRACK_SYNC_SIZE };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_LS) || '{}');
    if (!('groundLock' in saved) && localStorage.getItem('cuboidHelperGroundLock') === '0') saved.groundLock = false; // bản cũ
    for (const k of Object.keys(SET)) if (typeof saved[k] === 'boolean') SET[k] = saved[k];
  } catch (e) { /* bỏ qua */ }
  let snapCount = 0;

  // Đổi cài đặt. fromBridge: đến từ popup của extension (không gửi ngược lại).
  function setSettings(patch, fromBridge = false) {
    const changed = [];
    for (const k of Object.keys(SET)) {
      if (!patch || typeof patch[k] !== 'boolean' || patch[k] === SET[k]) continue;
      SET[k] = patch[k];
      changed.push(`${SETTING_NAMES[k]}: ${SET[k] ? 'BẬT' : 'TẮT'}`);
    }
    if (!changed.length) return { ...SET };
    try { localStorage.setItem(SETTINGS_LS, JSON.stringify(SET)); } catch (e) { /* bỏ qua */ }
    if (!fromBridge) window.postMessage({ __cuboidHelper: 'set', settings: { ...SET } }, location.origin);
    toast(changed.join('\n'), false, 2000);
    return { ...SET };
  }

  function toggleLock() {
    setSettings({ groundLock: !SET.groundLock });
  }

  // Chỉ dời chỗ (kích thước và góc xoay giữ nguyên)?
  const isMove = (a, b) => a && b && a.length >= 9 && b.length >= 9 &&
    [3, 4, 5, 6, 7, 8].every((k) => Math.abs(a[k] - b[k]) < 1e-4) &&
    [0, 1, 2].some((k) => Math.abs(a[k] - b[k]) > 1e-4);

  // Sửa z trong mảng points để đáy nằm trên mặt đất
  function snapInPlace(points, why) {
    const ctx = getCtx();
    const cloud = ctx && getCloud(ctx);
    if (!cloud) return false;
    const z = snapZ(cloud.pos, cloud.count, points);
    if (z == null || !isFinite(z)) return false;
    const dz = z - points[2];
    points[2] = z;
    snapCount++;
    if (Math.abs(dz) > 0.01) toast(`${why}: đặt đáy sát mặt đất (${dz > 0 ? '+' : ''}${dz.toFixed(2)} m)`, false, 1300);
    return true;
  }

  // Khi bạn kéo cuboid ở Top/Side/Front, CVAT phát 'canvas.edited' { state, points } trên canvas. Bắt ở pha
  // capture (trước CVAT) rồi sửa z ngay trong points, nên CVAT lưu luôn vị trí sát đất, chỉ 1 bước Ctrl+Z.
  // Kéo cạnh đổi kích thước của 1 track: hẹn áp kích thước mới cho mọi keyframe khác của track đó.
  window.addEventListener('canvas.edited', (e) => {
    if (selfDispatch) return;
    const d = e.detail;
    if (!d || !d.state || !Array.isArray(d.points)) return;
    if (d.state.shapeType && String(d.state.shapeType).toLowerCase() !== 'cuboid') return;
    if (SET.groundLock && isMove(d.state.points, d.points)) {
      try { snapInPlace(d.points, 'Di chuyển'); } catch (err) { console.warn('[cuboid-helper] không đặt được sát đất:', err); }
    }
    if (isTrack(d.state)) {
      if (isSizeChange(d.state.points, d.points)) scheduleTrackSize(d.state.clientID, d.points.slice(6, 9));
      markFollow(d.state, d.points);
    }
  }, true);

  // ------------------------------------------- track: đổi L/W/H ở 1 keyframe -> mọi keyframe
  const isTrack = (state) => !!state && String(state.objectType).toLowerCase() === 'track';

  // Kích thước thật có đổi không? Xoay 90° kèm đổi chỗ L/W (phím E) thì kích thước thật vẫn thế.
  function isSizeChange(a, b) {
    if (!a || !b || a.length < 9 || b.length < 9) return false;
    if ([6, 7, 8].every((k) => Math.abs(a[k] - b[k]) < 1e-4)) return false;
    const quarter = Math.abs(Math.abs(normAngle(b[5] - a[5])) - Math.PI / 2) < 1e-3;
    return !(quarter && Math.abs(a[6] - b[7]) < 1e-4 && Math.abs(a[7] - b[6]) < 1e-4 && Math.abs(a[8] - b[8]) < 1e-4);
  }

  const currentFrame = () => {
    const st = store && store.getState();
    const f = st && st.annotation && st.annotation.player && st.annotation.player.frame;
    return f ? f.number : null;
  };

  const sizeTimers = {};
  let sizeSyncCount = 0;
  function scheduleTrackSize(id, dims) {
    if (!SET.trackSyncSize) return;
    const frame = currentFrame();
    if (frame == null) return;
    clearTimeout(sizeTimers[id]);
    sizeTimers[id] = setTimeout(() => {
      delete sizeTimers[id];
      syncTrackSize(id, frame, dims).catch((err) => {
        console.warn('[cuboid-helper] đồng bộ kích thước track lỗi:', err);
        toast('Không áp được kích thước cho các keyframe khác: ' + err.message, true, 5000);
      });
    }, CFG.TRACK_SYNC_DELAY);
  }

  // API annotations của cvat-core (job đang mở), hoặc null
  function getJob() {
    const st = store && store.getState();
    const job = st && st.annotation && st.annotation.job && st.annotation.job.instance;
    return job && job.annotations && typeof job.annotations.get === 'function' ? job : null;
  }

  // Các keyframe (ObjectState) của track id: đi theo keyframes.first -> next -> ... của cvat-core
  async function trackKeyframes(job, id, fromFrame) {
    const stateAt = async (f) => ((await job.annotations.get(f, true, [])) || []).find((x) => x.clientID === id) || null;
    const cur = await stateAt(fromFrame);
    if (!cur || !cur.keyframes) return null;
    const keys = [];
    let f = cur.keyframes.first != null ? cur.keyframes.first : fromFrame, guard = 0;
    while (f != null && guard++ < 10000) {
      const s = f === fromFrame ? cur : await stateAt(f);
      if (!s) break;
      if (s.keyframe) keys.push({ f, s });
      const next = s.keyframes ? s.keyframes.next : null;
      f = next != null && next > f ? next : null;
    }
    return keys;
  }

  // Đặt kích thước dims cho các keyframe (bỏ qua frame skipFrame, keyframe outside, keyframe khoá)
  async function applyTrackSize(keys, dims, skipFrame = null) {
    let changed = 0, locked = 0;
    for (const { f, s } of keys) {
      if (f === skipFrame || s.outside) continue;
      if (![6, 7, 8].some((k) => Math.abs(s.points[k] - dims[k - 6]) > 1e-6)) continue;
      if (s.lock) { locked++; continue; }
      s.points = resizeKeepVisible(s.points, dims);
      await s.save();
      changed++;
    }
    sizeSyncCount += changed;
    return { changed, locked };
  }

  // Sau khi sửa keyframe qua API: cập nhật cuboid ở frame đang xem và danh sách hoàn tác (Ctrl+Z) trên giao diện
  async function refreshStates(job, ids) {
    try {
      const f = currentFrame();
      const fresh = f == null ? [] : ((await job.annotations.get(f, false, [])) || []).filter((x) => ids.has(x.clientID));
      const history = await job.actions.get();
      store.dispatch({ type: 'UPDATE_ANNOTATIONS_SUCCESS', payload: { states: fresh, history } });
    } catch (err) { /* bỏ qua */ }
  }

  // Áp L/W/H cho mọi keyframe (trừ frame vừa sửa) của track id
  async function syncTrackSize(id, frame, dims) {
    const job = getJob();
    if (!job) { toast('Không đọc được các keyframe của track trên CVAT này: chỉ frame vừa sửa đổi kích thước.', true, 5000); return; }
    const keys = await trackKeyframes(job, id, frame);
    if (!keys) { toast('Không đọc được các keyframe của track.', true); return; }
    const { changed, locked } = await applyTrackSize(keys, dims, frame);
    await refreshStates(job, new Set());
    if (changed || locked) {
      toast(`Track #${id}: áp L ${dims[0].toFixed(2)} W ${dims[1].toFixed(2)} H ${dims[2].toFixed(2)} cho ${changed} keyframe khác` +
        (locked ? ` (bỏ qua ${locked} keyframe đang khoá)` : ''), false, 3500);
    }
  }

  // ------------------------------------------- đồng nhất kích thước keyframe của track
  // Phím U / popup: track đang chọn lấy kích thước ở frame đang xem. Popup "tất cả track": mỗi track lấy trung vị
  // L, W, H các keyframe của nó. Ở mỗi keyframe giữ mặt phía LiDAR và đáy (resizeKeepVisible).
  let unifying = false;
  const fmtDims = (d) => `L ${d[0].toFixed(2)} W ${d[1].toFixed(2)} H ${d[2].toFixed(2)}`;

  async function unifySelected() {
    const ctx = getCtx();
    if (!ctx || !ctx.state) return { ok: false, message: 'Chưa chọn cuboid nào. Chọn 1 track rồi làm lại.' };
    if (!isTrack(ctx.state)) return { ok: false, message: 'Cuboid đang chọn là shape, không phải track.' };
    const job = getJob();
    if (!job) return { ok: false, message: 'Không đọc được các keyframe của track trên CVAT này.' };
    if (unifying) return { ok: false, message: 'Đang đồng nhất, chờ xong rồi làm lại.' };
    unifying = true;
    try {
      const id = ctx.state.clientID, dims = ctx.state.points.slice(6, 9);
      const keys = await trackKeyframes(job, id, currentFrame());
      if (!keys) return { ok: false, message: 'Không đọc được các keyframe của track.' };
      const { changed, locked } = await applyTrackSize(keys, dims);
      await refreshStates(job, new Set([id]));
      return {
        ok: true,
        message: `Track #${id}: ${keys.length} keyframe, đổi ${changed} keyframe sang ${fmtDims(dims)}` +
          (locked ? ` (bỏ qua ${locked} keyframe đang khoá)` : ''),
      };
    } finally { unifying = false; }
  }

  async function unifyAll() {
    const job = getJob();
    if (!job) return { ok: false, message: 'Không đọc được các keyframe của track trên CVAT này.' };
    if (unifying) return { ok: false, message: 'Đang đồng nhất, chờ xong rồi làm lại.' };
    unifying = true;
    try {
      const frame = currentFrame();
      const all = ((await job.annotations.get(frame, true, [])) || [])
        .filter((x) => isTrack(x) && String(x.shapeType).toLowerCase() === 'cuboid');
      let tracks = 0, changed = 0, locked = 0;
      const ids = new Set();
      for (const t of all) {
        const keys = await trackKeyframes(job, t.clientID, frame);
        const live = keys ? keys.filter((k) => !k.s.outside) : [];
        if (live.length < 2) continue;
        const dims = [6, 7, 8].map((k) => median(live.map((x) => x.s.points[k])));
        const r = await applyTrackSize(keys, dims);
        if (r.changed) { tracks++; ids.add(t.clientID); }
        changed += r.changed;
        locked += r.locked;
      }
      await refreshStates(job, ids);
      return {
        ok: true,
        message: `${all.length} track: đồng nhất ${tracks} track (đổi ${changed} keyframe, mỗi track lấy trung vị L/W/H các keyframe)` +
          (locked ? `, bỏ qua ${locked} keyframe đang khoá` : ''),
      };
    } finally { unifying = false; }
  }

  async function runCommand(name) {
    try {
      if (name === 'unifySelected') return await unifySelected();
      if (name === 'unifyAll') return await unifyAll();
      return { ok: false, message: `Lệnh lạ: ${name}` };
    } catch (err) {
      console.warn('[cuboid-helper] lệnh lỗi:', err);
      return { ok: false, message: 'Lỗi: ' + err.message };
    }
  }

  // ------------------------------------------- track: tự gom cụm ở các frame sau
  // Track bạn vừa chỉnh (G, WASD, kéo, mũi tên...) được "theo". Sang frame sau (lớn hơn frame vừa chỉnh), khi point
  // cloud của frame đó tải xong, tool gom cụm kiểu track (chỉ dời, giữ kích thước) từ vị trí đoán theo vận tốc,
  // rồi lưu thành keyframe. Không đè keyframe có sẵn. Dừng theo track khi không thấy vật hoặc phải nhảy quá xa.
  const follows = new Map(); // clientID -> { id, frame, hist: [{ f, x, y }] }
  let autoCommitting = false;
  let frameToken = 0;

  function markFollow(state, points) {
    const f = currentFrame();
    if (f == null || !state) return;
    let fo = follows.get(state.clientID);
    if (!fo) follows.set(state.clientID, (fo = { id: state.clientID, frame: f, hist: [] }));
    fo.frame = f;
    fo.hist = fo.hist.filter((h) => h.f < f).slice(-1).concat([{ f, x: points[0], y: points[1] }]);
  }

  // Vị trí đoán ở frame f theo 2 lần gom gần nhất (vận tốc không đổi)
  function predictXY(fo, f) {
    const h = fo.hist;
    if (!h.length) return null;
    const b = h[h.length - 1];
    if (h.length < 2 || f - b.f > CFG.AUTO_TRACK_PREDICT_MAX) return [b.x, b.y];
    const a = h[h.length - 2], k = (f - b.f) / (b.f - a.f);
    return [b.x + (b.x - a.x) * k, b.y + (b.y - a.y) * k];
  }

  // Dấu nhận biết point cloud đang hiển thị (đổi khi CVAT tải xong frame khác)
  function cloudSig(cloud) {
    const g = cloud.obj && cloud.obj.geometry;
    return [cloud.obj && cloud.obj.uuid, g && g.uuid, cloud.count, cloud.pos[0], cloud.pos[1], cloud.pos[2]].join('|');
  }

  function onFrameChanged(prev, f) {
    if (!SET.autoTrack || ![...follows.values()].some((fo) => f > fo.frame)) return;
    // CVAT đổi frame trong Redux trước, rồi mới tải point cloud của frame mới: đợi point cloud khác cái đang hiện
    const ctx0 = getCtx();
    const c0 = ctx0 && getCloud(ctx0);
    const oldSig = c0 ? cloudSig(c0) : null;
    const token = ++frameToken, t0 = Date.now();
    const tick = () => {
      if (token !== frameToken || currentFrame() !== f) return; // đã sang frame khác
      const ctx = getCtx();
      const cloud = ctx && getCloud(ctx);
      if (!cloud || cloudSig(cloud) === oldSig) {
        if (Date.now() - t0 < CFG.AUTO_TRACK_WAIT) setTimeout(tick, 100);
        else toast(`Tự gom track: point cloud frame ${f} chưa tải xong, bỏ qua frame này`, true, 3000);
        return;
      }
      setTimeout(() => { if (token === frameToken && currentFrame() === f) runAutoTrack(f); }, 80);
    };
    setTimeout(tick, 50);
  }

  function runAutoTrack(f) {
    const ctx = getCtx();
    const cloud = ctx && getCloud(ctx);
    if (!cloud) return;
    const states = (ctx.st.annotation.annotations && ctx.st.annotation.annotations.states) || [];
    const done = [], stopped = [], idx = [];
    for (const fo of [...follows.values()]) {
      if (!(f > fo.frame)) continue;
      const s = states.find((x) => x.clientID === fo.id);
      if (!s || !isTrack(s) || String(s.shapeType).toLowerCase() !== 'cuboid') continue;
      if (s.outside) { follows.delete(fo.id); stopped.push(`#${fo.id}: track đã kết thúc`); continue; }
      if (s.lock) continue;
      if (s.keyframe) {
        // Keyframe có sẵn (bạn đã làm): không đè, chỉ ghi nhận vị trí để đoán tiếp
        fo.frame = f;
        fo.hist = fo.hist.slice(-1).concat([{ f, x: s.points[0], y: s.points[1] }]);
        continue;
      }
      const rough = s.points.slice();
      const pred = predictXY(fo, f);
      if (pred) { rough[0] = pred[0]; rough[1] = pred[1]; }
      let res;
      try {
        res = fitCuboid(cloud.pos, cloud.count, rough, s.label && s.label.name, CFG, [0, 0, 0], { keepSize: true });
      } catch (err) {
        follows.delete(fo.id); stopped.push(`#${fo.id}: ${err.message}`); continue;
      }
      const p = res.points, moved = Math.hypot(p[0] - rough[0], p[1] - rough[1]);
      if (res.info.n < CFG.AUTO_TRACK_MIN_POINTS) { follows.delete(fo.id); stopped.push(`#${fo.id}: chỉ ${res.info.n} điểm`); continue; }
      if (moved > CFG.AUTO_TRACK_MAX_MOVE) { follows.delete(fo.id); stopped.push(`#${fo.id}: phải nhảy ${moved.toFixed(1)} m`); continue; }
      autoCommitting = true;
      try { commit(ctx, p, s); } finally { autoCommitting = false; }
      fo.frame = f;
      fo.hist = fo.hist.slice(-1).concat([{ f, x: p[0], y: p[1] }]);
      done.push(`#${fo.id}`);
      for (const i of res.info.idx) idx.push(i);
    }
    if (idx.length) { try { showHighlight(ctx, cloud, idx, 2500); } catch (err) { /* bỏ qua */ } }
    if (done.length || stopped.length) {
      toast((done.length ? `Frame ${f}: tự gom track ${done.join(', ')}` : '') +
        (stopped.length ? `${done.length ? '\n' : ''}⚠ Dừng theo ${stopped.join('; ')}. Chỉnh lại track rồi đi tiếp để theo lại.` : ''),
      !!stopped.length && !done.length, stopped.length ? 5000 : 1800);
    }
  }

  // Cuboid mới vẽ (hoặc dán bằng Ctrl+V) cũng đặt đáy lên mặt đất
  window.addEventListener('canvas.drawn', (e) => {
    if (selfDispatch || !SET.groundLock) return;
    const s = e.detail && e.detail.state;
    if (!s || !Array.isArray(s.points) || s.points.length < 9) return;
    if (s.shapeType && String(s.shapeType).toLowerCase() !== 'cuboid') return;
    try { snapInPlace(s.points, 'Cuboid mới'); } catch (err) { console.warn('[cuboid-helper] không đặt được sát đất:', err); }
  }, true);

  // ------------------------------------------- Ctrl+click, Shift+kéo trong view 3D lớn
  let drag = null;
  let eat = null; // { t, x, y }: nuốt mouseup/click theo sau thao tác của script tại vị trí này
  let lastDown = 0;
  const stopEv = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  const isControl = (t) => !!(t && t.closest && t.closest('button, a, input, textarea, select, [role="button"], .ant-btn'));

  function inPerspective(ctx, e) {
    const el = ctx.html.perspective;
    if (!el || isControl(e.target)) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return false;
    return !viewAt(ctx, e.clientX, e.clientY);
  }

  function rayFrom(ctx, x, y) {
    const cam = ctx.view && ctx.view.views.perspective && ctx.view.views.perspective.camera;
    const el = ctx.html.perspective;
    if (!cam || !el) return null;
    const r = el.getBoundingClientRect();
    const ndc = [((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2];
    const PV = camPV(cam);
    const ray = unprojectRay(PV, ndc);
    return ray ? Object.assign(ray, { PV, ndc, size: [r.width, r.height] }) : null;
  }

  function findMesh(ctx, id) {
    const scene = ctx.view && ctx.view.views.perspective && ctx.view.views.perspective.scene;
    if (!scene || typeof scene.traverse !== 'function') return null;
    let found = null;
    scene.traverse((o) => { if (!found && o.isMesh && o.name === String(id)) found = o; });
    return found;
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const ctrl = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;
    const shift = e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
    if (!ctrl && !shift) return;
    // mousedown đi sau pointerdown đã xử lý
    if (e.type === 'mousedown' && Date.now() - lastDown < 400) { if (drag || eat) stopEv(e); return; }
    const ctx = getCtx();
    if (!ctx || !inPerspective(ctx, e)) return;
    if (ctrl) {
      stopEv(e);
      lastDown = Date.now();
      eat = { t: Date.now() + 1500, x: e.clientX, y: e.clientY };
      const x = e.clientX, y = e.clientY;
      setTimeout(() => doPick(x, y), 0);
      return;
    }
    // Shift + kéo: chỉ khi bấm trúng cuboid đang chọn, ngoài ra để CVAT xử lý như thường
    if (!ctx.state || busy()) return;
    const ray = rayFrom(ctx, e.clientX, e.clientY);
    if (!ray || rayBoxHit(ray, ctx.state.points, 0.15) === Infinity) return;
    const pts = ctx.state.points.slice();
    const z0 = pts[2] - pts[8] / 2;
    const h0 = rayPlaneZ(ray, z0);
    if (!h0) return;
    stopEv(e);
    lastDown = Date.now();
    const mesh = findMesh(ctx, ctx.state.clientID);
    drag = { id: ctx.state.clientID, pts, z0, h0, dx: 0, dy: 0, mesh, mp: mesh ? [mesh.position.x, mesh.position.y, mesh.position.z] : null };
    toast('Kéo cuboid trên mặt đất (Esc: huỷ)', false, 1500);
  }

  function onPointerMove(e) {
    if (!drag) return;
    stopEv(e);
    if (e.type !== 'pointermove') return;
    const ctx = getCtx();
    const ray = ctx && rayFrom(ctx, e.clientX, e.clientY);
    const h = ray && rayPlaneZ(ray, drag.z0);
    if (!h) return;
    drag.dx = h[0] - drag.h0[0];
    drag.dy = h[1] - drag.h0[1];
    if (drag.mesh) {
      drag.mesh.position.x = drag.mp[0] + drag.dx;
      drag.mesh.position.y = drag.mp[1] + drag.dy;
    } else {
      const cloud = getCloud(ctx);
      const p = drag.pts.slice();
      p[0] += drag.dx; p[1] += drag.dy;
      if (cloud) showOverlay(ctx, cloud.obj, boxEdges(p), 'ghost', [0.1, 0.9, 1], 1.2, 0, ['perspective']);
    }
  }

  function restoreMesh(d) {
    if (d.mesh && d.mp) { d.mesh.position.x = d.mp[0]; d.mesh.position.y = d.mp[1]; d.mesh.position.z = d.mp[2]; }
  }

  function cancelDrag(msg) {
    if (!drag) return;
    restoreMesh(drag);
    clearOverlay('ghost');
    drag = null;
    if (msg) toast(msg, false, 900);
  }

  function finishDrag(x, y) {
    const d = drag;
    drag = null;
    eat = { t: Date.now() + 500, x, y };
    clearOverlay('ghost');
    if (Math.hypot(d.dx, d.dy) < 0.01) { restoreMesh(d); return; }
    const ctx = getCtx();
    if (!ctx || !ctx.state || ctx.state.clientID !== d.id) { restoreMesh(d); toast('Cuboid đang chọn đã đổi, huỷ kéo', true); return; }
    const p = ctx.state.points.slice();
    p[0] = d.pts[0] + d.dx;
    p[1] = d.pts[1] + d.dy;
    let note = '';
    if (SET.groundLock) {
      const cloud = getCloud(ctx);
      const z = cloud && snapZ(cloud.pos, cloud.count, p);
      if (z != null && isFinite(z)) { p[2] = z; note = ' · đáy sát mặt đất'; }
    }
    if (d.mesh) d.mesh.position.z = d.mp[2] + (p[2] - d.pts[2]);
    commit(ctx, p);
    toast(`Di chuyển ${Math.hypot(d.dx, d.dy).toFixed(2)} m${note}`, false, 1200);
  }

  function onPointerUp(e) {
    if (drag) {
      stopEv(e);
      if (e.type === 'pointerup' || e.type === 'mouseup') finishDrag(e.clientX, e.clientY);
      return;
    }
    if (eat) {
      if (Date.now() > eat.t) { eat = null; return; }
      if (Math.hypot(e.clientX - eat.x, e.clientY - eat.y) < 15) {
        stopEv(e);
        if (e.type === 'click') eat = null;
      }
    }
  }

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('mousedown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('mousemove', onPointerMove, true);
  for (const t of ['pointerup', 'mouseup', 'click', 'dblclick']) window.addEventListener(t, onPointerUp, true);
  window.addEventListener('pointercancel', () => cancelDrag('Huỷ kéo'), true);
  window.addEventListener('blur', () => cancelDrag());

  function activeLabelName(ctx) {
    const ann = ctx.st.annotation;
    const job = ann.job || {};
    const labels = job.labels || (job.instance && job.instance.labels) || [];
    const id = ann.drawing && ann.drawing.activeLabelID;
    const l = labels.find((x) => x.id === id) || labels[0];
    return l ? l.name : '';
  }

  // Bấm trúng khung đáy cuboid (nới thêm pad)?
  function inFootprint(pts, p, pad) {
    const R = rotMat(pts[3], pts[4], pts[5]);
    const d = [p[0] - pts[0], p[1] - pts[1], p[2] - pts[2]];
    for (let k = 0; k < 2; k++) {
      const l = R[0][k] * d[0] + R[1][k] * d[1] + R[2][k] * d[2];
      if (Math.abs(l) > pts[6 + k] / 2 + pad) return false;
    }
    return true;
  }

  function doPick(x, y) {
    const ctx = getCtx();
    if (!ctx) return;
    const cloud = getCloud(ctx);
    if (!cloud) { toast('Không tìm thấy point cloud trong canvas 3D', true); return; }
    const ray = rayFrom(ctx, x, y);
    if (!ray) { toast('Không đọc được camera của view 3D', true); return; }
    let i = pickPoint(cloud.pos, cloud.count, ray.PV, ray.ndc, ray.size, CFG.PICK_PX);
    if (i < 0) i = pickPoint(cloud.pos, cloud.count, ray.PV, ray.ndc, ray.size, CFG.PICK_PX * 2.5);
    if (i < 0) { toast('Không có điểm nào dưới con trỏ'); return; }
    const P = [cloud.pos[3 * i], cloud.pos[3 * i + 1], cloud.pos[3 * i + 2]];
    const sel = ctx.state;
    const refit = !!sel && inFootprint(sel.points, P, CFG.PICK_NEAR_SELECTED);
    const label = refit ? sel.label && sel.label.name : activeLabelName(ctx);
    try {
      const t0 = performance.now();
      const keepSize = refit && isTrack(sel);
      const res = fitAtPoint(cloud.pos, cloud.count, P, refit ? sel.points : null, label, CFG, [0, 0, 0], { keepSize });
      const p = res.points, inf = res.info;
      if (refit) commit(ctx, p); else createCuboid(ctx, p);
      try { showHighlight(ctx, cloud, inf.idx); } catch (err) { console.warn('[cuboid-helper] không tô được cụm:', err); }
      console.log('[cuboid-helper] Ctrl+click', { label, refit, point: P, clusterPoints: inf.n, eps: inf.eps, reach: inf.reach, after: p.slice(0, 9), notes: inf.notes });
      toast(
        `${refit ? (keepSize ? 'Track: dời' : 'Fit lại') : 'Tạo mới'} ${label || ''} (Ctrl+click): ${inf.n} điểm · ` +
        `L ${p[6].toFixed(2)} W ${p[7].toFixed(2)} H ${p[8].toFixed(2)} (${(performance.now() - t0).toFixed(0)} ms)` +
        (inf.notes.length ? '\n⚠ ' + inf.notes.join('; ') : ''),
        false, 5000,
      );
    } catch (err) {
      toast(err.message, true);
    }
  }

  function onKeyDown(e) {
    if (drag && e.code === 'Escape') { swallow(e); cancelDrag('Huỷ kéo'); return; }
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const code = e.code;
    if (code === 'BracketRight' || code === 'BracketLeft' || code === 'KeyB') {
      if (!getCtx()) return;
      swallow(e);
      onVisKey(code);
      return;
    }
    if (code === CFG.LOCK_KEY) {
      if (!getCtx()) return;
      swallow(e);
      if (!e.repeat) toggleLock();
      return;
    }
    if (code === CFG.UNIFY_KEY) {
      const c = getCtx();
      if (!c || !c.state || !isTrack(c.state)) return; // không phải track: để CVAT xử lý phím như thường
      swallow(e);
      if (e.repeat) return;
      toast('Đang đồng nhất kích thước các keyframe…', false, 1500);
      runCommand('unifySelected').then((r) => toast(r.message, !r.ok, 4000));
      return;
    }
    const isMoveKey = code in KEY_DIR;
    const isRot = code === 'KeyQ';
    const isTurn = code === 'KeyE';
    const isArrow = code in ARROW_DIR;
    const isFit = code === CFG.FIT_KEY;
    if (!isMoveKey && !isRot && !isTurn && !isArrow && !isFit) return;
    const ctx = getCtx();
    if (!ctx) return;

    if (isFit) {
      if (!ctx.state) {
        // không chặn phím, để CVAT xử lý G như bình thường, chỉ báo cho người dùng
        toast(ctx.rawState ? 'Đối tượng đang chọn không phải cuboid' : 'Chưa chọn cuboid: bấm vào cuboid (hoặc chọn trong danh sách bên phải) rồi bấm G.\nVật nhỏ: Ctrl+click vào vật.');
        return;
      }
      swallow(e);
      if (e.repeat) return;
      const v = hoveredView(ctx);
      if (v) doRefine(ctx, v, e.shiftKey && v === 'top'); else doFit(ctx);
      return;
    }

    const viewName = hoveredView(ctx);
    if (!viewName) return; // chuột không ở trên Top/Side/Front: giữ nguyên phím của CVAT
    if ((isRot || isTurn) && viewName !== 'top') return; // Q/E chỉ dùng ở view Top
    swallow(e); // chặn D (lùi frame) v.v. khi chuột ở trên view
    if (!ctx.state) { toast('Chưa chọn cuboid nào'); return; }
    if (busy()) return;

    const pts = ctx.state.points.slice();
    if (isRot) {
      if (viewName !== 'top') return;
      const deg = -(e.shiftKey ? CFG.ROT_STEP_FINE_DEG : CFG.ROT_STEP_DEG);
      pts[5] = normAngle(pts[5] + (deg * Math.PI) / 180);
      commit(ctx, pts);
      return;
    }
    if (isTurn) {
      // E: xoay +90° (Shift+E: −90°), đổi chỗ L và W nên khung đáy giữ nguyên
      const deg = e.shiftKey ? -90 : 90;
      pts[5] = normAngle(pts[5] + (deg * Math.PI) / 180);
      [pts[6], pts[7]] = [pts[7], pts[6]];
      commit(ctx, pts);
      toast(`Xoay ${deg > 0 ? '+' : ''}${deg}° · yaw ${((pts[5] * 180) / Math.PI).toFixed(1)}°`, false, 900);
      return;
    }
    if (isArrow) {
      // Phím mũi tên: dời cuboid theo hướng phím trên màn hình của view đang trỏ chuột
      const dir = screenDir(ctx, viewName, ARROW_DIR[code]);
      if (!dir) { toast('Không xác định được hướng ở view này'); return; }
      if (SET.groundLock) {
        // Khoá đất: chỉ dời theo mặt ngang, không lên/xuống
        dir[2] = 0;
        const len = Math.hypot(dir[0], dir[1]);
        if (len < 0.3) { toast('Khoá sát mặt đất đang bật: không dời lên/xuống được (J để tắt)', false, 1500); return; }
        dir[0] /= len; dir[1] /= len;
      }
      const step = e.shiftKey ? CFG.MOVE_STEP_FINE : CFG.MOVE_STEP;
      for (let i = 0; i < 3; i++) pts[i] += dir[i] * step;
      let note = '';
      if (SET.groundLock) {
        const cloud = getCloud(ctx);
        const z = cloud && snapZ(cloud.pos, cloud.count, pts);
        if (z != null && isFinite(z)) { pts[2] = z; note = ' · đáy sát đất'; }
      }
      commit(ctx, pts);
      toast(`Dời ${step.toFixed(2)} m${note} · tâm (${pts[0].toFixed(2)}, ${pts[1].toFixed(2)})`, false, 700);
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

  // Cuboid dạng track (isTrack): fit chỉ dời chỗ, giữ kích thước
  function doFit(ctx) {
    const cloud = getCloud(ctx);
    if (!cloud) { toast('Không tìm thấy point cloud trong canvas 3D', true); return; }
    const label = ctx.state.label && ctx.state.label.name;
    const keepSize = isTrack(ctx.state);
    try {
      const t0 = performance.now();
      const before = ctx.state.points.slice(0, 9);
      const res = fitCuboid(cloud.pos, cloud.count, ctx.state.points, label, CFG, [0, 0, 0], { keepSize });
      commit(ctx, res.points);
      const p = res.points, i = res.info;
      try { showHighlight(ctx, cloud, i.idx); } catch (err) { console.warn('[cuboid-helper] không tô được cụm:', err); }
      console.log('[cuboid-helper] fit', {
        label, cloudPoints: cloud.count, seeds: i.seeds, clusterPoints: i.n, eps: i.eps, range: i.range,
        groundPlane: i.ground.plane, groundCells: i.ground.cells, groundCellsDropped: i.ground.dropped, groundSrc: i.groundSrc,
        measured: i.measured, before, after: p.slice(0, 9), notes: i.notes,
      });
      const ms = (performance.now() - t0).toFixed(0);
      toast(
        `${keepSize ? 'Track: dời' : 'Fit'} ${label || ''}: ${i.n} điểm, cách ${i.range.toFixed(1)} m · ` +
        `L ${p[6].toFixed(2)} W ${p[7].toFixed(2)} H ${p[8].toFixed(2)} · yaw ${((p[5] * 180) / Math.PI).toFixed(1)}° (${ms} ms)` +
        (i.notes.length ? '\n⚠ ' + i.notes.join('; ') : ''),
        false, 5000,
      );
    } catch (err) {
      toast(err.message, true);
    }
  }

  function doRefine(ctx, viewName, refineYaw) {
    if (busy()) return;
    const cloud = getCloud(ctx);
    if (!cloud) { toast('Không tìm thấy point cloud trong canvas 3D', true); return; }
    const axes = viewAxes(ctx, viewName);
    if (!axes) { toast('Không xác định được trục ở view này', true); return; }
    try {
      const before = ctx.state.points.slice(0, 9);
      const res = refine2D(cloud.pos, cloud.count, ctx.state.points, axes, CFG, [0, 0, 0],
        { refineYaw, snapGround: SET.groundLock, keepSize: isTrack(ctx.state) });
      commit(ctx, res.points);
      const p = res.points, i = res.info;
      try { showHighlight(ctx, cloud, i.idx); } catch (err) { console.warn('[cuboid-helper] không tô được cụm:', err); }
      console.log('[cuboid-helper] refine2D', { view: viewName, axes, refineYaw, kept: i.n, total: i.total, before, after: p.slice(0, 9), notes: i.notes });
      const dims = axes.map((k) => `${AXIS_NAME[k]} ${p[6 + k].toFixed(2)}`).join(' ');
      toast(`Gom lại (${viewName}): giữ ${i.n}/${i.total} điểm · ${dims}` +
        (i.notes.length ? '\n⚠ ' + i.notes.join('; ') : ''), false, 4000);
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

  function statusInfo() {
    const ctx = getCtx();
    const cloud = ctx && getCloud(ctx);
    return {
      version: VERSION, store: !!findStore(), canvas3d: !!ctx, viewImpl: !!(ctx && ctx.view),
      activeCuboid: ctx && ctx.state ? ctx.state.clientID : null,
      cloudPoints: cloud ? cloud.count : 0, fallbackSave: useFallback,
      ...SET, groundSnaps: snapCount, trackSizeSyncs: sizeSyncCount, followedTracks: [...follows.keys()],
    };
  }

  // Extension: bridge.js (chạy ở vùng tách biệt, đọc được bộ nhớ của extension) gửi cài đặt từ popup qua
  // postMessage và hỏi trạng thái để popup hiển thị. Chỉ nhận tin của chính trang này.
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || typeof e.data !== 'object') return;
    const d = e.data;
    if (d.__cuboidHelper === 'settings') setSettings(d.settings, true);
    else if (d.__cuboidHelper === 'status?') window.postMessage({ __cuboidHelper: 'status', status: statusInfo() }, location.origin);
    else if (d.__cuboidHelper === 'command' && typeof d.name === 'string') {
      runCommand(d.name).then((res) => {
        toast(res.message, !res.ok, 4000);
        window.postMessage({ __cuboidHelper: 'commandResult', id: d.id, result: res }, location.origin);
      });
    }
  });
  window.postMessage({ __cuboidHelper: 'hello' }, location.origin);

  // Dùng trong DevTools console: cuboidHelper.check(), cuboidHelper.set({ autoTrack: false }), cuboidHelper.unfollow()
  window.cuboidHelper = {
    ...core,
    getCtx, getCloud,
    check() {
      const r = statusInfo();
      console.table(r);
      return r;
    },
    set: (patch) => setSettings(patch),
    unify: () => runCommand('unifySelected'),
    unifyAll: () => runCommand('unifyAll'),
    unfollow(id) {
      if (id == null) follows.clear(); else follows.delete(id);
      return [...follows.keys()];
    },
  };
  console.log(`[cuboid-helper] đã nạp bản ${VERSION}. Gõ cuboidHelper.check() trong console để kiểm tra.`);
}

  // Node (test): chạy trực tiếp để xuất module
  if (typeof module !== 'undefined' && module.exports) { main(); return; }
  // Chỉ kích hoạt trên trang CVAT (localhost, hoặc tiêu đề trang / tên miền có chữ "cvat")
  // Trên localhost / 127.0.0.1 luôn bật, không cần tiêu đề có chữ "cvat".
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (!isLocal && !/cvat/i.test(document.title) && !/cvat/i.test(location.hostname)) return;
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

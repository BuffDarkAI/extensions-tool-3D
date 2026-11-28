// Popup: 3 công tắc lưu trong chrome.storage.local; bridge.js trong trang CVAT gửi thay đổi vào script ngay.
const DEFAULTS = { groundLock: true, autoTrack: true, trackSyncSize: true };
const KEY = 'settings';
const $ = (id) => document.getElementById(id);

$('ver').textContent = 'Phiên bản ' + chrome.runtime.getManifest().version;

chrome.storage.local.get({ [KEY]: DEFAULTS }, (r) => {
  const settings = { ...DEFAULTS, ...r[KEY] };
  for (const k of Object.keys(DEFAULTS)) {
    const box = $(k);
    box.checked = !!settings[k];
    box.addEventListener('change', () => {
      chrome.storage.local.get({ [KEY]: DEFAULTS }, (cur) => {
        chrome.storage.local.set({ [KEY]: { ...DEFAULTS, ...cur[KEY], [k]: box.checked } });
      });
    });
  }
});

function showStatus(text, cls) {
  const el = $('status');
  el.textContent = text;
  el.className = cls || '';
}

// Nút lệnh: gửi vào trang CVAT đang mở (qua bridge.js), hiện kết quả
function showResult(text, ok) {
  const el = $('result');
  el.textContent = text;
  el.className = ok == null ? '' : ok ? 'ok' : 'err';
}

function sendCommand(name, btn) {
  const all = document.querySelectorAll('.btns button');
  all.forEach((b) => { b.disabled = true; });
  showResult('Đang chạy…');
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    const done = (res) => {
      all.forEach((b) => { b.disabled = false; });
      if (chrome.runtime.lastError || !res) showResult('Tab này không phải trang CVAT mà extension chạy, hoặc cần F5 trang.', false);
      else showResult(res.message, res.ok);
    };
    if (!tab || tab.id == null) { done(null); return; }
    chrome.tabs.sendMessage(tab.id, { type: 'command', name }, done);
  });
}

$('unifySelected').addEventListener('click', () => sendCommand('unifySelected'));

// Đồng nhất tất cả track sửa hàng loạt: bấm 2 lần để xác nhận
let confirmTimer = 0;
$('unifyAll').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  if (!btn.classList.contains('confirm')) {
    btn.classList.add('confirm');
    btn.dataset.label = btn.textContent;
    btn.textContent = 'Bấm lần nữa để chạy';
    showResult('Mọi track trong job sẽ lấy trung vị L, W, H các keyframe của nó. Mỗi keyframe sửa là 1 bước Ctrl+Z.');
    confirmTimer = setTimeout(() => { btn.classList.remove('confirm'); btn.textContent = btn.dataset.label; showResult(''); }, 4000);
    return;
  }
  clearTimeout(confirmTimer);
  btn.classList.remove('confirm');
  btn.textContent = btn.dataset.label;
  sendCommand('unifyAll');
});

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs && tabs[0];
  if (!tab || tab.id == null) { showStatus('Không đọc được tab hiện tại.', 'warn'); return; }
  chrome.tabs.sendMessage(tab.id, { type: 'status' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      showStatus('Tab này không phải trang CVAT mà extension chạy (localhost:8080, cvat.edufun.ai). ' +
        'Nếu đúng là trang CVAT, bấm F5 để nạp lại trang.', 'warn');
      return;
    }
    const s = res.status;
    if (!res.loaded && !s) {
      showStatus('Script chưa chạy trên trang này. Bấm F5; nếu vẫn vậy, mở Console (F12) và tìm dòng "cuboid-helper".', 'warn');
    } else if (!s || !s.canvas3d) {
      showStatus('Đã chạy. Mở một job 3D để dùng.', '');
    } else {
      const follow = s.followedTracks && s.followedTracks.length ? ` · đang theo ${s.followedTracks.length} track` : '';
      showStatus(`Đã kết nối job 3D · ${s.cloudPoints.toLocaleString('vi-VN')} điểm${follow}`, 'ok');
    }
  });
});

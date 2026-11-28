// Cầu nối giữa popup của extension và script chạy trong trang CVAT.
// Chạy ở vùng tách biệt (isolated world) nên đọc được chrome.storage; script chính chạy trong trang (MAIN world)
// thì không. Hai bên nói chuyện bằng window.postMessage, tin nhắn có trường __cuboidHelper.
(() => {
  const DEFAULTS = { groundLock: true, autoTrack: true, trackSyncSize: true };
  const KEY = 'settings';
  const pick = (o) => {
    const out = {};
    for (const k of Object.keys(DEFAULTS)) if (o && typeof o[k] === 'boolean') out[k] = o[k];
    return out;
  };
  const read = (cb) => chrome.storage.local.get({ [KEY]: DEFAULTS }, (r) => cb({ ...DEFAULTS, ...pick(r[KEY]) }));
  const push = () => read((settings) => window.postMessage({ __cuboidHelper: 'settings', settings }, location.origin));

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || typeof e.data !== 'object') return;
    const d = e.data;
    if (d.__cuboidHelper === 'hello') push(); // script chính vừa chạy: gửi cài đặt
    else if (d.__cuboidHelper === 'set') {
      // Đổi trong trang (vd. phím J): lưu lại để popup hiển thị đúng
      read((cur) => chrome.storage.local.set({ [KEY]: { ...cur, ...pick(d.settings) } }));
    }
  });

  // Popup đổi công tắc: gửi ngay vào trang
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) push();
  });

  // Popup gửi lệnh (đồng nhất kích thước track...): chuyển vào trang, chờ kết quả
  let commandSeq = 0;
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'command' || typeof msg.name !== 'string') return false;
    if (!document.documentElement.getAttribute('data-cuboid-helper')) {
      sendResponse({ ok: false, message: 'Script chưa chạy trên trang này. Bấm F5 trang CVAT rồi thử lại.' });
      return false;
    }
    const id = ++commandSeq;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onResult);
      sendResponse(result);
    };
    const onResult = (e) => {
      if (e.source === window && e.data && e.data.__cuboidHelper === 'commandResult' && e.data.id === id) finish(e.data.result);
    };
    window.addEventListener('message', onResult);
    window.postMessage({ __cuboidHelper: 'command', name: msg.name, id }, location.origin);
    setTimeout(() => finish({ ok: false, message: 'Trang không trả lời (script chưa chạy? Bấm F5 trang CVAT).' }), 120000);
    return true;
  });

  // Popup hỏi trạng thái của trang đang mở
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'status') return false;
    let done = false;
    const finish = (status) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onStatus);
      sendResponse({ loaded: !!document.documentElement.getAttribute('data-cuboid-helper'), status, url: location.href });
    };
    const onStatus = (e) => {
      if (e.source === window && e.data && e.data.__cuboidHelper === 'status') finish(e.data.status);
    };
    window.addEventListener('message', onStatus);
    window.postMessage({ __cuboidHelper: 'status?' }, location.origin);
    setTimeout(() => finish(null), 700);
    return true; // trả lời sau (bất đồng bộ)
  });

  push();
})();

// Đóng gói extension: node build-extension.js
// Tạo dist/cvat3d-cuboid-helper/ (chỉ các file extension cần, để Load unpacked) và
// dist/cvat3d-cuboid-helper-<version>.zip (để chép sang máy khác / gửi cho người khác).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const script = fs.readFileSync(path.join(root, 'cvat3d-cuboid-helper.user.js'), 'utf8');
const m = script.match(/@version\s+(\S+)/);
if (!m || m[1] !== manifest.version) {
  console.error(`Phiên bản lệch nhau: manifest.json ${manifest.version}, userscript ${m && m[1]}. Sửa cho giống rồi chạy lại.`);
  process.exit(1);
}

const files = [
  'manifest.json',
  ...manifest.content_scripts.flatMap((c) => c.js),
  ...Object.values(manifest.icons || {}),
];
const out = path.join(root, 'dist', 'cvat3d-cuboid-helper');
fs.rmSync(out, { recursive: true, force: true });
for (const f of files) {
  fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
  fs.copyFileSync(path.join(root, f), path.join(out, f));
}

// Ghi file zip (deflate), đường dẫn trong zip dùng '/' như chuẩn zip
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function writeZip(zipPath, entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8'), comp = zlib.deflateRawSync(data, { level: 9 }), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10); cen.writeUInt32LE(0, 12); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cenBuf = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(zipPath, Buffer.concat([...parts, cenBuf, end]));
}

const zip = path.join(root, 'dist', `cvat3d-cuboid-helper-${manifest.version}.zip`);
writeZip(zip, files.map((f) => ({ name: f.split(path.sep).join('/'), data: fs.readFileSync(path.join(root, f)) })));
console.log(`Xong: ${files.length} file\n  thư mục: ${out}\n  zip:     ${zip}`);

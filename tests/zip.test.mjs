import assert from 'node:assert/strict';
import { createZip } from '../web/zip.js';

const files = [
  { name: 'lecture.ics', data: '123456789' },
  { name: 'holidays.ics', data: 'holiday data' },
];
const zip = createZip(files);
const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
assert.equal(view.getUint32(0, true), 0x04034b50, 'starts with a ZIP local-file header');
assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50, 'ends with ZIP directory record');
assert.equal(view.getUint16(zip.length - 14, true), files.length, 'lists every file in the package');
assert.equal(view.getUint32(14, true), 0xcbf43926, 'stores the standard CRC-32 value');

let entry = view.getUint32(zip.length - 6, true);
const names = [];
for (let i = 0; i < files.length; i++) {
  assert.equal(view.getUint32(entry, true), 0x02014b50, 'has a central directory entry');
  const nameLength = view.getUint16(entry + 28, true);
  names.push(new TextDecoder().decode(zip.subarray(entry + 46, entry + 46 + nameLength)));
  entry += 46 + nameLength + view.getUint16(entry + 30, true) + view.getUint16(entry + 32, true);
}
assert.deepEqual(names, files.map((file) => file.name));
console.log('ALL ZIP TESTS PASSED');

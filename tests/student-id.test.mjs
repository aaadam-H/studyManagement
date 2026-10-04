import assert from 'node:assert/strict';
import { parseStudentId } from '../web/student-id.js';

assert.deepEqual(parseStudentId('231021306'), {
  id: '231021306',
  entryYear: '23',
  programmeCode: '102',
  personalNumber: '1306',
});
assert.equal(parseStudentId(' 231021306 ')?.id, '231021306');
for (const invalid of ['', '101022', '2310213060', 'abcdefgh9', '23 102 1306']) {
  assert.equal(parseStudentId(invalid), null, `${invalid} should be rejected`);
}
console.log('ALL STUDENT ID TESTS PASSED');

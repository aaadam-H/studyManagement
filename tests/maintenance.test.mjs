import assert from 'node:assert/strict';
import { maintenanceIsActive, toLocalDateTime } from '../web/maintenance.js';

const window = {
  maintenance_enabled: 'true',
  maintenance_start: '2026-10-05T08:00:00Z',
  maintenance_end: '2026-10-05T10:00:00Z',
};
assert.equal(maintenanceIsActive(window, Date.parse('2026-10-05T07:59:59Z')), false);
assert.equal(maintenanceIsActive(window, Date.parse('2026-10-05T08:00:00Z')), true);
assert.equal(maintenanceIsActive(window, Date.parse('2026-10-05T09:00:00Z')), true);
assert.equal(maintenanceIsActive(window, Date.parse('2026-10-05T10:00:00Z')), false);
assert.equal(maintenanceIsActive({ ...window, maintenance_enabled: 'false' }, Date.parse('2026-10-05T09:00:00Z')), false);
assert.equal(maintenanceIsActive({ ...window, maintenance_end: 'bad date' }, Date.parse('2026-10-05T09:00:00Z')), false);
assert.equal(toLocalDateTime('bad date'), '');
assert.equal(toLocalDateTime(''), '');
console.log('ALL MAINTENANCE TESTS PASSED');

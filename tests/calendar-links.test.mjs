import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { restoreCalendarSubscribeLinks, supportsAppleCalendarSubscribe } from '../web/calendar-links.js';

assert.equal(supportsAppleCalendarSubscribe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140'), false);
assert.equal(supportsAppleCalendarSubscribe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605'), true);
assert.equal(supportsAppleCalendarSubscribe('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), true);
assert.equal(supportsAppleCalendarSubscribe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605', 5), true);

const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
globalThis.window = window;
globalThis.document = document;
const { default: DOMPurify } = await import('../web/vendor/purify.es.mjs');
assert.equal(DOMPurify.isValidAttribute('a', 'href', 'webcal:https://studyhub.supabase.co/feed'), false);
assert.equal(DOMPurify.isValidAttribute('a', 'href', 'https://studyhub.supabase.co/feed'), true);
const root = document.createElement('div');
root.innerHTML = `
  <a data-calendar-subscribe href="https://studyhub.supabase.co/functions/v1/calendar-feed?token=secret">All-in-one</a>
  <a data-calendar-subscribe href="https://other.example/calendar.ics">Untrusted</a>
  <a href="https://studyhub.supabase.co/functions/v1/calendar-feed">Ordinary link</a>`;

restoreCalendarSubscribeLinks(root, 'https://studyhub.supabase.co');

assert.equal(root.querySelectorAll('a')[0].getAttribute('href'), 'webcal://studyhub.supabase.co/functions/v1/calendar-feed?token=secret');
assert.equal(root.querySelectorAll('a')[1].getAttribute('href'), 'https://other.example/calendar.ics');
assert.equal(root.querySelectorAll('a')[2].getAttribute('href'), 'https://studyhub.supabase.co/functions/v1/calendar-feed');
console.log('ALL CALENDAR LINK TESTS PASSED');

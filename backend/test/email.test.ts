import test from 'node:test';
import assert from 'node:assert/strict';
import {email} from '../src/auth.js';

test('email normalizes case and surrounding whitespace', () => {
  assert.equal(email('  Foo.Bar@Example.COM '), 'foo.bar@example.com');
  assert.equal(email('a@b.co'), 'a@b.co');
});

test('email rejects malformed addresses', () => {
  for (const bad of ['', '   ', 'no-at', 'a@b', 'a b@c.com', 'a@.com', 'a@b..com', '@b.com', 'a@', 'a@b.c om', 'x'.repeat(250) + '@b.com']) {
    assert.throws(() => email(bad), `expected rejection: ${JSON.stringify(bad)}`);
  }
});

test('email rejects non-string input', () => {
  assert.throws(() => email(undefined));
  assert.throws(() => email(123));
  assert.throws(() => email({}));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { main } from './registration-schedule.ts';

test('registration on 20 March crosses the last Sunday of March (DST spring forward)', async () => {
  const { sendAt } = await main({
    registeredAt: '2026-03-20T10:00:00.000Z',
    offsetsDays: [0, 10],
  });

  assert.equal(sendAt[0], '2026-03-20T08:00:00.000Z');
  assert.equal(sendAt[1], '2026-03-30T07:00:00.000Z');
});

test('registration on 20 October crosses the last Sunday of October (DST fall back)', async () => {
  const { sendAt } = await main({
    registeredAt: '2026-10-20T10:00:00.000Z',
    offsetsDays: [0, 10],
  });

  assert.equal(sendAt[0], '2026-10-20T07:00:00.000Z');
  assert.equal(sendAt[1], '2026-10-30T08:00:00.000Z');
});

test('offset 0 returns 09:00 Madrid on the registration day itself', async () => {
  const { sendAt } = await main({
    registeredAt: '2026-06-15T10:00:00.000Z',
    offsetsDays: [0],
  });

  assert.equal(sendAt.length, 1);
  assert.equal(sendAt[0], '2026-06-15T07:00:00.000Z');
});

test('full offset list 0..18 step 2 stays correct across the March change', async () => {
  const offsetsDays = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18];
  const { sendAt } = await main({
    registeredAt: '2026-03-20T10:00:00.000Z',
    offsetsDays,
  });

  assert.equal(sendAt.length, offsetsDays.length);

  const beforeChange = sendAt.slice(0, 5);
  const afterChange = sendAt.slice(5);

  for (const iso of beforeChange) {
    assert.match(iso, /T08:00:00\.000Z$/);
  }

  for (const iso of afterChange) {
    assert.match(iso, /T07:00:00\.000Z$/);
  }

  assert.deepEqual(
    sendAt.map((iso) => iso.slice(0, 10)),
    [
      '2026-03-20',
      '2026-03-22',
      '2026-03-24',
      '2026-03-26',
      '2026-03-28',
      '2026-03-30',
      '2026-04-01',
      '2026-04-03',
      '2026-04-05',
      '2026-04-07',
    ],
  );
});

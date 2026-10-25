import { beforeEach, describe, expect, test } from 'vitest';
import { Db, IDS } from '../src/db/client';
import * as repo from '../src/db/repo';

let db: Db;
beforeEach(async () => { db = await Db.create(); });

describe('coin purchases are idempotent', () => {
  test('posting the same receipt 5 times credits once', async () => {
    for (let i = 0; i < 5; i++) {
      const b = await db.as(IDS.alex, (q) => repo.creditPurchase(q, 'coins_3', '2000000999000001'));
      expect(b).toBe(3);
    }
    const rows = await db.as(IDS.alex, repo.ledger);
    expect(rows.filter((r) => r.kind === 'purchase')).toHaveLength(1);
  });

  test('5 concurrent posts of one receipt still credit once', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => db.as(IDS.alex, (q) => repo.creditPurchase(q, 'coins_6', '2000000999000002'))),
    );
    expect(results).toEqual([6, 6, 6, 6, 6]);
  });

  test('two different receipts credit twice', async () => {
    await db.as(IDS.alex, (q) => repo.creditPurchase(q, 'coins_3', '2000000999000003'));
    const b = await db.as(IDS.alex, (q) => repo.creditPurchase(q, 'coins_9', '2000000999000004'));
    expect(b).toBe(12);
  });

  test('a receipt already credited to one member cannot be replayed by another', async () => {
    await db.as(IDS.alex, (q) => repo.creditPurchase(q, 'coins_3', '2000000999000005'));
    const b = await db.as(IDS.dana, (q) => repo.creditPurchase(q, 'coins_3', '2000000999000005'));
    expect(b).toBe(0);
  });

  test('a non-consumable cannot be bought as coins', async () => {
    await expect(db.as(IDS.alex, (q) => repo.creditPurchase(q, 'advanced_filters', '2000000999000006')))
      .rejects.toThrow(/unknown coin pack/);
  });
});

describe('spending is atomic and never goes negative', () => {
  test('spending with 0 coins is refused', async () => {
    await expect(db.as(IDS.alex, (q) => repo.spendCoin(q))).rejects.toThrow(/insufficient coins/);
  });

  test('5 parallel spends on a balance of 1: exactly one succeeds', async () => {
    await db.as(IDS.alex, (q) => repo.creditPurchase(q, 'coins_3', '2000000999000010'));
    await db.as(IDS.alex, (q) => repo.spendCoin(q));
    await db.as(IDS.alex, (q) => repo.spendCoin(q));
    expect(await db.as(IDS.alex, (q) => repo.balance(q, IDS.alex))).toBe(1);

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => db.as(IDS.alex, (q) => repo.spendCoin(q))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(4);
    expect(await db.as(IDS.alex, (q) => repo.balance(q, IDS.alex))).toBe(0);
    const intros = await db.as(IDS.alex, (q) => q.rows('select * from intro_requests'));
    expect(intros).toHaveLength(3);
  });
});

describe('refunds', () => {
  const priyaPurchase = async () =>
    (await db.as(IDS.concierge, repo.ledger)).find((r) => r.member_id === IDS.priya && r.kind === 'purchase')!;

  test('concierge refunds a purchase exactly once', async () => {
    const p = await priyaPurchase();
    expect(await db.as(IDS.concierge, (q) => repo.refundPurchase(q, p.id))).toBe(0);
    await expect(db.as(IDS.concierge, (q) => repo.refundPurchase(q, p.id))).rejects.toThrow(/already refunded/);
    expect(await db.as(IDS.priya, (q) => repo.balance(q, IDS.priya))).toBe(0);
  });

  test('refund is refused if the coins were already spent', async () => {
    await db.as(IDS.priya, (q) => repo.spendCoin(q));
    const p = await priyaPurchase();
    await expect(db.as(IDS.concierge, (q) => repo.refundPurchase(q, p.id))).rejects.toThrow(/already spent/);
  });

  test('members cannot refund', async () => {
    const p = await priyaPurchase();
    await expect(db.as(IDS.priya, (q) => repo.refundPurchase(q, p.id))).rejects.toThrow(/admin only/);
  });

  test('refund is written to the audit log', async () => {
    const p = await priyaPurchase();
    await db.as(IDS.concierge, (q) => repo.refundPurchase(q, p.id));
    const audit = await db.as(IDS.concierge, repo.auditLog);
    expect(audit[0].action).toBe('refund_purchase');
  });
});

describe('non-consumable unlock', () => {
  test('restoring 3 times grants once', async () => {
    for (let i = 0; i < 3; i++) {
      await db.as(IDS.alex, (q) => repo.restoreEntitlement(q, 'advanced_filters', '2000000999000020'));
    }
    expect(await db.as(IDS.alex, repo.entitlements)).toHaveLength(1);
  });
});

describe('ledger privacy and write protection', () => {
  test('a member sees only their own ledger rows', async () => {
    await db.as(IDS.alex, (q) => repo.creditPurchase(q, 'coins_3', '2000000999000030'));
    const rows = await db.as(IDS.dana, repo.ledger);
    expect(rows).toHaveLength(0);
  });

  test("a member cannot read someone else's balance", async () => {
    await expect(db.as(IDS.dana, (q) => repo.balance(q, IDS.priya))).rejects.toThrow(/not allowed/);
    expect(await db.as(IDS.concierge, (q) => repo.balance(q, IDS.priya))).toBe(3);
  });

  test('a member cannot write the ledger directly', async () => {
    await expect(db.as(IDS.alex, (q) =>
      q.rows(`insert into coin_ledger (member_id, kind, amount) values ($1, 'admin_grant', 100)`, [IDS.alex]),
    )).rejects.toThrow(/permission denied/);
  });

  test('the internal balance function is not callable by members', async () => {
    await expect(db.as(IDS.alex, (q) => q.rows(`select ledger_balance($1)`, [IDS.priya])))
      .rejects.toThrow(/permission denied/);
  });
});

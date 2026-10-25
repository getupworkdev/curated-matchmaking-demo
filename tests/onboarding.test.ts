import { beforeEach, describe, expect, test } from 'vitest';
import { Db, IDS } from '../src/db/client';
import * as repo from '../src/db/repo';
import { rankCandidates } from '../src/domain/scoring';

let db: Db;
beforeEach(async () => { db = await Db.create(); });

const good: repo.Onboarding = {
  strategy: 'balanced', pace: 'steady', uncertainty: 'medium',
  values: ['family', 'honesty'], lifestyle: ['early_riser'], intent: 'long_term',
};

describe('waitlist', () => {
  test('a waitlisted member cannot onboard', async () => {
    await expect(db.as(IDS.nadia, (q) => repo.saveOnboarding(q, good))).rejects.toThrow(/only approved/);
  });

  test('approve → onboard → appears in concierge ranking', async () => {
    await db.as(IDS.concierge, (q) => repo.setWaitlist(q, IDS.nadia, 'approved'));
    await db.as(IDS.nadia, (q) => repo.saveOnboarding(q, good));
    const { members, ctx } = await db.as(IDS.concierge, repo.conciergePool);
    const alex = members.find((m) => m.id === IDS.alex)!;
    expect(rankCandidates(alex, members, ctx).map((c) => c.member.id)).toContain(IDS.nadia);
  });

  test('approval only works once, only from the waitlist, and only for the concierge', async () => {
    await expect(db.as(IDS.alex, (q) => repo.setWaitlist(q, IDS.nadia, 'approved'))).rejects.toThrow(/admin only/);
    await db.as(IDS.concierge, (q) => repo.setWaitlist(q, IDS.ben, 'declined'));
    await expect(db.as(IDS.concierge, (q) => repo.setWaitlist(q, IDS.ben, 'approved'))).rejects.toThrow(/not on the waitlist/);
    const audit = await db.as(IDS.concierge, repo.auditLog);
    expect(audit[0]).toMatchObject({ action: 'waitlist_declined', target: IDS.ben });
  });
});

describe('onboarding validation', () => {
  test.each([
    [{ strategy: 'yolo' }, /matching strategy/],
    [{ pace: '' }, /pace/],
    [{ uncertainty: 'none' }, /uncertainty/],
    [{ values: ['family'] }, /at least 2 values/],
    [{ lifestyle: [] }, /lifestyle/],
    [{ intent: 'casual' }, /intent/],
  ])('rejects %o', async (patch, msg) => {
    await expect(db.as(IDS.alex, (q) => repo.saveOnboarding(q, { ...good, ...patch } as repo.Onboarding))).rejects.toThrow(msg);
  });

  test('valid answers are saved', async () => {
    await db.as(IDS.alex, (q) => repo.saveOnboarding(q, { ...good, pace: 'fast' }));
    expect((await db.as(IDS.alex, (q) => repo.me(q, IDS.alex))).pace).toBe('fast');
  });
});

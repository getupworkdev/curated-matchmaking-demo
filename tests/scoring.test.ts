import { beforeAll, describe, expect, test } from 'vitest';
import { Db, IDS } from '../src/db/client';
import * as repo from '../src/db/repo';
import { dossier, exclusion, rankCandidates, score, type Context, type Member } from '../src/domain/scoring';

let pool: Member[];
let ctx: Context;
const byId = (id: string) => pool.find((m) => m.id === id)!;

beforeAll(async () => {
  const db = await Db.create();
  ({ members: pool, ctx } = await db.as(IDS.concierge, repo.conciergePool));
});

describe('score', () => {
  test('is symmetric for every pair in the seed', () => {
    for (const a of pool) for (const b of pool) expect(score(a, b).total).toBe(score(b, a).total);
  });

  test('stays within 0..100', () => {
    for (const a of pool) for (const b of pool) {
      const t = score(a, b).total;
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(100);
    }
  });

  test('identical answers score 100', () => {
    const a = byId(IDS.alex);
    expect(score(a, { ...a, id: 'x' }).total).toBe(100);
  });

  test('seeded match scores equal what the scorer computes', async () => {
    const db = await Db.create();
    const ms = await db.as(IDS.concierge, repo.matches);
    for (const m of ms) expect(m.score).toBe(score(byId(m.member_a), byId(m.member_b)).total);
  });
});

describe('exclusions', () => {
  const alex = () => byId(IDS.alex);
  test.each([
    [IDS.hannah, 'blocked'],
    [IDS.priya, 'already_matched'],
    [IDS.mei, 'already_matched'],
    [IDS.omar, 'orientation'],
    [IDS.jules, 'orientation'],
    [IDS.nadia, 'not_ready'],
    [IDS.alex, 'same_member'],
  ])('Alex and %s → %s', (id, reason) => {
    expect(exclusion(alex(), byId(id), ctx)).toBe(reason);
  });

  test('age range must hold both ways', () => {
    const a = { ...alex(), age_max: 30 };
    expect(exclusion(a, byId(IDS.lena), ctx)).toBe('age_range');
    const lena = { ...byId(IDS.lena), age_min: 36 };
    expect(exclusion(alex(), lena, ctx)).toBe('age_range');
  });

  test('blocks apply in both directions', () => {
    expect(exclusion(byId(IDS.hannah), alex(), ctx)).toBe('blocked');
  });
});

describe('concierge ranking', () => {
  test('Alex gets only eligible candidates, best first', () => {
    const ranked = rankCandidates(byId(IDS.alex), pool, ctx).map((c) => c.member.id);
    expect(ranked).toEqual([IDS.lena, IDS.sofia, IDS.dana]);
  });

  test('ranking is deterministic', () => {
    const a = rankCandidates(byId(IDS.lena), pool, ctx).map((c) => c.member.id);
    const b = rankCandidates(byId(IDS.lena), [...pool].reverse(), ctx).map((c) => c.member.id);
    expect(a).toEqual(b);
  });
});

describe('dossier', () => {
  test('gives at most 3 alignment signals and 2 friction points for every pair', () => {
    for (const a of pool) for (const b of pool) {
      const d = dossier(a, b);
      expect(d.alignment.length).toBeLessThanOrEqual(3);
      expect(d.friction.length).toBeLessThanOrEqual(2);
    }
  });

  test('Alex and Priya: shared values and rhythm, honest about uncertainty', () => {
    const d = dossier(byId(IDS.alex), byId(IDS.priya));
    expect(d.alignment).toHaveLength(3);
    expect(d.alignment[0]).toMatch(/family/);
    expect(d.friction.join(' ')).toMatch(/uncertainty/);
  });

  test('flags opposite daily rhythms', () => {
    const d = dossier(byId(IDS.alex), byId(IDS.dana));
    expect(d.friction.join(' ')).toMatch(/pace|early riser and night owl|uncertainty/);
    const sameElse = { ...byId(IDS.alex), id: 'y', lifestyle: ['night_owl'], pace: 'steady' as const, uncertainty: 'medium' as const, intent: 'long_term' as const };
    const early = { ...byId(IDS.alex), lifestyle: ['early_riser'] };
    expect(dossier(early, sameElse).friction).toContain('Opposite daily rhythm: early riser and night owl');
  });
});

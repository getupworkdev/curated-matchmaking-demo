import { beforeEach, describe, expect, test } from 'vitest';
import { Db, IDS } from '../src/db/client';
import * as repo from '../src/db/repo';

let db: Db;
beforeEach(async () => { db = await Db.create(); });

describe('matches stay private until the concierge releases them', () => {
  test('members only see released matches they are part of', async () => {
    const alex = await db.as(IDS.alex, repo.matches);
    expect(alex.map((m) => m.id)).toEqual([IDS.matchAlexPriya]);
    expect(await db.as(IDS.mei, repo.matches)).toHaveLength(0);
    expect(await db.as(IDS.dana, repo.matches)).toHaveLength(0);
    expect(await db.as(IDS.concierge, repo.matches)).toHaveLength(2);
  });

  test("a pending match does not reveal the other member's profile", async () => {
    const seenByMei = (await db.as(IDS.mei, repo.visibleMembers)).map((m) => m.id);
    expect(seenByMei).toEqual([IDS.mei]);
    const seenByAlex = (await db.as(IDS.alex, repo.visibleMembers)).map((m) => m.id).sort();
    expect(seenByAlex).toEqual([IDS.alex, IDS.priya].sort());
  });

  test('releasing a match makes it and the profile visible, and is audited', async () => {
    await db.as(IDS.concierge, (q) => repo.releaseMatch(q, IDS.matchAlexMei));
    expect((await db.as(IDS.mei, repo.matches)).map((m) => m.id)).toEqual([IDS.matchAlexMei]);
    expect((await db.as(IDS.mei, repo.visibleMembers)).map((m) => m.id)).toContain(IDS.alex);
    const audit = await db.as(IDS.concierge, repo.auditLog);
    expect(audit[0]).toMatchObject({ action: 'release_match', target: IDS.matchAlexMei });
  });

  test('a match cannot be released twice, and members cannot release', async () => {
    await expect(db.as(IDS.alex, (q) => repo.releaseMatch(q, IDS.matchAlexMei))).rejects.toThrow(/admin only/);
    await expect(db.as(IDS.concierge, (q) => repo.releaseMatch(q, IDS.matchAlexPriya))).rejects.toThrow(/not pending/);
  });

  test('members cannot change match status directly', async () => {
    await expect(db.as(IDS.alex, (q) => q.rows(`update matches set status = 'released' where id = $1`, [IDS.matchAlexMei])))
      .rejects.toThrow(/permission denied/);
  });
});

describe('messages', () => {
  test('both members of a released match can read and send', async () => {
    expect(await db.as(IDS.priya, (q) => repo.messages(q, IDS.matchAlexPriya))).toHaveLength(2);
    await db.as(IDS.priya, (q) => repo.sendMessage(q, IDS.matchAlexPriya, IDS.priya, 'See you Saturday.'));
    expect(await db.as(IDS.alex, (q) => repo.messages(q, IDS.matchAlexPriya))).toHaveLength(3);
  });

  test('someone outside the match cannot read or send', async () => {
    expect(await db.as(IDS.dana, (q) => repo.messages(q, IDS.matchAlexPriya))).toHaveLength(0);
    await expect(db.as(IDS.dana, (q) => repo.sendMessage(q, IDS.matchAlexPriya, IDS.dana, 'hi')))
      .rejects.toThrow(/row-level security/);
  });

  test('you cannot send as the other person', async () => {
    await expect(db.as(IDS.priya, (q) => repo.sendMessage(q, IDS.matchAlexPriya, IDS.alex, 'spoofed')))
      .rejects.toThrow(/row-level security/);
  });

  test('no messaging inside a pending match', async () => {
    await expect(db.as(IDS.alex, (q) => repo.sendMessage(q, IDS.matchAlexMei, IDS.alex, 'too early')))
      .rejects.toThrow(/row-level security/);
  });
});

describe('concierge actions', () => {
  test('a blocked pair can never be proposed, in either direction', async () => {
    await expect(db.as(IDS.concierge, (q) => repo.proposeMatch(q, IDS.alex, IDS.hannah, 50))).rejects.toThrow(/blocked/);
    await expect(db.as(IDS.concierge, (q) => repo.proposeMatch(q, IDS.hannah, IDS.alex, 50))).rejects.toThrow(/blocked/);
  });

  test('the same pair cannot be proposed twice, whatever the order', async () => {
    await expect(db.as(IDS.concierge, (q) => repo.proposeMatch(q, IDS.priya, IDS.alex, 50))).rejects.toThrow(/duplicate|unique/);
  });

  test('members cannot propose matches or read the audit log', async () => {
    await expect(db.as(IDS.alex, (q) => repo.proposeMatch(q, IDS.alex, IDS.lena, 99))).rejects.toThrow(/admin only/);
    expect(await db.as(IDS.alex, repo.auditLog)).toHaveLength(0);
  });

  test('members cannot see who blocked them', async () => {
    expect(await db.as(IDS.hannah, (q) => q.rows('select * from blocks'))).toHaveLength(0);
    expect(await db.as(IDS.alex, (q) => q.rows('select * from blocks'))).toHaveLength(1);
  });
});

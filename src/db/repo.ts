// Queries shared by the UI and the tests. Each takes a Query that is already scoped to a member.
import type { Context, Member } from '../domain/scoring';
import type { Query } from './client';

export interface MemberRow extends Member {
  initials: string;
  city: string;
  is_admin: boolean;
}

const MEMBER_COLS = `id, display_name, initials, age, city, gender, seeking, age_min, age_max, status, is_admin,
  onboarded, strategy, pace, uncertainty, values, lifestyle, intent`;

export const me = (q: Query, id: string) =>
  q.one<MemberRow>(`select ${MEMBER_COLS} from members where id = $1`, [id]);

/** Everyone the current role is allowed to see (RLS decides). */
export const visibleMembers = (q: Query) =>
  q.rows<MemberRow>(`select ${MEMBER_COLS} from members order by display_name`);

/** Concierge view: pool of members plus the hard-exclusion context. */
export async function conciergePool(q: Query): Promise<{ members: MemberRow[]; ctx: Context }> {
  const members = (await visibleMembers(q)).filter((m) => !m.is_admin);
  const blocks = await q.rows<{ blocker: string; blocked: string }>(`select blocker, blocked from blocks`);
  const matches = await q.rows<{ member_a: string; member_b: string }>(`select member_a, member_b from matches`);
  return {
    members,
    ctx: {
      blocked: blocks.map((b) => [b.blocker, b.blocked] as [string, string]),
      existing: matches.map((m) => [m.member_a, m.member_b] as [string, string]),
    },
  };
}

export interface MatchRow {
  id: string;
  member_a: string;
  member_b: string;
  status: 'pending_review' | 'released' | 'declined';
  score: number;
  created_at: string;
  released_at: string | null;
}

export const matches = (q: Query) =>
  q.rows<MatchRow>(`select id, member_a, member_b, status, score, created_at, released_at from matches order by created_at desc`);

export interface MessageRow { id: string; match_id: string; sender: string; body: string; created_at: string }

export const messages = (q: Query, matchId: string) =>
  q.rows<MessageRow>(`select id, match_id, sender, body, created_at from messages where match_id = $1 order by created_at`, [matchId]);

export const sendMessage = (q: Query, matchId: string, sender: string, body: string) =>
  q.rows(`insert into messages (match_id, sender, body) values ($1, $2, $3)`, [matchId, sender, body]);

export interface LedgerRow {
  id: string; member_id: string; kind: string; amount: number; product_id: string | null;
  store_txn_id: string | null; refunds: string | null; note: string | null; created_at: string;
}

export const ledger = (q: Query) =>
  q.rows<LedgerRow>(`select id, member_id, kind, amount, product_id, store_txn_id, refunds, note, created_at
                     from coin_ledger order by created_at desc`);

export const balance = async (q: Query, memberId: string) =>
  (await q.one<{ b: number }>(`select coin_balance($1) as b`, [memberId])).b;

export const creditPurchase = async (q: Query, product: string, txn: string) =>
  (await q.one<{ b: number }>(`select credit_purchase($1, $2) as b`, [product, txn])).b;

export const spendCoin = async (q: Query, note?: string) =>
  (await q.one<{ b: number }>(note ? `select spend_coin($1) as b` : `select spend_coin() as b`, note ? [note] : [])).b;

export const refundPurchase = async (q: Query, purchaseId: string) =>
  (await q.one<{ b: number }>(`select admin_refund_purchase($1) as b`, [purchaseId])).b;

export const restoreEntitlement = (q: Query, product: string, originalTxn: string) =>
  q.rows(`select restore_entitlement($1, $2)`, [product, originalTxn]);

export const entitlements = (q: Query) =>
  q.rows<{ member_id: string; product_id: string; original_txn_id: string }>(
    `select member_id, product_id, original_txn_id from entitlements`);

export const products = (q: Query) =>
  q.rows<{ id: string; kind: string; coins: number; price_usd: string; label: string }>(
    `select id, kind, coins, price_usd, label from products order by kind, coins`);

export const setWaitlist = (q: Query, memberId: string, status: 'approved' | 'declined') =>
  q.rows(`select admin_set_waitlist($1, $2)`, [memberId, status]);

export const proposeMatch = async (q: Query, a: string, b: string, score: number) =>
  (await q.one<{ id: string }>(`select admin_propose_match($1, $2, $3) as id`, [a, b, score])).id;

export const releaseMatch = (q: Query, matchId: string) =>
  q.rows(`select admin_release_match($1)`, [matchId]);

export interface Onboarding {
  strategy: string; pace: string; uncertainty: string; values: string[]; lifestyle: string[]; intent: string;
}
export const saveOnboarding = (q: Query, o: Onboarding) =>
  q.rows(`select save_onboarding($1, $2, $3, $4, $5, $6)`,
    [o.strategy, o.pace, o.uncertainty, o.values, o.lifestyle, o.intent]);

export interface AuditRow { id: number; actor: string | null; action: string; target: string | null; detail: unknown; at: string }
export const auditLog = (q: Query) =>
  q.rows<AuditRow>(`select id, actor, action, target, detail, at from audit_log order by id desc limit 50`);

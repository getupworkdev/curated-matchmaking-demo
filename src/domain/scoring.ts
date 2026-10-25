// Deterministic compatibility scoring and dossier for a curated matchmaking app.
// Pure functions: no I/O, fully unit-tested. The concierge sees the ranking; members see the dossier.

export type Strategy = 'comfort' | 'balanced' | 'growth';
export type Pace = 'slow' | 'steady' | 'fast';
export type Uncertainty = 'low' | 'medium' | 'high';
export type Intent = 'long_term' | 'marriage' | 'open';
export type Gender = 'woman' | 'man' | 'nonbinary';

export interface Member {
  id: string;
  display_name: string;
  age: number;
  gender: Gender;
  seeking: Gender[];
  age_min: number;
  age_max: number;
  status: 'waitlist' | 'approved' | 'declined';
  onboarded: boolean;
  strategy: Strategy | null;
  pace: Pace | null;
  uncertainty: Uncertainty | null;
  values: string[];
  lifestyle: string[];
  intent: Intent | null;
}

export interface Context {
  /** unordered pairs that blocked each other (either direction) */
  blocked: Array<[string, string]>;
  /** unordered pairs that already have a match row in any status */
  existing: Array<[string, string]>;
}

export type Exclusion =
  | 'same_member'
  | 'not_ready'
  | 'blocked'
  | 'already_matched'
  | 'orientation'
  | 'age_range';

const pairHas = (pairs: Array<[string, string]>, a: string, b: string) =>
  pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/** Hard rules: if any applies, the pair is never shown to the concierge as a candidate. */
export function exclusion(a: Member, b: Member, ctx: Context): Exclusion | null {
  if (a.id === b.id) return 'same_member';
  const ready = (m: Member) => m.status === 'approved' && m.onboarded;
  if (!ready(a) || !ready(b)) return 'not_ready';
  if (pairHas(ctx.blocked, a.id, b.id)) return 'blocked';
  if (pairHas(ctx.existing, a.id, b.id)) return 'already_matched';
  if (!a.seeking.includes(b.gender) || !b.seeking.includes(a.gender)) return 'orientation';
  const inRange = (m: Member, other: Member) => other.age >= m.age_min && other.age <= m.age_max;
  if (!inRange(a, b) || !inRange(b, a)) return 'age_range';
  return null;
}

const PACE: Pace[] = ['slow', 'steady', 'fast'];
const UNC: Uncertainty[] = ['low', 'medium', 'high'];
const STRAT: Strategy[] = ['comfort', 'balanced', 'growth'];

function stepDistance<T>(scale: T[], x: T | null, y: T | null): number {
  if (x == null || y == null) return 2;
  return Math.abs(scale.indexOf(x) - scale.indexOf(y));
}

function overlap(x: string[], y: string[]) {
  const sx = new Set(x);
  const shared = [...new Set(y)].filter((v) => sx.has(v)).sort();
  const union = new Set([...x, ...y]).size;
  return { shared, jaccard: union === 0 ? 0 : shared.length / union };
}

function intentPoints(a: Intent | null, b: Intent | null): number {
  if (!a || !b) return 0;
  if (a === b) return 10;
  const serious = (i: Intent) => i === 'long_term' || i === 'marriage';
  return serious(a) && serious(b) ? 6 : 0;
}

export interface Breakdown {
  values: number;    // /35
  lifestyle: number; // /20
  pace: number;      // /15
  strategy: number;  // /10
  uncertainty: number; // /10
  intent: number;    // /10
  total: number;     // /100
}

/** Symmetric by construction: every component depends only on the unordered pair. */
export function score(a: Member, b: Member): Breakdown {
  const v = overlap(a.values, b.values);
  const l = overlap(a.lifestyle, b.lifestyle);
  const values = Math.round(35 * v.jaccard);
  const lifestyle = Math.round(20 * l.jaccard);
  const pace = [15, 8, 0][stepDistance(PACE, a.pace, b.pace)];
  const strategy = [10, 6, 2][stepDistance(STRAT, a.strategy, b.strategy)];
  const uncertainty = [10, 6, 0][stepDistance(UNC, a.uncertainty, b.uncertainty)];
  const intent = intentPoints(a.intent, b.intent);
  const total = values + lifestyle + pace + strategy + uncertainty + intent;
  return { values, lifestyle, pace, strategy, uncertainty, intent, total };
}

export interface Candidate { member: Member; breakdown: Breakdown }

/** Concierge ranking for one member: excluded pairs removed, highest score first, ties by id (stable). */
export function rankCandidates(target: Member, pool: Member[], ctx: Context): Candidate[] {
  return pool
    .filter((m) => exclusion(target, m, ctx) === null)
    .map((m) => ({ member: m, breakdown: score(target, m) }))
    .sort((x, y) => y.breakdown.total - x.breakdown.total || x.member.id.localeCompare(y.member.id));
}

const label = (s: string) => s.replace(/_/g, ' ');

export interface Dossier { alignment: string[]; friction: string[] }

/** Three alignment signals and up to two possible friction points, written for members. */
export function dossier(a: Member, b: Member): Dossier {
  const v = overlap(a.values, b.values);
  const l = overlap(a.lifestyle, b.lifestyle);
  const align: string[] = [];
  const friction: string[] = [];

  if (v.shared.length) align.push(`Shared values: ${v.shared.map(label).join(', ')}`);
  if (l.shared.length) align.push(`Similar rhythm: ${l.shared.map(label).join(', ')}`);
  if (a.pace && a.pace === b.pace) align.push(`Same pace: both prefer to move ${a.pace === 'steady' ? 'steadily' : a.pace}`);
  if (a.intent && a.intent === b.intent) align.push(`Same intent: ${label(a.intent)}`);
  if (a.strategy && a.strategy === b.strategy) align.push(`Same matching strategy: ${a.strategy}`);
  if (a.uncertainty && a.uncertainty === b.uncertainty) align.push(`Similar comfort with uncertainty (${a.uncertainty})`);

  if (stepDistance(PACE, a.pace, b.pace) === 2) friction.push('Very different pace: one moves slowly, the other fast');
  else if (stepDistance(PACE, a.pace, b.pace) === 1) friction.push(`Pace differs a little (${a.pace} vs ${b.pace})`);
  if (stepDistance(UNC, a.uncertainty, b.uncertainty) >= 1)
    friction.push(`Different comfort with uncertainty (${a.uncertainty} vs ${b.uncertainty})`);
  if (a.intent !== b.intent) friction.push(`Intent differs (${label(a.intent ?? 'unknown')} vs ${label(b.intent ?? 'unknown')})`);
  const onlyA = a.lifestyle.filter((x) => !b.lifestyle.includes(x));
  const onlyB = b.lifestyle.filter((x) => !a.lifestyle.includes(x));
  if (onlyA.includes('early_riser') && onlyB.includes('night_owl') || onlyA.includes('night_owl') && onlyB.includes('early_riser'))
    friction.push('Opposite daily rhythm: early riser and night owl');

  return { alignment: align.slice(0, 3), friction: friction.slice(0, 2) };
}

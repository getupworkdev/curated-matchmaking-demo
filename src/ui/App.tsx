import { useCallback, useEffect, useMemo, useState } from 'react';
import { Db, IDS, errorText } from '../db/client';
import * as repo from '../db/repo';
import { dossier, rankCandidates, score, type Member } from '../domain/scoring';

type Viewer = { id: string; label: string; hint: string };
const VIEWERS: Viewer[] = [
  { id: IDS.alex, label: 'Alex (member)', hint: '1 released match, 1 hidden in review' },
  { id: IDS.priya, label: 'Priya (member)', hint: 'Matched with Alex, owns 3 coins' },
  { id: IDS.dana, label: 'Dana (member)', hint: 'No matches yet' },
  { id: IDS.nadia, label: 'Nadia (waitlist)', hint: 'Waiting for approval' },
  { id: IDS.concierge, label: 'Concierge', hint: 'Reviews and releases matches' },
];

type Toast = { kind: 'ok' | 'err'; text: string } | null;

export function App() {
  const [db, setDb] = useState<Db | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [viewer, setViewer] = useState(IDS.alex as string);
  const [rev, setRev] = useState(0);
  const [toast, setToast] = useState<Toast>(null);

  const boot = useCallback(() => {
    setDb(null);
    loadBundle().then((fsBundle) => Db.create({ fsBundle })).then(setDb, (e) => setBootError(errorText(e)));
  }, []);
  useEffect(boot, [boot]);

  const refresh = () => setRev((r) => r + 1);
  const act = useCallback(
    async (fn: () => Promise<unknown>, ok?: string) => {
      try {
        await fn();
        if (ok) setToast({ kind: 'ok', text: ok });
      } catch (e) {
        setToast({ kind: 'err', text: errorText(e) });
      } finally {
        setRev((r) => r + 1);
      }
    },
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden>◐</span>
          <div>
            <div className="name">Kindred Circle</div>
            <div className="sub">Curated matchmaking backend demo · fictional brand and data</div>
          </div>
        </div>
        <div className="viewer">
          <label htmlFor="viewer">Signed in as</label>
          <select id="viewer" value={viewer} onChange={(e) => setViewer(e.target.value)}>
            {VIEWERS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
          <span className="hint">{VIEWERS.find((v) => v.id === viewer)?.hint}</span>
          <button className="ghost" onClick={() => { boot(); setToast({ kind: 'ok', text: 'Database reset to seed data' }); }}>Reset data</button>
        </div>
      </header>

      <p className="banner">
        A real Postgres database (PGlite) is running in this tab with the same migration that deploys to Supabase.
        Switching user changes the Postgres role and <code>auth.uid()</code>, so everything you see is filtered by row-level security, not by the UI.
      </p>

      {bootError && <div className="card err">Could not start the database: {bootError}</div>}
      {!db && !bootError && <div className="card muted">Starting Postgres in your browser…</div>}
      {db && (viewer === IDS.concierge
        ? <Concierge db={db} rev={rev} act={act} />
        : <MemberApp key={viewer} db={db} me={viewer} rev={rev} act={act} refresh={refresh} />)}

      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
      <footer className="foot">
        Schema, tests and source: <a href="https://github.com/getupworkdev/curated-matchmaking-demo">github.com/getupworkdev/curated-matchmaking-demo</a>
      </footer>
    </div>
  );
}

// Some static hosts only serve web file types, so the build also ships PGlite's data bundle as pglite-fs.wasm.
let bundle: Promise<Blob | undefined> | null = null;
function loadBundle() {
  bundle ??= fetch('./pglite-fs.wasm').then((r) => (r.ok ? r.blob() : undefined), () => undefined);
  return bundle;
}

type Act = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;

/* ------------------------------------------------------------------------- */
/* Member                                                                    */
/* ------------------------------------------------------------------------- */

function MemberApp({ db, me, rev, act, refresh }: { db: Db; me: string; rev: number; act: Act; refresh: () => void }) {
  const [tab, setTab] = useState<'portfolio' | 'messages' | 'wallet' | 'profile' | 'security'>('portfolio');
  const [profile, setProfile] = useState<repo.MemberRow | null>(null);
  const [people, setPeople] = useState<repo.MemberRow[]>([]);
  const [ms, setMs] = useState<repo.MatchRow[]>([]);

  useEffect(() => {
    db.as(me, async (q) => {
      setProfile(await repo.me(q, me));
      setPeople(await repo.visibleMembers(q));
      setMs(await repo.matches(q));
    });
  }, [db, me, rev]);

  if (!profile) return null;
  if (profile.status === 'waitlist') {
    return (
      <section className="card center">
        <h2>You're on the waitlist, {profile.display_name.split(' ')[0]}</h2>
        <p className="muted">Every member is reviewed by a concierge before onboarding. You'll get access as soon as you're approved.</p>
        <p className="muted small">Try it: switch to <b>Concierge</b>, approve {profile.display_name.split(' ')[0]} on the Waitlist tab, then come back here.</p>
      </section>
    );
  }
  if (profile.status === 'declined') {
    return <section className="card center"><h2>Membership not offered</h2><p className="muted">The concierge declined this application.</p></section>;
  }

  const other = (m: repo.MatchRow) => people.find((p) => p.id === (m.member_a === me ? m.member_b : m.member_a));

  return (
    <>
      <nav className="tabs" aria-label="Member">
        {(['portfolio', 'messages', 'wallet', 'profile', 'security'] as const).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {{ portfolio: 'Portfolio', messages: 'Messages', wallet: 'Wallet', profile: 'Onboarding', security: 'Try to break it' }[t]}
          </button>
        ))}
      </nav>
      {tab === 'portfolio' && <Portfolio me={profile} matches={ms} other={other} onOpen={() => setTab('messages')} />}
      {tab === 'messages' && <Messages db={db} me={me} matches={ms} other={other} rev={rev} act={act} />}
      {tab === 'wallet' && <Wallet db={db} me={me} rev={rev} act={act} />}
      {tab === 'profile' && <Onboarding db={db} me={profile} act={act} refresh={refresh} />}
      {tab === 'security' && <Attacks db={db} me={me} />}
    </>
  );
}

function Portfolio({ me, matches, other, onOpen }: {
  me: Member; matches: repo.MatchRow[]; other: (m: repo.MatchRow) => repo.MemberRow | undefined; onOpen: () => void;
}) {
  if (!matches.length) {
    return (
      <section className="card center">
        <h2>Your portfolio is being curated</h2>
        <p className="muted">Introductions appear here only after a concierge reviews and releases them.</p>
      </section>
    );
  }
  return (
    <section className="grid">
      {matches.map((m) => {
        const o = other(m);
        if (!o) return null;
        const d = dossier(me, o);
        return (
          <article key={m.id} className="card match">
            <div className="row">
              <div className="avatar">{o.initials}</div>
              <div className="grow">
                <h3>{o.display_name}, {o.age}</h3>
                <div className="muted small">{o.city} · released {fmtAgo(m.released_at)}</div>
              </div>
              <div className="score" title="Compatibility score">{m.score}</div>
            </div>
            <h4>Why this could work</h4>
            <ul className="align">{d.alignment.map((a) => <li key={a}>{a}</li>)}</ul>
            {d.friction.length > 0 && (<>
              <h4>Worth talking about</h4>
              <ul className="friction">{d.friction.map((f) => <li key={f}>{f}</li>)}</ul>
            </>)}
            <button onClick={onOpen}>Open conversation</button>
          </article>
        );
      })}
    </section>
  );
}

function Messages({ db, me, matches, other, rev, act }: {
  db: Db; me: string; matches: repo.MatchRow[]; other: (m: repo.MatchRow) => repo.MemberRow | undefined; rev: number; act: Act;
}) {
  const [sel, setSel] = useState<string | null>(matches[0]?.id ?? null);
  const [thread, setThread] = useState<repo.MessageRow[]>([]);
  const [draft, setDraft] = useState('');
  useEffect(() => {
    if (!sel) return;
    db.as(me, (q) => repo.messages(q, sel)).then(setThread);
  }, [db, me, sel, rev]);

  if (!matches.length) return <section className="card center"><p className="muted">Messaging opens once you have a released introduction.</p></section>;
  const cur = matches.find((m) => m.id === sel);
  const o = cur && other(cur);
  return (
    <section className="card chat">
      <div className="chat-list">
        {matches.map((m) => (
          <button key={m.id} className={m.id === sel ? 'on' : ''} onClick={() => setSel(m.id)}>{other(m)?.display_name}</button>
        ))}
      </div>
      <div className="chat-thread">
        <div className="bubbles">
          {thread.map((t) => (
            <div key={t.id} className={`bubble ${t.sender === me ? 'mine' : ''}`}>
              {t.body}<span className="time">{fmtTime(t.created_at)}</span>
            </div>
          ))}
          {!thread.length && <p className="muted small">Say hello to {o?.display_name}.</p>}
        </div>
        <form className="compose" onSubmit={(e) => {
          e.preventDefault();
          const body = draft.trim();
          if (!body || !sel) return;
          setDraft('');
          act(() => db.as(me, (q) => repo.sendMessage(q, sel, me, body)));
        }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a message" maxLength={2000} aria-label="Message" />
          <button type="submit">Send</button>
        </form>
      </div>
    </section>
  );
}

function Wallet({ db, me, rev, act }: { db: Db; me: string; rev: number; act: Act }) {
  const [bal, setBal] = useState(0);
  const [rows, setRows] = useState<repo.LedgerRow[]>([]);
  const [prods, setProds] = useState<Awaited<ReturnType<typeof repo.products>>>([]);
  const [ents, setEnts] = useState<Awaited<ReturnType<typeof repo.entitlements>>>([]);
  const [lastTxn, setLastTxn] = useState<{ product: string; txn: string } | null>(null);
  const [race, setRace] = useState<string | null>(null);

  useEffect(() => {
    db.as(me, async (q) => {
      setBal(await repo.balance(q, me));
      setRows(await repo.ledger(q));
      setProds(await repo.products(q));
      setEnts(await repo.entitlements(q));
    });
  }, [db, me, rev]);

  const buy = (product: string) => {
    const txn = String(2000000000000000 + Math.floor(Math.random() * 1e12));
    setLastTxn({ product, txn });
    act(() => db.as(me, (q) => repo.creditPurchase(q, product, txn)), `Receipt ${txn} verified and credited`);
  };
  const replay = () => lastTxn && act(
    () => db.as(me, (q) => repo.creditPurchase(q, lastTxn.product, lastTxn.txn)),
    `Same receipt posted again: no extra coins (idempotent on store transaction id)`,
  );
  const raceSpend = async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => db.as(me, (q) => repo.spendCoin(q))));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    setRace(`5 taps sent at once with a balance of ${bal}: ${ok} succeeded, ${5 - ok} refused ("insufficient coins").`);
    act(async () => undefined);
  };
  const filters = ents.some((e) => e.product_id === 'advanced_filters');

  return (
    <section className="grid two">
      <div className="card">
        <div className="muted small">Balance</div>
        <div className="big">{bal} <span className="unit">coins</span></div>
        <p className="muted small">One coin requests one extra curated introduction. The balance is the sum of an append-only ledger, never a column anyone can overwrite.</p>
        <div className="packs">
          {prods.filter((p) => p.kind === 'consumable').map((p) => (
            <button key={p.id} className="pack" onClick={() => buy(p.id)}>
              <b>{p.coins} coins</b><span>${Number(p.price_usd).toFixed(0)}</span>
            </button>
          ))}
        </div>
        <div className="stack">
          <button className="ghost" disabled={!lastTxn} onClick={replay}>Post the last receipt again</button>
          <button className="ghost" onClick={() => act(() => db.as(me, (q) => repo.spendCoin(q)), 'Coin spent: introduction requested')}>Spend 1 coin</button>
          <button className="ghost" onClick={raceSpend}>Tap "spend" 5 times at once</button>
          {race && <p className="note">{race}</p>}
        </div>
        <hr />
        <div className="row">
          <div className="grow">
            <b>Advanced filters</b> <span className="muted small">one-time unlock</span>
            <div className="muted small">{filters ? 'Unlocked' : 'Locked'}</div>
          </div>
          <button className="ghost" onClick={() => act(
            () => db.as(me, (q) => repo.restoreEntitlement(q, 'advanced_filters', `orig-${me.slice(-4)}`)),
            filters ? 'Restore ran again: still exactly one unlock' : 'Unlocked',
          )}>{filters ? 'Restore purchases' : 'Unlock'}</button>
        </div>
      </div>
      <div className="card">
        <h3>Ledger</h3>
        {!rows.length && <p className="muted small">No entries yet.</p>}
        <table className="ledger">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><span className={`kind ${r.kind}`}>{r.kind.replace('_', ' ')}</span></td>
                <td className="grow">{r.note}<div className="muted tiny">{r.store_txn_id ? `txn ${r.store_txn_id}` : fmtTime(r.created_at)}</div></td>
                <td className={r.amount > 0 ? 'pos' : 'neg'}>{r.amount > 0 ? '+' : ''}{r.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const VALUES = ['family', 'honesty', 'ambition', 'kindness', 'curiosity', 'faith', 'growth', 'adventure', 'creativity'];
const LIFESTYLE = ['early_riser', 'night_owl', 'fitness', 'travel', 'cooking', 'reading', 'homebody', 'nightlife'];

function Onboarding({ db, me, act, refresh }: { db: Db; me: repo.MemberRow; act: Act; refresh: () => void }) {
  const [f, setF] = useState<repo.Onboarding>({
    strategy: me.strategy ?? '', pace: me.pace ?? '', uncertainty: me.uncertainty ?? '',
    values: me.values, lifestyle: me.lifestyle, intent: me.intent ?? '',
  });
  const toggle = (k: 'values' | 'lifestyle', v: string) =>
    setF((s) => ({ ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v] }));
  const choice = (k: 'strategy' | 'pace' | 'uncertainty' | 'intent', opts: [string, string][]) => (
    <div className="chips">
      {opts.map(([v, l]) => (
        <button type="button" key={v} className={f[k] === v ? 'chip on' : 'chip'} onClick={() => setF((s) => ({ ...s, [k]: v }))}>{l}</button>
      ))}
    </div>
  );
  return (
    <form className="card form" onSubmit={(e) => {
      e.preventDefault();
      act(() => db.as(me.id, (q) => repo.saveOnboarding(q, f)), 'Onboarding saved').then(refresh);
    }}>
      <p className="muted small">Validation runs in the database function <code>save_onboarding</code>, so a modified app can't skip it. Try saving with fewer than 2 values.</p>
      <label>How should we match you?</label>
      {choice('strategy', [['comfort', 'Comfort: similar to me'], ['balanced', 'Balanced'], ['growth', 'Growth: stretch me']])}
      <label>Pace</label>
      {choice('pace', [['slow', 'Slow'], ['steady', 'Steady'], ['fast', 'Fast']])}
      <label>Comfort with uncertainty</label>
      {choice('uncertainty', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])}
      <label>Values (pick at least 2)</label>
      <div className="chips">{VALUES.map((v) => (
        <button type="button" key={v} className={f.values.includes(v) ? 'chip on' : 'chip'} onClick={() => toggle('values', v)}>{v}</button>
      ))}</div>
      <label>Daily rhythm</label>
      <div className="chips">{LIFESTYLE.map((v) => (
        <button type="button" key={v} className={f.lifestyle.includes(v) ? 'chip on' : 'chip'} onClick={() => toggle('lifestyle', v)}>{v.replace('_', ' ')}</button>
      ))}</div>
      <label>Looking for</label>
      {choice('intent', [['long_term', 'Long-term'], ['marriage', 'Marriage'], ['open', 'Open']])}
      <button type="submit">Save answers</button>
    </form>
  );
}

function Attacks({ db, me }: { db: Db; me: string }) {
  const [out, setOut] = useState<Record<string, string>>({});
  const tries: { key: string; label: string; run: () => Promise<unknown> }[] = [
    { key: 'pending', label: "Read the match that's still in concierge review", run: () => db.as(me, (q) => q.rows(`select id, status from matches where status = 'pending_review'`)) },
    { key: 'release', label: 'Release a match myself', run: () => db.as(me, (q) => repo.releaseMatch(q, IDS.matchAlexMei)) },
    { key: 'update', label: 'UPDATE matches SET status = released', run: () => db.as(me, (q) => q.rows(`update matches set status = 'released' returning id`)) },
    { key: 'read', label: "Read Alex and Priya's messages", run: () => db.as(me, (q) => repo.messages(q, IDS.matchAlexPriya)) },
    { key: 'spoof', label: 'Send a message as someone else', run: () => db.as(me, (q) => repo.sendMessage(q, IDS.matchAlexPriya, me === IDS.alex ? IDS.priya : IDS.alex, 'spoofed')) },
    { key: 'grant', label: 'Give myself 100 coins', run: () => db.as(me, (q) => q.rows(`insert into coin_ledger (member_id, kind, amount) values ($1, 'admin_grant', 100)`, [me])) },
    { key: 'peek', label: "Check Priya's coin balance", run: () => db.as(me, (q) => repo.balance(q, IDS.priya)) },
    { key: 'members', label: 'List every member', run: () => db.as(me, (q) => q.rows(`select display_name from members`)) },
    { key: 'audit', label: 'Read the concierge audit log', run: () => db.as(me, (q) => repo.auditLog(q)) },
  ];
  const run = async (t: (typeof tries)[number]) => {
    try {
      const r = await t.run();
      const text = Array.isArray(r)
        ? (r.length ? `Returned ${r.length} row(s): ${JSON.stringify(r).slice(0, 160)}` : 'Returned 0 rows (filtered by row-level security)')
        : `Returned ${JSON.stringify(r)}`;
      setOut((o) => ({ ...o, [t.key]: text }));
    } catch (e) {
      setOut((o) => ({ ...o, [t.key]: `Refused by Postgres: ${errorText(e)}` }));
    }
  };
  return (
    <section className="card">
      <p className="muted small">Each button runs raw SQL as the signed-in member, the same as a modified client calling the Supabase API with their own token. Results depend on who you're signed in as: Alex may read his own match with Priya; switch to Dana and every one of these is refused or filtered.</p>
      <ul className="attacks">
        {tries.map((t) => (
          <li key={t.key}>
            <button className="ghost" onClick={() => run(t)}>{t.label}</button>
            {out[t.key] && <code className={out[t.key].startsWith('Refused') || out[t.key].startsWith('Returned 0') ? 'safe' : 'shown'}>{out[t.key]}</code>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Concierge                                                                 */
/* ------------------------------------------------------------------------- */

function Concierge({ db, rev, act }: { db: Db; rev: number; act: Act }) {
  const [tab, setTab] = useState<'review' | 'candidates' | 'waitlist' | 'ledger' | 'audit'>('review');
  const [pool, setPool] = useState<Awaited<ReturnType<typeof repo.conciergePool>> | null>(null);
  const [ms, setMs] = useState<repo.MatchRow[]>([]);
  const [rows, setRows] = useState<repo.LedgerRow[]>([]);
  const [audit, setAudit] = useState<repo.AuditRow[]>([]);
  const [target, setTarget] = useState<string>(IDS.alex);
  const C = IDS.concierge;

  useEffect(() => {
    db.as(C, async (q) => {
      setPool(await repo.conciergePool(q));
      setMs(await repo.matches(q));
      setRows(await repo.ledger(q));
      setAudit(await repo.auditLog(q));
    });
  }, [db, rev, C]);

  const name = useMemo(() => {
    const m = new Map(pool?.members.map((p) => [p.id, p.display_name]));
    m.set(C, 'Concierge');
    return (id: string | null) => (id && m.get(id)) || id?.slice(-4) || '—';
  }, [pool, C]);
  if (!pool) return null;
  const get = (id: string) => pool.members.find((m) => m.id === id)!;
  const pending = ms.filter((m) => m.status === 'pending_review');
  const waitlist = pool.members.filter((m) => m.status === 'waitlist');
  const eligible = pool.members.filter((m) => m.status === 'approved' && m.onboarded);
  const ranked = get(target) ? rankCandidates(get(target), pool.members, pool.ctx) : [];

  return (
    <>
      <nav className="tabs" aria-label="Concierge">
        {([['review', `Review queue (${pending.length})`], ['candidates', 'Find candidates'], ['waitlist', `Waitlist (${waitlist.length})`], ['ledger', 'Coins & refunds'], ['audit', 'Audit log']] as const).map(([t, l]) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>
        ))}
      </nav>

      {tab === 'review' && (
        <section className="grid">
          {!pending.length && <div className="card center muted">Nothing waiting. Propose a match from "Find candidates".</div>}
          {pending.map((m) => {
            const a = get(m.member_a), b = get(m.member_b);
            const d = dossier(a, b);
            return (
              <article key={m.id} className="card match">
                <div className="row">
                  <div className="avatar">{a.initials}</div><div className="avatar">{b.initials}</div>
                  <div className="grow"><h3>{a.display_name} & {b.display_name}</h3><div className="muted small">proposed {fmtAgo(m.created_at)} · invisible to both until released</div></div>
                  <div className="score">{m.score}</div>
                </div>
                <h4>Alignment</h4><ul className="align">{d.alignment.map((x) => <li key={x}>{x}</li>)}</ul>
                {d.friction.length > 0 && <><h4>Friction</h4><ul className="friction">{d.friction.map((x) => <li key={x}>{x}</li>)}</ul></>}
                <button onClick={() => act(() => db.as(C, (q) => repo.releaseMatch(q, m.id)), `Released to ${a.display_name} and ${b.display_name}`)}>Release to both portfolios</button>
              </article>
            );
          })}
        </section>
      )}

      {tab === 'candidates' && (
        <section className="card">
          <div className="row">
            <label htmlFor="target" className="grow">Find introductions for</label>
            <select id="target" value={target} onChange={(e) => setTarget(e.target.value)}>
              {eligible.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
            </select>
          </div>
          <p className="muted small">Blocked pairs, existing matches, orientation and both members' age ranges are hard exclusions. Score: values 35, lifestyle 20, pace 15, strategy 10, uncertainty 10, intent 10.</p>
          {!ranked.length && <p className="muted">No eligible candidates right now.</p>}
          <table className="rank">
            <thead><tr><th>Candidate</th><th>Values</th><th>Rhythm</th><th>Pace</th><th>Strategy</th><th>Uncert.</th><th>Intent</th><th>Total</th><th /></tr></thead>
            <tbody>
              {ranked.map(({ member: c, breakdown: s }) => (
                <tr key={c.id}>
                  <td>{c.display_name}, {c.age}</td><td>{s.values}</td><td>{s.lifestyle}</td><td>{s.pace}</td><td>{s.strategy}</td><td>{s.uncertainty}</td><td>{s.intent}</td>
                  <td><b>{s.total}</b></td>
                  <td><button className="small-btn" onClick={() => act(() => db.as(C, (q) => repo.proposeMatch(q, target, c.id, score(get(target), c).total)), 'Proposed: now in the review queue')}>Propose</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'waitlist' && (
        <section className="card">
          {!waitlist.length && <p className="muted">Waitlist is empty.</p>}
          {waitlist.map((m) => (
            <div key={m.id} className="row line">
              <div className="avatar">{m.initials}</div>
              <div className="grow"><b>{m.display_name}</b>, {m.age} · {m.city}</div>
              <button onClick={() => act(() => db.as(C, (q) => repo.setWaitlist(q, m.id, 'approved')), `${m.display_name} approved`)}>Approve</button>
              <button className="ghost" onClick={() => act(() => db.as(C, (q) => repo.setWaitlist(q, m.id, 'declined')), `${m.display_name} declined`)}>Decline</button>
            </div>
          ))}
        </section>
      )}

      {tab === 'ledger' && (
        <section className="card">
          <p className="muted small">Refunds reverse one purchase, once, and are refused if those coins were already spent. In production this is triggered by App Store Server Notifications (REFUND).</p>
          <table className="ledger">
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><span className={`kind ${r.kind}`}>{r.kind.replace('_', ' ')}</span></td>
                  <td className="grow">{name(r.member_id)} · {r.note}<div className="muted tiny">{r.store_txn_id ? `txn ${r.store_txn_id}` : fmtTime(r.created_at)}</div></td>
                  <td className={r.amount > 0 ? 'pos' : 'neg'}>{r.amount > 0 ? '+' : ''}{r.amount}</td>
                  <td>{r.kind === 'purchase' && <button className="small-btn ghost" onClick={() => act(() => db.as(C, (q) => repo.refundPurchase(q, r.id)), 'Refunded')}>Refund</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'audit' && (
        <section className="card">
          <table className="ledger">
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td className="muted tiny">{fmtTime(a.at)}</td>
                  <td><b>{a.action.replace(/_/g, ' ')}</b></td>
                  <td className="grow muted small">{a.target ? describeTarget(a.target, ms, name) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function describeTarget(id: string, ms: repo.MatchRow[], name: (id: string | null) => string) {
  const m = ms.find((x) => x.id === id);
  return m ? `${name(m.member_a)} & ${name(m.member_b)}` : name(id);
}

function fmtAgo(ts: string | null) {
  if (!ts) return '';
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
function fmtTime(ts: string) {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

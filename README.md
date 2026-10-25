# Curated matchmaking backend demo

A working slice of a concierge-led matchmaking app backend: Supabase Postgres schema with row-level security, an idempotent in-app coin ledger, a deterministic compatibility scorer with a member-facing dossier, and a concierge review → release flow with an audit log.

The brand ("Kindred Circle") and every person in the seed data are fictional.

**Try it in the browser:** the demo runs a real Postgres (PGlite, compiled to WebAssembly) inside the tab, loaded with the same migration that deploys to Supabase. Switching user changes the Postgres role and `auth.uid()`, so what each person sees is decided by RLS, not by the UI.

```bash
npm install
npm test        # 57 tests against real Postgres (PGlite)
npm run dev     # open the demo at http://localhost:5173
```

## What's in it

| Area | Where | How it works |
|---|---|---|
| Schema + RLS | `supabase/migrations/0001_schema.sql` | Members, matches, messages, products, coin ledger, entitlements, audit log. Every table has RLS. Members can only write messages directly; everything else goes through `security definer` functions that check the caller. |
| Concierge flow | `admin_propose_match`, `admin_release_match`, `admin_set_waitlist` | Matches start as `pending_review` and are invisible to both members. Release is admin-only, one-way and audited. Blocked pairs can't be proposed in either direction; a pair can only exist once. |
| Coins | `credit_purchase`, `spend_coin`, `admin_refund_purchase` | Append-only ledger; the balance is a sum, never a column. A store transaction id is credited once (partial unique index). A spend locks the member row, checks the balance and appends, so parallel taps can't overspend. A refund reverses one purchase once and is refused if those coins were already spent. |
| One-time unlock | `restore_entitlement` | Keyed by (member, product). Restoring any number of times grants once. |
| Onboarding | `save_onboarding` | Validation lives in the database, so a modified client can't skip it. Only approved members can onboard. |
| Scoring + dossier | `src/domain/scoring.ts` | Pure functions. Hard exclusions (blocked, already matched, orientation, both members' age ranges, not approved/onboarded), then a symmetric 0–100 score: values 35, lifestyle 20, pace 15, strategy 10, uncertainty 10, intent 10. The dossier gives members up to 3 alignment signals and 2 honest friction points. |

## Tests (`npm test`)

- **ledger** – same receipt posted 5× credits once; 5 concurrent posts credit once; receipt can't be replayed by another member; 5 parallel spends on a balance of 1 → exactly one succeeds; refund once; refund refused after spend; members can't refund, can't write the ledger, can't read others' balances.
- **rls** – pending matches and their profiles are invisible to members; release makes them visible and is audited; members can't release or update status; outsiders can't read or send messages; no sending as someone else; no messaging inside a pending match; blocked pairs and duplicate pairs refused.
- **scoring** – symmetric for every seeded pair, bounded 0–100, deterministic ranking, every exclusion reason, seeded scores match the scorer, dossier limits.
- **onboarding** – waitlist gating, approve → onboard → appears in ranking, validation messages.

## In the demo

- **Member (Alex / Priya / Dana):** portfolio with dossier cards, chat, wallet (buy a pack, post the same receipt again, tap "spend" 5 times at once), onboarding, and a **"Try to break it"** tab that runs raw SQL as that member – read a pending match, release it yourself, give yourself 100 coins, read other people's messages – and shows Postgres refusing.
- **Waitlisted (Nadia):** waitlist screen until the concierge approves her.
- **Concierge:** review queue with Release, candidate ranking with the score breakdown and Propose, waitlist approve/decline, ledger with Refund, audit log.

## What this demo does NOT do

Being explicit so nothing here is mistaken for a finished product:

- **No real StoreKit / App Store Server API.** `credit_purchase` takes a transaction id as if it had already been verified. In production a Supabase Edge Function verifies the signed transaction (JWS) with Apple, checks bundle id / product id / environment, then calls the same function with the verified id. Refunds would come from App Store Server Notifications V2 (`REFUND`).
- **No Supabase Auth UI.** The user switcher stands in for sign-in; the database side (`auth.uid()`, role `authenticated`) is the same as Supabase's.
- **No iOS app.** The UI is a web stand-in to exercise the backend. The schema and functions are what a Swift client would call through `supabase-swift`.
- **Concurrency is serialised in PGlite.** PGlite is a single connection, so the "parallel" tests prove the balance guard and idempotency rules, not lock contention. On Supabase the `select … for update` on the member row and the unique indexes are what make it safe under real concurrency.
- **No push notifications, photo storage, moderation queue, or account deletion flow.**
- **Scoring weights are a starting point**, chosen to be explainable to members, not tuned on real outcomes.

## Layout

```
supabase/migrations/0001_schema.sql   schema, functions, RLS, grants
supabase/seed.sql                     fictional members, matches, ledger
src/domain/scoring.ts                 exclusions, score, ranking, dossier
src/db/client.ts                      PGlite + "run as member" helper
src/db/repo.ts                        queries used by UI and tests
src/ui/                               React demo
tests/                                vitest suites
```

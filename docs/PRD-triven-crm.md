# Triven CRM — Product Requirements Document

**Audience Intelligence + Outreach + Revenue for Triven AI Builder**

| | |
|---|---|
| Status | Ready for build · v2.0 · 2026-09-28 |
| Replaces | `docs/audience-intelligence-prd.md` (draft). Extends `docs/audience-v2-prd.md` |
| Scope | The whole CRM: sources → intelligence → contact discovery → outreach → replies → revenue |
| Owner | Growth, Triven |

## Implementation status (2026-09-28, branch `feature/crm-v2`)

| Area | Status | Notes |
|---|---|---|
| M0 Reliability | ✅ Built | Heartbeat, System Health, capacity + idle reasons, address guard. **You**: create the 3 cron-job.org jobs (System Health shows how), then deploy |
| M1 Sources | ✅ Built | Connector registry, auto-queue, daily channel scans, fast lane, community export import |
| M2 Data quality | ✅ Built | Early-swarm / duplicate-text / reply-ring detection, exclusion list, per-channel flagged share |
| M3 Intelligence | ✅ Built | Evidence ledger, use case, fit, reach, freshness, opportunity, cited Why Triven (AI needs `ANTHROPIC_API_KEY`) · ◐ R3.8: Lead Finder keeps its own fit score (shared queues/analytics not unified) |
| M4 Contact discovery | ✅ Built | Discovery stages + funnel, email confidence with reasons, daily spend caps, warm-touch list |
| M5 Segments | ✅ Built | Builder, live counts + exclusion breakdown, daily campaign feed |
| M6 Campaigns | ✅ Built | 8 use-case campaigns + sequences, use-case routing, launch review, auto-add, A/B · ◐ R6.2: hook doesn't yet say *when* they commented |
| M7 Sending | ✅ Built | Recipient business hours, bounce auto-pause (inbox + campaign) |
| M8 Replies | ✅ Built | Rule + AI triage, suggested replies, unsubscribe suppression |
| M9 Revenue | ✅ Built | First-touch attribution, calendar webhook, pipeline board, source snapshots |
| M10 Analytics | ✅ Built | Sources page, yield score, quality-based auto-pause, recommendations, what-converts + suggestions · ◐ R10.3: budgets follow yield by *ordering*, not a fixed 60/30/10 split |
| M11 Notifications | ✅ Built | New alerts, daily digest, weekly insights |
| M12 Users & settings | ✅ Built | Roles enforced on every write, Team page, capability sheet, spend caps · ◌ R12.2 change history not built |
| M13 Compliance | ◐ Partial | Built: all guards above. Open: YouTube 30-day refresh for *relevant* people's raw comments (needs counsel's view, §C4) |

Needs from you before launch: postal address, the capability sheet reviewed, a verifier + Anthropic key, the scheduler, then a deploy (merge `feature/crm-v2`).

**Part A** audits what works today, with numbers from the production database and the worker logs.
**Part B** is the product specification. **Part C** is the build plan.

---

# PART A — Current state (audit, 2026-09-28)

## A1. Numbers

| Area | Measure | Value |
|---|---|---|
| **Sending** | Gmail inboxes connected | 6 of 6 |
| | Campaigns | 1 active ("dENTIST -us", 12 imported leads) · 5 AI Builder campaigns in **draft, 0 leads** |
| | First emails ever sent | **3** (last on Sep 25) |
| | Replies | 1 · interested 0 · meetings 0 · won 0 |
| | Leads waiting to be emailed | 9 · follow-ups pending 6 (1 overdue) |
| **Worker** | Runs per day (should be 288) | **~6** (GitHub delays scheduled jobs; 39 of 39 runs succeeded) |
| | Runs inside the 21:00–24:00 IST send window | **≈1 per weekday** |
| **Audience** | Sources | 156 YouTube channels, 1 Hacker News · 51 videos/threads collected, 209 found but never queued |
| | Comments collected | 6,587 (80 high, 636 medium, 5,800 low, 71 spam) · last collection Sep 24 |
| | People | 5,281 (4,809 YouTube, 472 HN) · 99 high relevance, 161 medium |
| | Researched | 265 · web-searched 62 · finders asked 48 · AI-reviewed **0** (no Anthropic key) |
| | Identity found | 56 with a website, 25 with LinkedIn, 85 with a country |
| | Emails found | 47 (27 website, 10 Hunter, 10 bio/video) · 14 verified · 8 free-mail |
| | **Ready to contact** | **14** (0.27% of people) · **0 pushed** to a campaign |
| **Lead Finder** | Businesses | 0 — built and tested, **not deployed** |
| **Setup** | Postal address (email footer) | **Missing** |
| | AI Builder link | **Missing** (emails fall back to "reply for access") |
| | Keys present | YouTube, Hunter, Serper, Gmail OAuth |
| | Keys missing | Email verifier, Google Places, Anthropic (AI), Brave/Apollo (optional) |
| **Code** | Uncommitted files | 33 (Lead Finder, DEV source, notifications, dashboard, docs) — not live |

## A2. What works

| Capability | Evidence |
|---|---|
| Gmail OAuth, sending, threading | 6 inboxes connected; emails sent and threaded |
| Reply detection | The 1 reply was caught, the lead moved to REPLIED, follow-ups cancelled (3 cancelled tasks) |
| Worker reliability when it runs | 39 of 39 runs succeeded |
| Comment collection, one person per author | 6,587 comments → 5,281 people, no duplicates |
| Rule classification | 1.9% of people high relevance, 94% low: the filter is strict, as intended |
| Research waterfall | Website crawl was the main email source (27 of 47); Hunter adds 10 |
| Verification gating | Only 14 verified emails reach READY; 2 invalid were blocked |
| Import | 9 imports, 12 leads, all with email |
| Lead Finder (local, not deployed) | Test on 4 real clinics: 4 of 4 reachable in 21 s, owner found, chain excluded, personalised emails rendered |

## A3. What doesn't work, and why

| # | Problem | Root cause | Impact |
|---|---|---|---|
| 1 | **Almost nothing gets sent** | GitHub runs "every 5 minutes" jobs ~6×/day; the sequencer sends ≤ 1 email per inbox per run, and only ~1 run lands in the 3-hour send window | 3 emails in 10 days instead of ~60/day capacity |
| 2 | Audience prospects never reach a campaign | AI Builder campaigns are drafts with no leads; the 14 READY were never pushed; no auto-feed | Audience engine produces zero outreach |
| 3 | Collection stopped on Sep 24 | 209 found videos/threads were never queued; nothing auto-queues new content | No new people for 4 days |
| 4 | Very low reachability (0.27%) | Most commenters are anonymous; no verifier (guesses can't be confirmed); no AI review; research reached only 265 of 5,281 | Tiny ready pool |
| 5 | Personalisation for AI Builder is shallow | No structured use case, no "why Triven", AI review off | Generic emails to a technical audience |
| 6 | Compliance gap | Postal address missing from the footer | Legal exposure (CAN-SPAM, CASL, Spam Act) |
| 7 | New features not live | 33 files uncommitted | Lead Finder, DEV, notifications, dashboard unavailable |
| 8 | Send window fits the US only | One global 21:00–24:00 IST weekday window | Worldwide AI Builder audience gets emails at night |

**Conclusion.** The data engine works, but three connections are broken: the scheduler, the handoff from
"ready" to "campaign", and the refilling of sources. Fixing those (Phase 0) is worth more than any new feature.
Phases 1–3 then raise quality and volume.

---

# PART B — Product specification

## B1. Vision

Triven CRM finds people who are **already showing interest in building with AI**, understands **what they
want to build and what's blocking them**, confirms **who they are and how to reach them**, and shows them
**how Triven AI Builder builds that specific thing** — then runs the conversation to a meeting and a sale,
and learns which sources produce customers.

It also serves a second, simpler motion: **local businesses** that need an AI receptionist (Lead Finder).
Both motions share one pipeline, one outreach engine and one set of analytics.

## B2. Goals and non-goals

**Goals**
1. **Reliability:** everything that should run every 5 minutes does, and sending capacity is used.
2. **Qualified Reachable Audience (QRA):** grow the number of people worth contacting, not the contact list.
3. **Relevance:** every contacted person has an evidence-backed use case, fit and reason to care.
4. **Automation:** from source to sent email without manual pushes, inside guardrails.
5. **Attribution:** every reply, meeting and deal traces back to its source channel and video.
6. **Learning:** budgets and scoring move towards what produces meetings.

**Non-goals**
- Contacting every commenter or collecting every possible address.
- Scraping any platform (YouTube pages, LinkedIn, Google Maps, logged-in communities).
- Automated comments, replies, DMs or connection requests on any platform.
- Coordinating, rewarding or tracking paid engagement of any kind.
- Emailing personal free-mail addresses of private individuals by default.

## B3. Success metrics

Baselines are taken in the 14 days after Phase 0. Targets are hypotheses to confirm.

| Metric | Definition | Target after 60 days |
|---|---|---|
| **Meetings / week** (north star) | Meetings booked from CRM-sourced leads | 3 × baseline |
| Worker uptime | Worker runs ÷ expected runs | ≥ 98% |
| Capacity used | First emails sent ÷ daily sending capacity | ≥ 80% |
| **QRA / week** | New people with Intent ≥ 60, Fit ≥ 60, Reachability ≥ 80 | 2 × baseline |
| Reachability rate | READY ÷ people qualified (high/medium) | from 5% to ≥ 15% |
| Positive reply rate | Interested + meeting replies ÷ first emails | ≥ 3% |
| Bounce rate | Bounces ÷ first emails | < 2% |
| Time to first touch | Comment published → first email (fresh sources) | median < 72 h |
| Source yield | QRA per 1,000 comments, per channel | top 20% of sources get ≥ 60% of quota |
| Cost per QRA | Verifier + finder + search + AI spend ÷ QRA | tracked, not rising |

## B4. Users

| User | Needs |
|---|---|
| **Founder / growth lead** | Which sources and use cases produce meetings; where to put budget |
| **Sales rep** | Who this is, what they're building, why Triven, the proof — before replying |
| **Campaign operator** | Build an audience, attach it to the right campaign, keep it fed, keep deliverability safe |
| **Admin** | Keys, inboxes, limits, users, compliance settings |

## B5. System overview

```
SOURCES (connectors)                YouTube · Hacker News · DEV · Lead Finder (Google Maps / OSM)
                                    · Community export (CSV/JSON, permitted data only) · Manual import
        │
        ▼
COLLECT → QUALITY FILTER            spam, bots, coordinated / incentivised engagement removed
        │
        ▼
PERSON (one per identity)           evidence ledger · intent · use case · fit · freshness
        │
        ▼
IDENTITY & CONTACT DISCOVERY        own profile → website → search → finders → verified guesses
        │                           → email candidates with confidence → one primary
        ▼
QUALIFIED REACHABLE AUDIENCE        Opportunity = Intent × Fit × Reachability × freshness
        │
        ▼
SEGMENTS → USE-CASE CAMPAIGNS       auto-feed, launch check, personalised by use case / persona / stage / blocker
        │
        ▼
SEQUENCER → INBOX → REPLY TRIAGE    reliable scheduler, recipient-timezone windows, AI reply classification
        │
        ▼
MEETING → DEAL → REVENUE            calendar sync, deal value, attribution back to source
        │
        ▼
ANALYTICS & LEARNING LOOP           source yield → quota and budget allocation; weight suggestions
```

---

## B6. Functional requirements

Priority: **P0** Phase 0 (fix) · **P1** Phase 1 · **P2** Phase 2 · **P3** Phase 3.
Each requirement has acceptance criteria (✓).

### M0. Platform reliability — P0

- **R0.1 Reliable scheduler.** Replace GitHub's schedule as the primary trigger with a scheduler that runs
  every 5 minutes on time: cron-job.org (free) or Upstash QStash calling `POST /api/worker` with the
  `X-Worker-Secret` header for `tick`, `audience` and `finder`. GitHub Actions stays as a backup.
  ✓ ≥ 98% of expected runs in 7 days (≥ 282/day).
- **R0.2 Worker heartbeat.** Each run records action, duration, result and errors in a `WorkerRun` table.
  ✓ A System Health page shows the last run per action, runs per hour and errors; a notification fires if
  no `tick` ran for 20 minutes.
- **R0.3 Capacity view.** Campaigns page shows today's capacity (inboxes × allowance), sent, remaining, and
  the reason when sending is idle (outside window, no queued leads, inbox capped, worker late).
  ✓ The reason matches reality in spot checks.
- **R0.4 Setup blockers.** Launch is blocked while the postal address is missing; the dashboard lists every
  missing key and setting with its impact. ✓ No campaign can go ACTIVE without a footer address.
- **R0.5 Deploy the built features.** Commit and deploy Lead Finder, DEV source, notifications, dashboard.
  ✓ Live on production.

### M1. Sources and connectors — P1 (refactor) / P2 (new)

- **R1.1 Connector interface.** Every source implements `discover(query)`, `collect(content, cursor)`,
  `profile(externalId)`, `urls`, `limits`. YouTube, Hacker News, DEV and Lead Finder are ported without
  behaviour change. ✓ A new source needs only `src/lib/connectors/<name>.ts` and a registration.
- **R1.2 Auto-queue.** New uploads from tracked channels are found daily and queued automatically; the best
  unqueued content (by fit score) is queued when the collection queue runs empty.
  ✓ The collection queue is never empty while unqueued content with fit ≥ 55 exists.
- **R1.3 Fast lane.** New uploads on top-yield channels are queued within 6 hours of publishing and their
  comments collected daily for 14 days, ahead of the backlog. ✓ Median comment → first email < 72 h.
- **R1.4 Community export connector.** Import a CSV/JSON export (member name, profile URL, posts, links)
  from a community Triven administers or has written permission to use. Posts become evidence like comments.
  ✓ Imported members appear as prospects with evidence and source attribution.
- **R1.5 Manual import** (existing) creates prospects or leads with evidence "Imported by <user>".

### M2. Data quality filter — P1

- **R2.1 Spam and bots** (existing rules) stay.
- **R2.2 Coordinated / incentivised engagement detection.** Flag comments and accounts that show:
  the same accounts commenting within minutes of publishing across many videos; reply chains between the
  same accounts; near-duplicate wording across accounts; new or empty channels with unusually high comment
  frequency; promotional templates. ✓ Flagged comments carry no weight in scoring; people with mostly
  flagged activity get `SUSPECTED_INAUTHENTIC` and are excluded from outreach (reviewable).
- **R2.3 Exclusion lists.** Import channel ids / domains to exclude permanently (competitors, own staff,
  known engagement groups). ✓ Excluded ids never become prospects.
- **R2.4 Source quality.** Each channel shows its share of flagged engagement; the yield loop (M9)
  down-weights inflated sources. ✓ Visible on Audience Sources.

### M3. Audience intelligence — P1

- **R3.1 Evidence ledger.** Evidence rows: `type`, `weight`, `text` (≤ 200 chars), `sourceUrl`,
  `sourceKind`, `observedAt`, `createdBy`. Types: `SELF_BUILDING`, `FOR_CLIENTS`, `OWNS_BUSINESS`,
  `ASKED_HOW_TO`, `NAMED_TOOL`, `NAMED_BLOCKER`, `REPEAT_ENGAGEMENT`, `OWN_AI_CONTENT`, `SITE_OFFERS_AI`,
  `JOB_TITLE`, `BUDGET_SIGNAL`, `NEGATIVE`. Existing `intentEvidence` strings are migrated.
  ✓ Every READY prospect has ≥ 2 evidence items with working links.
- **R3.2 Intent (0–100)** is computed from evidence; the reasons list evidence ids.
- **R3.3 Use case.** Fields `useCase` (taxonomy), `useCaseDetail` (≤ 140 chars), `forWhom`
  (SELF / CLIENTS / EMPLOYER / UNKNOWN), `vertical`, `buildStage` (EXPLORING / BUILDING / SHIPPED / SELLING),
  `blocker` (≤ 100 chars). Taxonomy: AI receptionist, voice agent, AI sales agent, lead qualification,
  customer support, appointment booking, internal knowledge, marketing automation, onboarding,
  operations automation, custom workflow, unknown. Rules give a first guess for everyone; the AI pass
  runs only on the shortlist (Intent ≥ 50) and must cite evidence ids; uncited fields stay empty.
  Human overrides are never replaced. ✓ ≥ 80% agreement with human labels on a 100-person sample.
- **R3.4 Fit (0–100)**, separate from intent:

| Signal | Weight |
|---|---|
| Use case in Triven's supported set | +30 |
| Builds for clients (agency / consultant / freelancer) | +20 |
| Blocker is something Triven removes (hosting, voice, integrations, speed to deploy, no-code) | +20 |
| Business context (owns a business, company site, job title) | +15 |
| Stage BUILDING or SELLING | +10 |
| Uses tools Triven replaces or complements (n8n, Make, Vapi, Retell, Voiceflow…) | +5 |
| Foundation-model / ML research, or in-house platform at a large company | −30 |
| Student, "just curious", no business context | −20 |
| Works at a competitor | excluded |

- **R3.5 Why Triven + outreach angle.** `whyTriven` (≤ 300 chars) and `outreachAngle` (≤ 200 chars),
  generated from use case and evidence, citing evidence ids, and limited to the **Triven capability sheet**
  (a settings page the team maintains). ✓ Automated check finds no claim outside the sheet; weekly review
  of 20 samples rates ≥ 85% accurate and useful.
- **R3.6 Freshness.** `lastEngagedAt`; multiplier 1.0 (≤ 14 days), 0.8 (≤ 60), 0.6 (≤ 180), 0.4 older.
- **R3.7 Opportunity** = Intent × Fit × Reachability ÷ 10,000 × freshness. Every work queue sorts by it.
- **R3.8 Lead Finder businesses** get use case `AI_RECEPTIONIST`, Fit from the existing fit score, and
  appear in the same queues and analytics.

### M4. Identity and contact discovery — P1

- **R4.1 Discovery stages.** `COLLECTED → QUALIFIED → RESEARCHED → IDENTITY_CONFIRMED → EMAIL_CANDIDATES →
  VERIFIED → PRIMARY_SELECTED → READY → CONTACTED`, plus `NOT_QUALIFIED`, `UNREACHABLE`,
  `SUSPECTED_INAUTHENTIC`, `DO_NOT_CONTACT`. ✓ Funnel on the overview; each stage opens its stuck list
  with the top reasons.
- **R4.2 Waterfall** (existing, kept): own profile and uploads → website and link page → web search
  (identity) → Hunter / Apollo → verified pattern guesses. Guesses are never used unless verified.
- **R4.3 Stage budgets.** AI review from Intent ≥ 50; web search and finders from Intent ≥ 60 and Fit ≥ 50;
  highest Opportunity first; daily spend cap per paid service. ✓ Caps are never exceeded.
- **R4.4 Email confidence (0–100)** with reasons:

| Component | Points |
|---|---|
| Published by them (own site, bio, own video "business inquiries") | 45 |
| Finder API | finder score × 0.4 |
| Web search / verified guess | 30 |
| Verification: VERIFIED +40 · MX only +10 · catch-all +0 · INVALID → total 0 | |
| Domain matches their confirmed company | +10 |
| Local part matches their name | +5 |
| Role inbox | −10 |
| Free-mail | −15 (0 if they published it and Intent ≥ 80) |

- **R4.5 One address per person.** Primary = highest-confidence sendable address; others are fallbacks only
  after a hard bounce. ✓ No one receives the same step at two addresses.
- **R4.6 Unreachable, high fit.** People with Opportunity-worthy scores but no sendable email, who have a
  public site / LinkedIn / X, go to a daily **manual warm-touch list** (cap 20). The system never acts on
  those platforms; it only records "touched" and "responded". (P3)

### M5. Segments (Audience Builder) — P2

- **R5.1 Filters:** source, channel or channel category, content, persona, use case, stage, vertical, intent,
  fit, opportunity, freshness, country/region, email requirements (business, verified, min confidence),
  discovery stage, has site/LinkedIn, tags.
- **R5.2** Live count with an **exclusion breakdown** ("1,120 excluded: no email") and links.
- **R5.3** Save; attach to a campaign with **auto-feed** (daily cap, within the campaign's new-leads-per-day).
  ✓ New matching QRA are added daily without manual pushes and never twice.
- **R5.4** Export to CSV.

### M6. Campaigns and personalisation — P1

- **R6.1 Use-case campaigns** (one click, as drafts, 4-step sequences): AI Receptionist, Voice Agent, AI
  Sales Agent, Lead Qualification, Customer Support, Agency Automation, Developer Builder, Business
  Automation — plus the existing niche campaigns for local businesses (dental, med spa, home services…).
- **R6.2 Routing.** Use case chooses the campaign; persona chooses a tone variant inside it; stage and
  blocker fill the opening lines (`{{useCaseLine}}`, `{{blockerLine}}`); the comment hook mentions timing
  only for engagement ≤ 21 days old. The five persona campaigns keep running until the use-case campaigns
  beat them on positive-reply rate.
- **R6.3 Email structure.** Grounded hook → their use case in their words → the angle → **offer a
  ready-made Triven template for that use case** → one easy question. ≤ 120 words, plain text, spintax,
  soft opt-out, footer address.
- **R6.4 Launch check.** A new or edited campaign shows 20 emails rendered from real prospects; the operator
  confirms before it can go ACTIVE. ✓ Enforced.
- **R6.5 Auto-push.** READY prospects and businesses above a configurable Opportunity threshold are added
  to their routed campaign automatically (on by default after launch check). ✓ The 14 current READY
  prospects are in campaigns within one worker run after Phase 0.
- **R6.6 A/B test** of step 1 per campaign; winner after ≥ 200 sends per variant. (P3)

### M7. Sending and deliverability — P0/P1

- **R7.1 Recipient-timezone windows.** Send inside 9:00–17:00 on weekdays in the recipient's timezone
  (from country / state); unknown timezone uses the campaign window. (P1)
  ✓ ≥ 90% of first emails land inside the recipient's business hours.
- **R7.2 Capacity.** Up to 2 emails per inbox per run with the random gap, warm-up and daily caps
  (existing); with a reliable 5-minute scheduler that is ample. (P0)
- **R7.3 Existing guardrails stay:** MX check before send, suppression by email and domain, one lead per
  email, bounce → invalid + suppression, reply → stop, spintax, plain text + simple HTML, warm-up
  5 → 10 → 20 → 30 per day.
- **R7.4 Health alerts:** bounce rate > 3% (7 days) pauses the campaign and notifies; an inbox with 2+
  bounces in a day pauses itself. (P1)

### M8. Inbox and reply handling — P1

- **R8.1 Reply triage (AI).** Classify each reply: Interested, Meeting request, Question, Not now, Not
  interested, Unsubscribe, Out of office, Wrong person / referral, Bounce. Set lead status, suppress on
  unsubscribe, reschedule on out-of-office return date, create a lead for a referral.
  ✓ ≥ 90% agreement with human labels on 100 replies; unsubscribes suppressed within one run.
- **R8.2 Suggested reply.** A draft answer using the prospect's evidence and the capability sheet; sent only
  by a human. ✓ Never sent automatically.
- **R8.3 Unified inbox** (existing): all inboxes, threads, reply in-thread, outcome buttons.

### M9. Pipeline, revenue and attribution — P2

- **R9.1 First-touch attribution** on each prospect: platform, channel, content, engagement, first seen;
  copied to the lead. (P1)
- **R9.2 Meetings** from a Cal.com / Calendly webhook, matched by email to the lead. ✓ Booked meetings
  appear without manual entry.
- **R9.3 Deals:** stage (meeting → proposal → won / lost), value, close date (existing fields surfaced
  as a pipeline board).
- **R9.4 Source snapshots** (nightly, our own aggregates, survive raw-data purges): per channel and video —
  comments, people, qualified, QRA, contacted, replied, positive, meetings, won, revenue.
  ✓ Reconciles with lead counts ± 1%.

### M10. Analytics and the yield loop — P2

- **R10.1 Audience Sources page.** Channels ranked by yield with the full funnel to revenue; drill-down to
  videos, persona / use case / country mix, flagged-engagement share, best campaigns.
- **R10.2 Yield score** = QRA per 1,000 comments, blended with meetings per 100 contacted after ≥ 50
  contacted.
- **R10.3 Allocation.** Daily YouTube quota and research budget split by yield: 60% top quintile, 30%
  middle, 10% exploration. Sources with 0 QRA after 5,000 comments are auto-paused (resumable).
  ✓ After 30 days, ≥ 60% of collected comments come from the top 20% of sources.
- **R10.4 Recommended next:** new uploads from top channels, similar channels, rising videos; "Collect all".
- **R10.5 Learning loop** (P3): weekly comparison of reply and meeting rates by evidence type, use case,
  persona, stage and source; weight changes suggested for approval, never auto-applied.

### M11. Notifications and command center — P0 (exists) / P1

- Existing: dashboard "next moves", 30-day funnel, grouped notifications with links, desktop alerts,
  global search, hourly health checks.
- **R11.1** Add alerts: worker late (M0), capacity unused for a full window, READY prospects not pushed for
  24 h, source queue empty. (P0)
- **R11.2** Daily digest in-app: yesterday's sent, replies, meetings, new QRA, top source. (P1)

### M12. Users and settings — P2

- **R12.1 Roles:** Admin (keys, inboxes, settings), Operator (campaigns, segments), Sales (inbox, leads).
  The `role` field exists; enforce it in the API. ✓ A Sales user cannot change settings or send bulk.
- **R12.2 Capability sheet**, weights, stage budgets and spend caps are editable settings with change history.

### M13. Compliance — all phases

| Rule | Implementation |
|---|---|
| Official APIs only; no scraping | Unchanged |
| YouTube: one API project, no key rotation | Unchanged; request a quota extension |
| YouTube: refresh or delete API data after 30 days | Raw comments/profile data > 30 days refreshed (active prospects) or deleted; derived data and aggregates kept; **counsel to confirm** retained ids |
| No automated platform engagement | No comments, replies, DMs, connection requests; no paid-engagement coordination |
| Business email first | Default business-only; free-mail only when self-published and Intent ≥ 80 |
| Strict regions (EU/UK/CA/AU/NZ) | Only self-published addresses |
| Footer address + opt-out | Required before launch (R0.4) |
| Suppression | Email and domain; unsubscribe replies auto-suppressed (R8.1) |
| AI output | Evidence citations, capability sheet, stored for audit |

Safeguards, not legal advice; confirm with counsel before scaling.

---

## B7. User experience

| Page | Status | Contents |
|---|---|---|
| Dashboard | Exists | Next moves, 30-day funnel, sending chart, today's numbers |
| **System Health** | New (P0) | Worker runs, capacity, idle reasons, missing setup |
| Lead Finder | Exists | Local businesses → emails |
| **Audience Sources** | New (P2) | Channel / video yield, funnel to revenue, recommendations |
| Discover | Changed (P1) | Auto-queue settings, fast lane, recommended next |
| Prospects | Changed (P1) | Use case, Fit, Opportunity, freshness, discovery stage, inauthentic flag |
| Prospect profile | Changed (P1) | Evidence ledger, use-case card, Why Triven, email candidates with confidence, source |
| **Segments** | New (P2) | Audience Builder with exclusion breakdown and campaign auto-feed |
| Campaigns | Changed (P0/P1) | Capacity and idle reason, use-case campaigns, launch check, A/B |
| Inbox | Changed (P1) | Reply category, suggested reply |
| **Pipeline** | New (P2) | Meetings → proposals → won/lost board with values and sources |
| Settings | Changed | Capability sheet, weights, budgets, spend caps, roles |

**Prospect profile (target):**

```
John Smith · Agency owner · ABC Automation · US                          Opportunity 78
Intent 91  Fit 86  Identity 72  Reach 96              Fresh: commented 3 days ago

USE CASE   AI receptionist · for clients · vertical: dental · stage: building
           Blocker: "voice latency and booking integration"          [3 evidence]
WHY TRIVEN Builds AI receptionists for dental clients and is stuck on voice latency and
           calendar booking, which Triven's builder handles.          [cites E2, E4, E5]
ANGLE      Offer the dental receptionist template with booking connected.

EVIDENCE   E1 +12 Commented on 4 AI-agent videos in 30 days        → comments
           E2 +18 "I build these for my dental clients"            → comment
           E3 +15 Website offers "AI voice agents"                 → /services
           E4 +10 "latency kills it on real calls"                 → comment
           E5  +8 Asked how to connect Cal.com                     → reply

EMAILS   ★ john@abc-automation.com   98  verified · business · published on /contact
           info@abc-automation.com   71  verified · role inbox
           john.smith@gmail.com      62  personal (not used)

SOURCE     AI Agents Channel A › "Build an AI Receptionist" · Sep 25, 2026
```

---

## B8. Data model (additive only — the production database is shared)

| Table | Change |
|---|---|
| **WorkerRun** (new) | `id`, `action`, `startedAt`, `durationMs`, `ok`, `summary Json`, `error` |
| **Prospect** | + `useCase`, `useCaseDetail`, `forWhom`, `vertical`, `buildStage`, `blocker`, `useCaseSource`, `fitScore`, `fitReasons[]`, `reachability`, `opportunityScore`, `whyTriven`, `outreachAngle`, `aiCitations Json`, `discoveryStage`, `inauthentic Boolean`, `lastEngagedAt`, `engagementCount`, `firstSourcePlatform`, `firstContainerId`, `firstContentId`, `firstEngagementId`, `firstSeenAt` |
| **ProspectEvidence** (new) | `id`, `prospectId`, `type`, `weight`, `text`, `sourceUrl`, `sourceKind`, `observedAt`, `createdBy` |
| **AudienceComment** | + `flaggedInauthentic Boolean`, `flagReason` |
| **ProspectEmail** | + `confidenceReasons[]` |
| **AudienceSegment** (new) | `id`, `name`, `filters Json`, `campaignId?`, `autoFeed`, `dailyCap`, `lastRunAt`, `lastCount` |
| **SourceSnapshot** (new) | `date`, `platform`, `containerId`, `contentId?`, `comments`, `people`, `qualified`, `qra`, `contacted`, `replied`, `positive`, `meetings`, `won`, `revenue` |
| **ExclusionEntry** (new) | `id`, `kind` (CHANNEL / DOMAIN / EMAIL), `value`, `reason` |
| **Campaign** | + `useCase`, `segmentId?`, `launchCheckedAt`, `autoPush Boolean` |
| **Lead** | + `useCase`, `replyCategory`, `firstContainerId`, `firstContentId` |
| **Setting** keys | `triven_capabilities`, `fit_weights`, `intent_weights`, `stage_budgets`, `spend_caps` |

Migrations: `prisma migrate diff` → review → `prisma db execute` (project rule for the shared database).

---

# PART C — Build plan

## C1. Phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 — Make it run (this week)** | R0.1–R0.5 reliable scheduler + heartbeat + capacity view + setup blockers + deploy; add postal address and AI Builder link; add a verifier key; queue the 209 unqueued sources; push the 14 READY after reviewing the AI Builder sequences and launching those campaigns; R11.1 alerts | ≥ 282 worker runs/day; capacity used ≥ 80% on send days; AI Builder campaigns ACTIVE; collection running daily |
| **1 — Intelligence (2 weeks)** | M2 quality filter, M3 evidence / use case / fit / Why Triven / freshness / opportunity, M4.1–4.5 stages and confidence, M6.1–6.5 use-case campaigns + auto-push + launch check, R7.1 recipient timezones, M8.1–8.2 reply triage, R9.1 attribution, R1.2–1.3 auto-queue + fast lane | 100% of READY have cited evidence and a use case; reachability ≥ 10%; baseline metrics recorded |
| **2 — Sources, segments, revenue (2–3 weeks)** | M1.1 connector refactor, M5 segments + auto-feed, M9.2–9.4 meetings / pipeline / snapshots, M10.1–10.4 Audience Sources + yield allocation, M12 roles | Quota allocated by yield; ≥ 1 segment auto-feeding; meetings synced from calendar |
| **3 — Scale and learn (ongoing)** | R1.4 community export connector, R4.6 warm-touch list, R6.6 A/B, R10.5 learning loop | Meetings / week at 3× baseline; weekly weight review in use |

## C2. Dependencies

| Needed | For | Owner |
|---|---|---|
| Postal address, AI Builder link | Legal footer; AI Builder CTA | Triven |
| Email verifier key (MillionVerifier / ZeroBounce) | Verified guesses, reachability | Triven |
| Anthropic API key | Use case, Why Triven, reply triage | Triven |
| Google Places key (optional) | Lead Finder on Google Maps | Triven |
| cron-job.org or QStash account | Reliable scheduler | Triven |
| Triven capability sheet | What emails may claim | Product |
| One ready-made template per use case (8) | "Show, don't tell" offer | Product |
| Cal.com / Calendly | Meeting sync | Sales |
| Counsel review | YouTube retention, free-mail rule per region | Legal |

## C3. Risks

| Risk | Mitigation |
|---|---|
| Scheduler outage stops everything | Primary external cron + GitHub backup + heartbeat alert |
| Low reachability of commenters | Yield loop favours identifiable audiences; verifier; warm-touch list |
| AI invents facts | Citations, capability sheet, automated check, weekly review |
| Inflated engagement pollutes scoring | Quality filter, exclusion lists, source quality share |
| YouTube quota | Yield allocation, fast lane only for top sources, quota extension request |
| Paid-service spend | Stage thresholds, spend caps, cost per QRA on the dashboard |
| Deliverability damage | Warm-up, caps, bounce auto-pause, verified addresses, recipient-hour sending |
| Personal-data exposure | Business-email default, strict regions, suppression, retention, counsel review |
| Over-fitting weights | Minimum sample sizes, human approval |

## C4. Open questions

1. **Capability sheet:** which use cases does Triven AI Builder support today (voice, telephony, calendars,
   CRM integrations, hosting)?
2. **Templates:** can product publish one template per use case, and what is the link format?
3. **Revenue source:** CRM deal value, Stripe, or another system?
4. **Meetings:** which calendar tool is used for demos?
5. **Legal:** YouTube retention of ids for attribution; free-mail rule by region.
6. **Budgets:** monthly spend limit per paid service.
7. **Users:** how many people will use the CRM, and in which roles?

---

## Appendix — Existing code map

| Area | Code | Phase work |
|---|---|---|
| Worker | `src/app/api/worker/route.ts`, `.github/workflows/followup-worker.yml` | External scheduler, `WorkerRun` heartbeat |
| Sequencer / sending | `lib/sequencer.ts`, `outreach.ts`, `followups.ts`, `send-window.ts`, `schedule.ts` | Capacity view, recipient timezones, bounce auto-pause |
| Replies / inbox | `lib/replies.ts`, `app/(dashboard)/inbox` | Reply triage, suggested replies |
| Audience collection | `lib/audience/pipeline.ts`, `youtube.ts`, `hn.ts`, `devto.ts` | Connectors, auto-queue, fast lane, first-touch |
| Classification | `lib/audience/classify.ts`, `ai.ts` | Evidence rows, use case, fit, quality filter |
| Research / emails | `lib/audience/enrich.ts`, `identity.ts`, `finders.ts`, `hunter.ts`, `verify.ts` | Stage budgets, confidence |
| Routing / campaigns | `lib/audience/actions.ts`, `sequences.ts`, `lib/sequence-library.ts` | Use-case campaigns, auto-push, launch check |
| Templates | `lib/template.ts`, `lib/signals.ts`, `lib/audience/vars.ts` | `{{useCaseLine}}`, `{{blockerLine}}`, persona tone |
| Local businesses | `lib/finder/*` | Connector registration, shared queues |
| Analytics / alerts | `lib/command.ts`, `lib/health.ts`, `lib/notify.ts`, `lib/audience/stats.ts` | Snapshots, Audience Sources, new alerts |

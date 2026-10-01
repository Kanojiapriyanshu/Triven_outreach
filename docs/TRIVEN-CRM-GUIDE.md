# Triven CRM — Complete Guide

Triven CRM finds people who are already showing interest in building with AI (and local
businesses that need an AI receptionist), works out what each one wants to build and why Triven
fits, finds and verifies the right email, writes a personal email from that evidence, sends it
from your Gmail inboxes on a safe schedule, sorts the replies, and tracks every deal back to the
source that produced it. This guide covers every feature.

> Stack: Next.js 15 · Prisma · Neon PostgreSQL · Gmail API · Vercel · background worker every
> 5 minutes (external scheduler, GitHub Actions as backup). Product spec: `docs/PRD-triven-crm.md`.

---

## Contents

1. [The workflow in one picture](#1-the-workflow-in-one-picture)
2. [Getting started](#2-getting-started)
3. [Navigation](#3-navigation)
4. [Dashboard](#4-dashboard)
5. [Audience: finding builders](#5-audience-finding-builders)
6. [Audience intelligence](#6-audience-intelligence)
7. [Segments](#7-segments)
8. [Sources and the yield loop](#8-sources-and-the-yield-loop)
9. [Lead Finder (local businesses)](#9-lead-finder-local-businesses)
10. [Campaigns and the sequencer](#10-campaigns-and-the-sequencer)
11. [Templates and personalisation](#11-templates-and-personalisation)
12. [Leads, sending by hand, import](#12-leads-sending-by-hand-import)
13. [Inbox and reply triage](#13-inbox-and-reply-triage)
14. [Pipeline and meetings](#14-pipeline-and-meetings)
15. [Analytics and what converts](#15-analytics-and-what-converts)
16. [Notifications, digest and search](#16-notifications-digest-and-search)
17. [Sender accounts](#17-sender-accounts)
18. [Settings](#18-settings)
19. [Team and roles](#19-team-and-roles)
20. [System health and the scheduler](#20-system-health-and-the-scheduler)
21. [Deliverability and compliance safeguards](#21-deliverability-and-compliance-safeguards)
22. [Background jobs](#22-background-jobs)
23. [API keys and environment variables](#23-api-keys-and-environment-variables)
24. [Status reference](#24-status-reference)
25. [What the system deliberately does not do](#25-what-the-system-deliberately-does-not-do)

---

## 1. The workflow in one picture

```
SOURCES            QUALITY           INTELLIGENCE              CONTACT                OUTREACH              REVENUE
YouTube            spam, bots,       evidence → use case →     own site, bio, web     segments → use-case   replies sorted →
Hacker News   ──►  coordinated  ──►  fit → why Triven →   ──►  search, finders,  ──►  campaigns → sequencer ──►  pipeline → meetings
DEV                / paid            opportunity score         verified guesses                             (calendar) → won
Community export   engagement                                  → one primary email                          ▲
Lead Finder        removed                                                                                   │
        ▲                                                                                                    │
        └──────────────── Sources: yield per channel steers what gets collected next ◄──────────────────────┘
```

What you do each day:

1. Open the **Dashboard** and work down **Your next moves** (replies first).
2. Reply in the **Inbox** (a suggested reply is often ready) and move deals on the **Pipeline**.
3. Keep campaigns fed: turn on **auto-add**, or attach a **Segment**, or add people by hand.
4. Once a week, look at **Sources** and **Analytics → What converts**.

Everything else — collecting, scoring, research, verification, sending, follow-ups, reply
detection, alerts — runs by itself.

---

## 2. Getting started

### Sign in
Sign in with your workspace account. The first admin account comes from `prisma/seed.ts`.
**Change the default password** on any deployed copy (Team page → Reset password).

### Setup checklist (System Health shows what's missing)

| Step | Where | Why |
|---|---|---|
| **Set up the scheduler** | System Health | Nothing sends on time without it (GitHub alone runs ~6×/day) |
| Connect at least one Gmail inbox | Sender accounts | Nothing can be sent without one |
| Postal address | Settings | Legally required; campaigns can't launch without it |
| Review the **Triven capability sheet** | Settings | Limits what emails and "Why Triven" may claim |
| Create the **use-case campaigns** | Campaigns → Use-case campaigns | Ready people are routed to the right one |
| Email verifier key | Vercel env | Confirms guessed addresses: more reachable people, fewer bounces |
| Anthropic API key | Vercel env | AI use-case detection, cited "Why Triven", reply sorting |
| YouTube, Serper, Hunter, Google Places keys | Vercel env | Sources and contact discovery |
| Calendar webhook (optional) | Cal.com / Calendly | Meetings appear on the pipeline automatically |

---

## 3. Navigation

| Section | Page | What it's for |
|---|---|---|
| Workspace | **Dashboard** | Next moves, 30-day funnel, sending activity, today's numbers |
| | **Inbox** | Every reply, sorted by category, with suggested answers |
| | **Today's work** | Follow-ups due and overdue |
| | **Analytics** | Funnel, activity, campaigns, inboxes, **what converts**, **A/B tests** |
| Prospecting | **Lead Finder** | Local businesses from Google Maps / OpenStreetMap → emails |
| | **Audience** | Overview: discovery pipeline, QRA, breakdowns, blockers |
| | **Discover** | Find videos, channels, HN threads, DEV articles; import a community |
| | **Prospects** | Every person, with opportunity, fit, use case, evidence |
| | **Segments** | Saved audiences that feed campaigns daily |
| | **Sources** | Yield and revenue per channel and video; what to collect next |
| Outreach | **Campaigns** | Sequences, schedules, capacity, launch review, auto-add |
| | **Leads** | Everyone in the CRM, bulk actions, export |
| | **Pipeline** | Replied → interested → meeting → proposal → won / lost |
| | **Templates** | Email steps per campaign, the sequence library, A/B variants |
| | **Import** | CSV / Excel leads |
| Configuration | **Sender accounts** | Gmail inboxes, warm-up, daily targets |
| | **Settings** | Sending window, footer, capability sheet, exclusions, spend limits, do-not-contact |
| | **Team** | People and roles |
| | **System health** | Worker uptime, scheduler setup, campaign capacity, setup, errors |

Sidebar badges: unread replies, businesses ready, prospects ready. **Ctrl/⌘ K** searches everything.

---

## 4. Dashboard

**Your next moves** — ranked by money impact, refreshed every minute:

| Priority | Examples |
|---|---|
| **Now** | Worker not running · replies to answer · interested leads to book · broken inbox |
| **Today** | Overdue follow-ups · draft campaign with leads waiting · campaign with under a day of leads |
| **Grow** | Businesses / prospects ready · high-fit people to reach by hand · good-fit businesses to call |
| **Setup** | Missing inbox, address, use-case campaigns, capability sheet, keys |

Plus the **30-day pipeline** (found → reachable → emailed → replied → interested → meetings → won)
and **emails sent per day** with reply rate.

---

## 5. Audience: finding builders

### Sources (Discover)

| Tab | Finds | Cost |
|---|---|---|
| Find videos | YouTube videos about AI agents, automation, voice AI… | YouTube quota (search = 100 units) |
| Channels | Creators to track; their new uploads are scanned daily | ~2 units per scan |
| Hacker News | Show HN / Ask HN / AI threads with real discussion | Free |
| DEV | dev.to articles by tag; authors count as prospects | Free |
| Community import | A CSV export from a community you run or may use | Free |
| Collection | What's being collected, progress, errors | — |

**Collection runs itself:** when the queue runs low, the best discovered content is queued;
tracked channels are scanned daily for new uploads; **fresh uploads from strong sources go in a fast
lane** and are re-read daily for 14 days so people are contacted while their comment is recent.

**Community import** needs you to confirm you run the community or have written permission.
Emails in the export are only kept when you also confirm members agreed to be contacted.

### Data quality

Before anything is scored, the system removes spam and flags **coordinated or paid engagement**:
the same accounts commenting within minutes of publishing on many videos, near-identical wording
from several accounts, and pairs of accounts replying to each other across videos. Flagged comments
carry no weight; people whose activity is mostly flagged are marked **suspected paid engagement** and
never contacted (you can clear the flag). **Exclusions** (Settings) keep competitors, your own team and
known groups out entirely.

---

## 6. Audience intelligence

Every relevant person gets:

| | Meaning |
|---|---|
| **Evidence** | Typed facts with a link to where they came from: "Builds for clients: 'I set these up for my dental clients'" → the comment |
| **Intent** (0–100) | How strongly they're trying to build or buy now |
| **Use case** | What they're building (AI receptionist, voice agent, sales agent, lead qualification, support, booking, internal knowledge, marketing, onboarding, operations, custom workflow), in a few words, **for whom** (themselves / clients / employer), **stage** (exploring / building / shipped / selling) and **blocker** |
| **Fit** (0–100) | How well Triven serves that use case, with reasons (supported use case, builds for clients, a blocker Triven removes, business context, stage; ML research and students lower it) |
| **Reach** (0–100) | Confidence of their best usable email |
| **Opportunity** | Intent × fit × reach × freshness — every list and queue sorts by it |
| **Why Triven** | One or two lines on why Triven fits this person, **citing the evidence** ([E2]) and limited to the capability sheet |
| **Angle** | What the first email should offer (which template, which blocker) |
| **Discovery stage** | Collected → qualified → researched → identity confirmed → email candidates → verified → ready → contacted (or unreachable / not qualified / suspected paid) |

Rules compute this for everyone for free. With an Anthropic key, the AI reviews people with intent ≥
50, fills the use case more precisely, and writes the cited "Why Triven" (uncited text is dropped).
**Correct** any use case on the person's profile — your version is never overwritten.

**Email confidence** is shown per address with reasons (published by them 45, finder score, verified
+40, domain matches their site +10, name match +5, role inbox −10, personal free-mail −15). One address
per person is used; others are kept as fallbacks.

**Warm touch:** high-fit people with no email anywhere can be marked *to do / touched / responded* for
a person to reach by hand (e.g. a LinkedIn note). The system never acts on other platforms.

The **Audience overview** shows the discovery pipeline by stage, the **Qualified Reachable Audience
(QRA)** — intent ≥ 60, fit ≥ 60, reach ≥ 80 — breakdowns (use case, persona, country, region, source)
and what's blocking outreach with one-click rule changes.

---

## 7. Segments

A segment is a saved audience: source, channels, persona, use case, stage, builds-for, minimum intent
and fit, activity within N days, country, email requirements. It shows **how many match, how many are
ready, and why the rest aren't** (no email found, identity not confirmed, …).

Attach a segment to a campaign and switch on **daily feed**: every day it adds up to N new ready people,
best opportunity first, never the same person twice. Create one on the Segments page, or filter the
Prospects list and click **Save as segment**.

---

## 8. Sources and the yield loop

**Audience → Sources** ranks every channel (and each video inside it) by **yield**: reachable people per
1,000 comments, plus meetings per 100 contacted once 50+ were contacted. For each source you see comments
→ people → qualified → QRA → contacted → replies → meetings → revenue. Replies, meetings and revenue are
credited to the source where the person was **first found**, so nothing is counted twice.

The loop: collection and the daily channel scans go to the highest-yield sources first; a source with
5,000+ comments and under 0.5% qualified builders pauses itself (resume anytime); **Collect next** lists
fresh uploads from strong channels and high-fit content not read yet. Channels with a high share of
coordinated comments are flagged.

---

## 9. Lead Finder (local businesses)

Finds local businesses that fit an AI receptionist and the best email for each.

1. Pick a niche (26: dentists, med spas, HVAC, law firms…) or type anything (Google only), one or more
   cities (presets for US metros, Texas, Florida, California, Canada, UK, Australia), country and source.
2. Source: **All sources** (default) runs every source that fits the search, one after another, and
   merges the same business found twice (matched on phone, website + city, or name + city; the record
   you already have gains whatever it was missing, and a newly learned website reopens its research).
   - **Google Places** (ratings, reviews, hours; capped under Google's free monthly allowance)
   - **Foursquare** (website, phone, often an email; 10,000 free searches a month)
   - **TomTom** (website and phone; 2,500 free searches a day)
   - **NPI Registry** (US government list of every dental, chiropractic, optometry, physical-therapy and
     dermatology practice, with phone and official contact; free, no key; no websites, so research finds
     the site by web search and only accepts one that clearly belongs to the practice)
   - **OpenStreetMap** (free, no key, automatic mirror fallback and retries)
   A source that is out of credits is skipped; the others carry on.
3. Off-niche results, closed businesses and **chains/franchises** are dropped automatically.
4. The email waterfall: the listing → their website (contact, about, team, privacy pages; hidden and
   structured addresses; ignores the web designer's) → web search → owner's name (site or LinkedIn search
   titles) → email finders, one after another (Hunter → Apollo → Prospeo → Tomba, only when nothing else
   works) → **verified** guesses (never used unverified). Listings with no website wait for the next
   day when the web-search budget is used up, instead of being marked "no email".
5. **Fit score** with reasons (call value, reviews, rating, closed weekends, early closing, owner known,
   competitor tools found…) and tiers Hot ≥ 80 / Warm ≥ 55 / Cold. No email → **Call list**.
6. **Add to campaign** routes each niche to its campaign (created in one click with its sequence).

Rules: which emails count as ready, minimum reviews/rating, Google monthly cap, skip chains, background
research, web search, email finders, guesses.

---

## 10. Campaigns and the sequencer

**Use-case campaigns** (Campaigns → Use-case campaigns) create eight AI Builder campaigns — AI
Receptionist, Voice Agent, AI Sales Agent, Lead Qualification, Customer Support, Agency Automation,
Developer Builder, Business Automation — as drafts, each with a 4-step sequence. Ready people are routed
by **what they're building**; the older persona campaigns remain the fallback.

**Each campaign card** shows queued, sent today / daily limit, contacted, follow-ups, reply and bounce
rate, and a live **status line with the real reason** it is or isn't sending (sending · outside hours ·
inboxes at their limit · no one queued · worker late · no address…).

**Launch review:** before a campaign goes live — and again whenever its templates change — you read 20
real emails it will send, rendered with each person's data (thin-data warnings included). Launch means
"these look right". Launching also requires the postal address.

**Options per campaign:** schedule (hours, days, gap between emails), inboxes to rotate, new leads per
day, follow-up days, **auto-add ready people**, **send in each recipient's business hours** (9:00–17:00
weekdays in their own timezone, from country / state — best for worldwide audiences), **A/B test the
first email**.

**How sending works (every 5 minutes):** each free inbox sends at most one email per run — scheduled
emails first, then due follow-ups, then the next queued lead (highest priority first). Follow-ups reply
in the same Gmail thread and stop on a reply, bounce, unsubscribe or status change.

**Automatic pauses:** an inbox with 2+ bounces in 24 hours pauses for a day; a campaign bouncing over 3%
(30+ sends in 7 days) pauses itself with the reason shown.

---

## 11. Templates and personalisation

Templates per campaign (first email + follow-ups 1–3), a **library** of ready sequences (dental, med spa,
home services, sales teams, general, AI Builder persona and use-case sequences) and **variant B** for A/B
tests.

| Syntax | Example | Meaning |
|---|---|---|
| Variable | `{{companyName}}` | The lead's value |
| Fallback | `{{firstName\|there}}` | Used when empty |
| Condition | `{{#if isAgency}}…{{else}}…{{/if}}` | Nestable |
| Spintax | `{Hi\|Hello}` | One option per lead, stable |

Key variables: `name`, `hook`, `commentHook` (where they commented and what about), `useCaseShort`,
`useCaseLabel`, `blockerLine` (their blocker, only when confirmed by the AI or you), `templateOffer`
(a ready-made template for their use case — linked when the capability sheet has a link),
`isAgency` / `isDeveloper` (tone), `closedDays`, `closingTime`, `demoPhone`, `builderUrl`, `senderAddress`.

Local-business emails open with their strongest researched fact (rating, closed weekends, early close,
emergency care, multiple locations…); AI Builder emails open with their own comment and blocker.

---

## 12. Leads, sending by hand, import

**Leads:** search and filters, select all matching, bulk status / email / delete / export. The lead
page shows contact, conversion fields, where they were found (comment, thread, listing), research,
the follow-up schedule (send now / skip / stop) and the activity timeline.

**Compose / bulk send:** template, per-lead preview with data warnings, inbox rotation, send now / next
window / exact time, pacing.

**Import:** official lead sheet (Excel with guide, CSV), auto column mapping, validation, niche and inbox,
optional launch straight away.

---

## 13. Inbox and reply triage

All conversations from all connected inboxes; reply in-thread from the owning inbox; outcome buttons.

**Every reply is sorted** — Interested, Wants a call, Question, Not now, Not interested, Unsubscribe,
Out of office, Referral — by rules, refined by the AI when a key is set. The lead's status follows;
**unsubscribes go on the suppression list at once** and stop everything; "wants a call" and
"interested" raise a notification. A **suggested reply** (using only the lead's context and the
capability sheet) appears above the reply box — it's never sent without you.

Bounces mark the lead invalid, stop follow-ups and suppress the address.

---

## 14. Pipeline and meetings

**Pipeline** shows everyone who replied in six columns — Replied, Interested, Meeting booked, Proposal
sent, Won, Lost — with deal values, the source and use case on each card, and one-click moves. Open and
won totals appear at the top; revenue also rolls up per source on **Sources**.

**Calendar sync:** point a Cal.com or Calendly webhook at `/api/webhooks/calendar` with the signing secret
`CALENDAR_WEBHOOK_SECRET`. A booking moves the matching lead to *Meeting booked* with the date, stops its
follow-ups and notifies you; a cancellation moves it back.

---

## 15. Analytics and what converts

Conversion funnel, daily activity, campaign and inbox performance, leads by industry, plus:

- **What converts** — reply and positive rates by use case, persona, stage, builds-for, source, evidence
  type and industry, with small samples labelled. **Suggestions** appear when a group with 20+ sends
  clearly beats or trails the average ("Evidence type 'for clients' converts 2.1× better — consider
  raising its weight"). Nothing changes automatically; a weekly notification points at new ones.
- **A/B tests** — variant A vs B reply and positive rates per campaign; a winner is called after 200 sends
  per variant.

---

## 16. Notifications, digest and search

The bell groups related alerts and links each to where you fix it: replies (with category), meetings,
ready people, searches finished, campaigns empty / low / idle / paused, bounces, inbox paused, Google or
Hunter limits, worker problems, weekly insights. Toasts for new ones; optional **desktop alerts**; the tab
title shows the unread count. Every morning a **digest** notification summarises yesterday (sent, replies,
meetings, newly ready, best source). **Ctrl/⌘ K** searches leads, businesses and prospects.

---

## 17. Sender accounts

Connect Gmail with Google sign-in (tokens stay on the server). Daily target, signature, timezone.
**Warm-up** 5 → 10 → 20 → 30 a day by week. Expired access shows **Reconnect**; bounce-paused inboxes
show when they resume.

---

## 18. Settings

| Setting | Purpose |
|---|---|
| Sending window | Hours / days / timezone, daily cap per inbox, gap between emails |
| Demo phone, AI Builder link, **postal address** | Template variables; the address is required to launch |
| Default follow-up schedule | Days after the first email |
| **Triven capabilities** | Which use cases Triven supports, one line each on what it does, blocker words it removes, template links. Everything generated is limited to this |
| **Exclusions** | Channels / names / domains / emails never collected or emailed |
| **Daily spend limits** | Caps per day for AI review, web search, email verifier, email finders, with today's usage |
| Do-not-contact list | Emails and domains never emailed |

Audience rules (Audience page) and Lead Finder rules (Lead Finder → Rules) hold the prospecting policies.

---

## 19. Team and roles

| Role | Can change |
|---|---|
| **Admin** | Everything: keys, inboxes, settings, capability sheet, exclusions, spend limits, users |
| **Operator** | Prospecting, audiences, segments, campaigns, templates, imports |
| **Sales** | Inbox, leads, pipeline, sending single emails |
| **Viewer** | Nothing (read-only) |

Enforced for every write. Admins add people, change roles, reset passwords and remove access on **Team**;
the last active admin can't be removed. A role change applies at the person's next sign-in.

---

## 20. System health and the scheduler

**System health** shows, per worker job (send & replies, audience, Lead Finder): uptime over 24 h against
the expected 288 runs, last run, failures and the runs-per-hour chart; every campaign's capacity and the
reason it's idle; the setup checklist; queues; recent errors; and **Run now** buttons.

**Scheduler (required):** GitHub's "every 5 minutes" actually runs a few times a day. Create three free
cron jobs at cron-job.org, every 5 minutes, POST to:

```
{APP_URL}/api/worker?action=tick
{APP_URL}/api/worker?action=audience
{APP_URL}/api/worker?action=finder
```

each with header `X-Worker-Secret: <WORKER_SECRET>` and a 60-second timeout. The page shows the exact URLs
and turns green within minutes. GitHub Actions stays on as a backup.

---

## 21. Deliverability and compliance safeguards

- Sent like Gmail itself, one at a time, random gaps, inbox rotation, warm-up, daily caps, spintax
- MX check before every send; verified / published-only rules; guesses never used unverified
- One address per person; suppression by email and domain; duplicates never emailed twice
- Soft opt-out in every sequence; unsubscribe replies suppressed automatically; reply / bounce stop
- Postal address required to launch; launch review of real emails
- Bounce auto-pause for inboxes (2+/day) and campaigns (> 3% over 7 days)
- Recipient business hours option; stricter rules for EU / UK / Canada / Australia / New Zealand
- Coordinated / paid engagement excluded; exclusion list; AI text limited to evidence and the capability sheet
- Official APIs only; robots.txt respected; honest crawler name `TrivenBot/1.0`
- Irrelevant audience data deleted after the retention period

---

## 22. Background jobs

| Call | Every | Does |
|---|---|---|
| `tick` | 5 min | Check replies and bounces (sort replies) → send → hourly health alerts and auto-pauses |
| `audience` | 5 min | Refill sources (auto-queue, daily channel scan, fast lane) → collect → AI review → research → identity → finders → verify → intelligence → auto-add to campaigns |
| `finder` | 5 min | Continue business searches → research websites for emails |
| daily (runs inside one `audience` call a day) | 1 day | Coordinated-engagement pass, source snapshots and yield, segment feeds, weekly insights, digest, housekeeping |

Every job works in small batches within ~50 seconds and continues next run. Every run is recorded for
System Health.

---

## 23. API keys and environment variables

Set in Vercel (Settings → Environment Variables, then redeploy) and in `.env`. See `.env.example`.

| Variable | Required | Used for |
|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Yes | Neon PostgreSQL |
| `SESSION_SECRET` | Yes | Sign-in sessions |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Yes | Gmail |
| `NEXT_PUBLIC_APP_URL` | Yes | Links, OAuth, scheduler URLs |
| `WORKER_SECRET` | Yes | Worker authentication |
| `YOUTUBE_API_KEY` | For YouTube | Audience discovery (10,000 units/day) |
| `ANTHROPIC_API_KEY`, `AUDIENCE_AI_MODEL` | Recommended | Use case, cited Why Triven, reply triage and suggestions |
| Any of `REOON_API_KEY`, `ZEROBOUNCE_API_KEY`, `MILLIONVERIFIER_API_KEY`, `NEVERBOUNCE_API_KEY` | Recommended | Mailbox verification. All that are set are used, in that order; when one runs out the next takes over |
| `SERPER_API_KEY` or `BRAVE_SEARCH_API_KEY` | Recommended | Identity search, emails published elsewhere, owner names |
| `HUNTER_API_KEY`, `APOLLO_API_KEY`, `PROSPEO_API_KEY`, `TOMBA_API_KEY` | Optional | Email finders, tried in that order. Tomba's value is `key:secret` (`ta_…:ts_…`) |
| `GOOGLE_PLACES_API_KEY` | Optional | Lead Finder on Google Maps (enable Places API (New)) |
| `FOURSQUARE_API_KEY`, `TOMTOM_API_KEY` | Optional | More Lead Finder sources |
| `CALENDAR_WEBHOOK_SECRET` | Optional | Cal.com / Calendly meeting sync |
| `EMAIL_VERIFIER`, `YOUTUBE_DAILY_QUOTA` | Optional | Verifier to use first / raised quota |

**Several keys per service.** Any key variable may hold several keys separated by commas
(`HUNTER_API_KEY=first,second`). Calls go to the least-used key; a key that runs out of credits, is rate
limited or is rejected is paused (until it resets, for a few minutes, or for a day) and the next key, then
the next service, takes over. **System Health → Data sources** shows every service, each key by its last
four characters, what it has used this month and why a key is paused. Free-plan limits are built in; on a
paid plan raise them with `<NAME>_MONTHLY_CAP` or `<NAME>_DAILY_CAP` (0 = no limit), e.g.
`TOMBA_MONTHLY_CAP=1000`. Check each provider's terms before using more than one account with it.

---

## 24. Status reference

**Lead** — New · Researching · Ready to contact · First email sent · Follow-up 1/2/3 due / sent · Replied ·
Interested · Demo sent · Meeting booked · Proposal sent · Won · Lost · Not interested · Unsubscribed ·
Invalid email · Do not contact

**Reply category** — Interested · Wants a call · Question · Not now · Not interested · Unsubscribe ·
Out of office · Referral · Other

**Prospect discovery stage** — Collected · Qualified · Researched · Identity confirmed · Email candidates ·
Verified · Ready · Contacted · Not qualified · Unreachable · Suspected paid engagement · Do not contact

**Business (Lead Finder)** — Queued · Researching · Ready to email · Email unconfirmed · No email (call) ·
In campaign · Excluded · Do not contact

**Email** — Verified · Unknown (domain accepts mail) · Risky (catch-all) · Invalid

**Campaign** — Draft · Sending · Paused (with reason)

---

## 25. What the system deliberately does not do

- **No scraping** of YouTube pages, LinkedIn, Google Maps or logged-in communities — official APIs, public
  pages that allow it, and exports you're permitted to use only.
- **No automated comments, replies, DMs or connection requests** on any platform, and no coordinating or
  rewarding engagement of any kind.
- **No unverified guessed addresses** are ever emailed; no email to people who unsubscribed.
- **No claims outside the capability sheet** in generated text; AI never sends anything by itself.
- **No automatic weight changes** from the learning loop — suggestions only.
- **No rotating YouTube keys** to exceed quota; no SMTP probing.
- Compliance rules are safeguards, not legal advice.

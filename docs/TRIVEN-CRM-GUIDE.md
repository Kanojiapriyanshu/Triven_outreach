# Triven CRM — Complete Guide

Triven CRM finds the right people to contact, finds a working email for each one, writes a personal
email from what it learned, sends it from your Gmail inboxes on a safe schedule, follows up, and stops
the moment someone replies. This guide covers every feature.

> Stack: Next.js 15 · Prisma · Neon PostgreSQL · Gmail API · deployed on Vercel · background worker
> run by GitHub Actions every 5 minutes.

---

## Contents

1. [The daily workflow in one picture](#1-the-daily-workflow-in-one-picture)
2. [Getting started](#2-getting-started)
3. [Navigation](#3-navigation)
4. [Dashboard](#4-dashboard)
5. [Lead Finder (local businesses)](#5-lead-finder-local-businesses)
6. [Audience (AI Builder prospects)](#6-audience-ai-builder-prospects)
7. [Campaigns and the sequencer](#7-campaigns-and-the-sequencer)
8. [Leads](#8-leads)
9. [Templates and personalisation](#9-templates-and-personalisation)
10. [Sending emails by hand](#10-sending-emails-by-hand)
11. [Import](#11-import)
12. [Inbox, replies and Today's work](#12-inbox-replies-and-todays-work)
13. [Analytics](#13-analytics)
14. [Notifications and search](#14-notifications-and-search)
15. [Sender accounts](#15-sender-accounts)
16. [Settings](#16-settings)
17. [Deliverability and compliance safeguards](#17-deliverability-and-compliance-safeguards)
18. [Background worker](#18-background-worker)
19. [API keys and environment variables](#19-api-keys-and-environment-variables)
20. [Status reference](#20-status-reference)
21. [What the system deliberately does not do](#21-what-the-system-deliberately-does-not-do)

---

## 1. The daily workflow in one picture

```
 FIND                      RESEARCH                    SEND                      CLOSE
 ────                      ────────                    ────                      ─────
 Lead Finder               website, web search,        campaign sequencer        Inbox: reply
 (Google Maps / OSM)  ──►  Hunter, verified guesses ─► first email + 3      ──►  mark interested,
 Audience                  → fit score + best email     threaded follow-ups       meeting, won
 (YouTube / HN / DEV)                                   stops on reply/bounce
```

What you do each day:

1. Open the **Dashboard** and work down **Your next moves** (replies first).
2. In **Lead Finder** or **Audience → Prospects**, open the **Ready** tab and click **Add to campaign**.
3. Launch or refill campaigns when the dashboard asks.
4. Answer replies in the **Inbox** and record the outcome.

Everything else (research, verification, sending, follow-ups, reply detection, alerts) runs by itself.

---

## 2. Getting started

### Sign in
Open the app and sign in with your workspace account. The first admin account is created by
`prisma/seed.ts` (see that file for the default email). **Change the default password** on any
deployed copy.

### Setup checklist

| Step | Where | Why |
|---|---|---|
| Connect at least one Gmail inbox | Sender accounts | Nothing can be sent without one |
| Add your postal address | Settings → AI Builder Link & Footer | Required in cold-email footers (CAN-SPAM, CASL, Spam Act) |
| Set the sending window | Settings → Sending Window | Emails go out at times your prospects are awake |
| Add `GOOGLE_PLACES_API_KEY` | Vercel env vars | Google Maps business search (OpenStreetMap works without it) |
| Add one email-verifier key | Vercel env vars | Confirms guessed addresses: more reachable leads, fewer bounces |
| Add `SERPER_API_KEY` (or Brave) | Vercel env vars | Finds emails published outside a business's own site |
| Add `YOUTUBE_API_KEY` | Vercel env vars | YouTube audience discovery |
| Create campaigns | Campaigns, or from Lead Finder / Audience | Each niche gets its own ready-made sequence |

The dashboard's **Unlock more leads** row shows which of these are still missing.

---

## 3. Navigation

| Section | Page | What it's for |
|---|---|---|
| Workspace | **Dashboard** | Next moves, 30-day funnel, sending activity, today's numbers |
| | **Inbox** | Every reply from every connected inbox; answer in-thread |
| | **Today's work** | Follow-ups due and overdue, replies to handle |
| | **Analytics** | Funnel, daily activity, campaign and inbox performance |
| Prospecting | **Lead Finder** | Local businesses from Google Maps / OpenStreetMap → emails |
| | **Audience** | Overview of the AI Builder prospect pipeline |
| | **Discover** | Find YouTube videos, Hacker News threads and DEV articles to mine |
| | **Prospects** | Every person found, scored and researched |
| Outreach | **Campaigns** | Sequences, schedules, inbox rotation, launch / pause |
| | **Leads** | Everyone in the CRM, filters, bulk actions, export |
| | **Templates** | Email steps per niche + a library of ready-made sequences |
| | **Import** | Bring leads in from CSV / Excel |
| Configuration | **Sender accounts** | Gmail inboxes, warm-up, daily targets, signatures |
| | **Settings** | Sending window, follow-up days, demo phone, footer, do-not-contact list |

Sidebar badges show unread replies, businesses ready to email and prospects ready to add.

---

## 4. Dashboard

**Your next moves** — a to-do list ranked by money impact, rebuilt every minute:

| Priority | Examples |
|---|---|
| **Now** | Reply to people who answered · book interested leads · reconnect a broken inbox |
| **Today** | Overdue follow-ups · launch a draft campaign that has leads waiting · refill a campaign with less than a day of leads |
| **Grow** | Businesses ready to email · audience prospects ready · good-fit businesses to call |
| **Setup** | Missing inbox, postal address, Google key, verifier key, web-search key |

Every item links straight to the page that fixes it.

**Pipeline, last 30 days** — Found → Reachable → Emailed → Replied → Interested → Meetings → Won, with
the conversion rate between each step.

**Emails sent per day (14 days)** — sent count, replies and reply rate; hover a day for details.

Below that: today's new leads, first emails and follow-ups due, replies, overdue items, conversion
counters, all-time totals and per-inbox sending performance.

---

## 5. Lead Finder (local businesses)

Finds local businesses that fit an AI receptionist (dentists, med spas, HVAC, law firms…), then finds
the best email for each one and writes down exactly where it looked.

### 5.1 Running a search

1. **What** — pick one of 26 niches, grouped as Health, Home services, Professional and Local
   (dentists, orthodontists, med spas, chiropractors, physical therapy, vets, dermatology,
   optometrists, plumbers, HVAC, electricians, roofers, pest control, cleaning, landscaping, garage
   doors, auto repair, injury and family law, real estate, property management, insurance,
   accounting, salons, gyms, restaurants) — or type anything (Google only).
2. **Where** — one city or area per line. One-click lists: *Top US metros, Texas, Florida,
   California, Canada, UK, Australia*.
3. **Country** and **source**: Google Maps (needs a key) or OpenStreetMap (free, no key).
4. **Up to 20 / 40 / 60 per city** (Google returns at most 60 per search, so big areas go city by city).
5. **Find businesses.** The first results appear within seconds; long searches continue in the background.

The form shows how many Google calls the search will use and how many are left this month.

### 5.2 Sources

| Source | What it gives | Cost |
|---|---|---|
| **Google Places API (New)** | Name, address, phone, website, rating, review count, opening hours, open/closed status | Free monthly allowance (≈1,000 searches × 20 businesses). The app stops at your cap (default 900) so nothing is billed |
| **OpenStreetMap** | Name, address, phone, website, sometimes email and hours | Free, no key. Uses public Overpass servers with automatic fallback to mirrors and retries |

### 5.3 What gets filtered out automatically
- Results that aren't really the niche (checked against Google place types and name keywords)
- Permanently or temporarily closed businesses
- **Chains and franchises** (Aspen Dental, Roto-Rooter, State Farm, Great Clips … and any website
  shared by 3+ listings) — a local manager can't buy
- Businesses below your minimum rating / review count (optional)
- Anything already found by an earlier search (duplicates are never added twice)

### 5.4 How the email is found (the waterfall)

Cheapest and most reliable first; every step is logged in **Where we looked**:

1. **The listing itself** — OpenStreetMap sometimes carries an email.
2. **Their website** — home, contact, about/team/doctor and privacy pages (plus `/contact` if not
   linked). Reads `mailto:` links, Cloudflare-hidden addresses, structured data (JSON-LD) and
   "name [at] domain" text. Ignores the web designer's address in the footer.
3. **Web search** — pages elsewhere that publish their address (directories, chambers, PDFs, their
   own pages the crawler didn't reach).
4. **Owner's name** — from the website ("Dr. Jane Neely", "Travis Royce, DDS", "Owner: …") or a
   LinkedIn *search result title*. Used for a personal greeting and personal-address guesses.
5. **Hunter** — only when nothing else worked, and only after a free check shows Hunter knows the
   domain. Keeps the credit reserve set in Audience rules.
6. **Verified guesses** — `firstname@`, `first.last@`, `drsurname@`, `info@`, `office@`, `frontdesk@`…
   Kept **only if a verifier confirms the mailbox exists**. Without a verifier key, guesses are never
   used (one Hunter check may be spent on the most likely inbox if Hunter has seen mail at the domain).

Every address is then checked: the domain must accept mail (MX), and with a verifier key the mailbox
itself is checked.

**No email anywhere?** The business goes to the **Call list** (phone + contact form) with a lower score.

The research also records:
- **Site facts** used to personalise the first line: accepting new patients, emergency appointments,
  24/7, "text us instead of calling", new-patient specials, evening/Saturday hours, financing,
  Spanish-speaking team, independently owned, "since 1994", number of locations
- **Tools on their site**: online booking (NexHealth, Zocdoc, Calendly…), patient messaging (Weave,
  Podium, Birdeye…), field-service software (ServiceTitan, Jobber…), live chat, and **competitors**
  (answering services / AI receptionists already in place)
- Contact form, Facebook, Instagram and LinkedIn links

### 5.5 Fit score and tiers

Each business gets a **fit score (0–100)** with readable reasons, for example:

```
+18 every missed call is expensive in this niche
+15 180 reviews: busy independent
 +8 4.9★, proud of their service
 +8 closed at weekends: calls go to voicemail
 +6 closes at 4pm
 +5 decision maker known (Dr. Brooks Hunsaker)
+10 reachable (front-desk inbox)
-15 already has an answering service / AI receptionist
-40 chain / franchise
```

Tiers: **Hot** (≥ 80 and reachable) · **Warm** (≥ 55) · **Cold** (below).

### 5.6 Working the list

- **Tabs**: Ready to email · All · Researching · Unconfirmed email · Call list · In campaign · Excluded
- Filter by niche or search, search by name / city / email, sort by fit, reviews, rating, newest or name
- Click a row for the full profile: every email with its source, status and a link to where it was
  found; make one primary, remove one, or add your own (it's checked); edit the owner; hours; site
  facts; tools; the full "where we looked" trail
- **Bulk actions**: Add to campaign · Research again · Not a fit (exclude) · Restore · Delete —
  on a selection or on every business matching the filters
- **Export CSV** of the current view (the Call list tab exports a phone list)
- **Run now** processes the whole backlog immediately instead of waiting for the worker

### 5.7 Add to campaign

- **Route by niche (recommended)** — dentists go to the dental campaign, plumbers to home services…
  A missing campaign can be created in one click with the niche's 4-step sequence (as a draft to review).
- **One campaign for all** — pick any campaign.

Only businesses with an email that passes your rules are added; the rest come back with a reason
(already a lead, on the suppression list, no campaign for the niche…). Each new lead carries the hours,
rating, site facts, owner and research notes, so the templates write a personal first line.

### 5.8 Rules (Lead Finder → Rules)

| Rule | Default | Effect |
|---|---|---|
| Which emails count as ready | Verified, or published by the business | "Mailbox-verified only" is safest but needs a verifier key |
| Min. reviews / min. rating | 0 / 0 | Drop small or badly rated businesses |
| Google calls per month | 900 | Hard stop below Google's free allowance |
| Skip chains and franchises | On | |
| Research in the background | On | The worker finishes searches and finds emails on its own |
| Use web search | On | 1–2 searches per business |
| Use Hunter | On | Only as a last resort, keeps the reserve |
| Try likely addresses | On | Only kept when a verifier confirms them |

The status chips at the top show which services are connected, Google calls used this month and
Hunter credits left.

---

## 6. Audience (AI Builder prospects)

Finds people who talk about building with AI (founders, agencies, freelancers, developers) and turns
the ones with real buying intent into leads for the **Triven AI Builder** campaigns.

### 6.1 Sources (Discover)

| Tab | What it finds | Cost |
|---|---|---|
| **Find videos** | YouTube videos about AI agents, automation, voice AI… filtered by region, length and date, scored for audience fit | YouTube Data API quota (a search = 100 of 10,000 daily units) |
| **Channels** | Creators whose audiences you mine; scan their latest uploads, track or stop tracking | 1 unit per call |
| **Hacker News** | Threads (Show HN, Ask HN, AI agents…) with enough discussion | Free |
| **DEV** | dev.to articles by tag (#aiagents, #n8n, #automation, #llm…); authors count as prospects too | Free |
| **Collection** | Queue of videos / threads / articles being collected, with progress and errors | — |
| **Add by link** | Paste a video, channel or thread URL | — |

### 6.2 The pipeline (runs every 5 minutes, or **Run pipeline now**)

1. **Collect** — comments, each stored once; one prospect per person however many comments they left.
2. **Classify** — rule-based relevance (High / Medium / Low / Spam), persona (Founder, Agency,
   Consultant, Developer, Business owner, Freelancer, Tech pro, Enthusiast), interest (AI receptionist,
   AI sales, AI development, AI automation, general AI) and the topic they talked about.
3. **AI review** (optional, with `ANTHROPIC_API_KEY`) — refines the shortlist and writes a one-line
   personal opener.
4. **Research** — their own profile, their own videos' descriptions ("business inquiries: …"), their
   website and link-in-bio page (robots.txt respected).
5. **Identity search** — finds their website / LinkedIn through a web-search API, accepted only when
   it clearly matches their name or handle.
6. **Email finders** — Hunter / Apollo once identity is known (credit-aware).
7. **Verify** — MX, then a verifier; with no verifier, Hunter credits are spent only on the addresses
   that would make someone ready.
8. **Ready** — when intent, identity, email and country rules all pass.

### 6.3 Scores
- **Intent (0–100)** — evidence they build or buy (runs an agency, commented on several videos, own
  channel is about AI, has a business site…), shown as a list of evidence.
- **Identity (0–100)** — how sure we are who they are.
- **Country** — inferred from channel country, domain, LinkedIn, location text, phone format,
  currency… with a confidence level.

### 6.4 Overview page
Totals, sources, YouTube quota left today, backlog per step, breakdowns by interest / persona /
country / region / source, and **what's blocking outreach** (not researched, low intent, identity
not confirmed, no email, personal address only, unverified) with one-click rule changes that show how
many more people would become ready.

### 6.5 Prospects page
One row per person, ranked by intent, with filters (status, relevance, persona, interest, country,
region, source, channel, search). Open a row for their comments with links, evidence, all emails with
sources, research notes and a **preview of the exact first email**. Bulk: add to campaign (routed by
persona to the five **AI Builder —** campaigns), research, verify, set relevance, do not contact,
forget. CSV export.

### 6.6 Audience rules
Send policy (verified only / also published), strict regions (EU/UK/CA/AU/NZ: only self-published
addresses), target countries, lowest relevance to research and to email, minimum identity score,
business emails only, web search on/off, email finders on/off, Hunter credit reserve, smart
verification, comments per video, auto-run, AI review on/off, and retention (irrelevant data is
deleted after N days).

---

## 7. Campaigns and the sequencer

A **campaign** is a niche with its own sequence, schedule and inboxes.

**Creating** — name, niche/industry, product, target country/location, timezone, follow-up days
(e.g. 3 / 7 / 14 after the first email), new leads per day, sending hours (may cross midnight), send
days, gap between emails, and the inboxes to rotate.

**States** — Draft → **Launch** (checks it has a first-email template and a connected inbox) →
Sending ⇄ Paused. Pausing also pauses its follow-ups.

**Live stats** — queued, no email, contacted, sent today, replied, bounced, follow-ups pending, reply
and bounce rate, and an estimate of when the queue runs out.

**How sending works (Instantly-style sequencer, every 5 minutes)** — each "free" inbox sends at most
one email per run. An inbox is free when its random gap since its last email has passed (default 8–15
minutes) and it still has daily / warm-up allowance. Least-recently-used inbox goes first. Order:
1. emails scheduled for an exact time
2. follow-ups that are due, inside the campaign's window
3. the next queued lead of an active campaign (highest priority and score first)

Follow-ups are sent **as replies in the same Gmail thread**, skip non-send days, and **stop
automatically** on a reply, a bounce, an unsubscribe or a status change.

AI Builder campaigns can be created in one click from Audience; niche campaigns from the Lead Finder.

---

## 8. Leads

**List** — search, filter by status, campaign and inbox, pagination, select a page or **all leads
matching the filters**; bulk change status, bulk email, delete, export CSV.

**Lead page**
- Contact, assignment (owner, inbox, campaign), priority and score
- Conversion: replied, interested, demo sent, meeting booked (date), proposal, won (date, deal value), lost reason
- **Found on** — where the lead came from (the video/comment, the HN thread, the DEV post, or the Google
  Maps listing with its research)
- Research: why this lead, pain point, personalisation notes, website and social notes
- **Outreach sequence** — the real schedule of follow-ups with *send now / skip / stop*
- Key dates and the full **activity timeline** (emails, replies, status changes, notes)
- Email, add note, change status

**Lead sources** — Manual, Import, Referral, Website, LinkedIn, Cold outreach, YouTube (audience),
Google Maps / OpenStreetMap (Lead Finder), Other.

---

## 9. Templates and personalisation

**Per niche** — each campaign can have its own templates (first email + follow-ups 1–3); leads in a
campaign without templates use the General ones. One default per step.

**Library** — ready-made 4-step sequences you can load in one click: Dental, Med spa, Home services,
Sales teams, General, and five AI Builder sequences (Founders, Agencies, Developers, Business owners,
Enthusiasts). Plain text, no links before the last step, one easy question per email, soft opt-out.

**Template language**

| Syntax | Example | Meaning |
|---|---|---|
| Variable | `{{companyName}}` | Lead's value |
| Fallback | `{{firstName\|there}}` | Used when the value is empty |
| Condition | `{{#if doctorName}}…{{else}}…{{/if}}` | Nestable |
| Spintax | `{Hi\|Hello}` | One option per lead (stable), so no two emails are identical |

**Variables** — name (smart greeting: "Dr. Neely" or "Harrison Dental team"), hook (personal opener),
gapLine, forwardLine, firstName, lastName, companyName, jobTitle, city, industry, personalNote,
senderName, senderFirstName, demoPhone, closingTime, closedDays, closedWhen, testMoment,
commentHook, commentTopic, sourceVideo, sourceChannel, useCase, useCaseShort, builderUrl, senderAddress.

**Research-driven personalisation** — the system reads each lead's notes (hours, ratings, awards,
"accepting new patients", "since 1994"…) and builds the opening line from the strongest fact: closed
weekends, a 4-day week, an early close, a new practice, promotions, multiple locations, emergency care…
With thin data the email still reads naturally ("your practice", "Hi Harrison Dental team", never
"Hi gmail.com team"). A first name or "Dr. Patel" is read from unambiguous addresses (john.smith@,
drpatel@).

---

## 10. Sending emails by hand

- **Compose** (from a lead or *New email* to a new contact — the lead is created on send): pick a
  template, preview with the lead's own data, choose the inbox (the one with most room left is
  suggested), set a follow-up plan, send now or **schedule** (next window or exact time).
- **Bulk send** (selected leads): template or each lead's niche default, inbox rotation, start now /
  next window / date-time, sending hours, days and gap, a live timeline of first/last email, and a
  **per-lead preview** with data-quality warnings ("well personalised" / "thin data").

---

## 11. Import

1. Download the **official lead sheet** (Excel with a guide tab, or CSV) or the demo sheet.
2. Upload CSV or XLSX.
3. **Map columns** — auto-matched (Practice, City/State, Hours, Reviews… recognised); adjust if needed.
4. **Validate** — valid, duplicate and error rows with reasons; missing email is a warning.
5. Choose niche/campaign and inbox, import, and optionally **launch the campaign straight away**.

Import history keeps every file with its counts.

---

## 12. Inbox, replies and Today's work

**Inbox** — all conversations from one or all connected Gmail accounts, with unread counts; filters
(replies, unread, sent, all); full threads; **reply in-thread from the inbox that owns it**; outcome
buttons (interested, meeting booked, not interested…). Replies sent from Gmail itself are mirrored too.

**Reply and bounce detection** — reads the Gmail threads the emails live in, so a reply from a
different address is still caught. Out-of-office and auto-replies don't count. A reply stops the
sequence and raises a notification; a bounce marks the lead invalid, stops follow-ups and adds the
address to the do-not-contact list. The thread is re-checked right before every follow-up.

**Today's work** — follow-ups due today and overdue, replies to handle, with send / skip actions.

---

## 13. Analytics

Conversion funnel, daily email activity, campaign performance, sender-account performance, and leads
by industry.

---

## 14. Notifications and search

**Notification bell** — replies, *N businesses ready to email*, *N audience prospects ready*, search
finished, campaign empty or running low, bounce rate over 3%, Google cap at 80% / reached, Hunter
credits low, Gmail inbox disconnected. Related alerts are grouped (the count goes up instead of
stacking), each links to where you fix it, and you can mark one or all read, filter unread, or clear
read ones. New alerts also pop up as a toast; **desktop alerts** (optional) appear even when the tab is
in the background. The browser tab title shows the unread count.

**Global search (Ctrl/⌘ K)** — leads, Lead Finder businesses and audience prospects in one box.

---

## 15. Sender accounts

- Connect Gmail with Google sign-in (OAuth; tokens stay on the server). The Google profile name is used
  as the sender name.
- Daily email target, signature (plain text), timezone, active on/off.
- **Automatic warm-up** — new inboxes send 5 → 10 → 20 → 30 a day by week, then the target.
- Expired access is flagged with a **Reconnect** button; tasks wait instead of being skipped.

---

## 16. Settings

| Setting | Purpose |
|---|---|
| **Sending window** | Hours and days emails may go out (default 21:00–24:00 IST = US late morning / UK afternoon), timezone, daily cap per inbox, random gap between emails |
| **Demo phone number** | `{{demoPhone}}` — prospects call it to test the AI receptionist |
| **AI Builder link & footer** | `{{builderUrl}}` and your postal address `{{senderAddress}}` |
| **Default follow-up schedule** | Days after the first email for follow-ups 1–3 |
| **Do-not-contact list** | Emails and whole domains that are never emailed (unsubscribes, bounces, requests) |

---

## 17. Deliverability and compliance safeguards

- Emails are sent like Gmail itself (plain text + simple HTML), one at a time, with random gaps,
  inbox rotation, warm-up and daily caps
- Spintax: no two emails are identical
- MX check before every send: dead domains are marked invalid, never bounced
- Verified-only or published-only rules for new addresses; guessed addresses need a verifier
- Suppression list checked for every lead (email and domain); duplicates are never emailed twice
- Soft opt-out line in every sequence; replies and bounces stop sequences instantly
- Postal address in the footer
- Stricter rules for EU / UK / Canada / Australia / New Zealand in Audience (only addresses the person
  published themselves)
- Public data only, through official APIs; robots.txt respected; the crawler identifies itself
  honestly as `TrivenBot/1.0`
- Irrelevant audience data is deleted after the retention period

---

## 18. Background worker

GitHub Actions (`.github/workflows/followup-worker.yml`) calls `POST /api/worker` every 5 minutes with
the `X-Worker-Secret` header. Three calls per run:

| Action | Does |
|---|---|
| `tick` | Check replies and bounces → sequencer sends due emails → hourly health checks (alerts) |
| `audience` | Audience pipeline (collect → review → research → identity → finders → verify) |
| `finder` | Lead Finder (continue searches → research new businesses) |

Every step works in small batches against a ~50-second deadline and continues on the next run.
The **Run now** buttons on Lead Finder and Audience do the same on demand.

Repository secrets needed: `APP_URL`, `WORKER_SECRET`.

---

## 19. API keys and environment variables

Set in Vercel (Settings → Environment Variables, then redeploy) and in the local `.env`.
See `.env.example` for comments.

| Variable | Required | Used for | Free tier |
|---|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Yes | Neon PostgreSQL | — |
| `SESSION_SECRET` | Yes | Login sessions | — |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Yes | Gmail sending and reading | — |
| `NEXT_PUBLIC_APP_URL` | Yes | Links and OAuth | — |
| `WORKER_SECRET` | Yes | Background worker auth | — |
| `GOOGLE_PLACES_API_KEY` | Recommended | Lead Finder on Google Maps (enable **Places API (New)**, restrict the key to it) | ≈1,000 searches / month |
| `YOUTUBE_API_KEY` | For Audience | YouTube discovery | 10,000 units / day |
| `SERPER_API_KEY` or `BRAVE_SEARCH_API_KEY` | Recommended | Emails published elsewhere, identity and owner lookups | Serper: 2,500 searches |
| `HUNTER_API_KEY` | Optional | Email finder (last resort) | ~25–50 credits / month |
| `APOLLO_API_KEY` | Optional | Email finder for audience prospects | — |
| One of `MILLIONVERIFIER_API_KEY`, `ZEROBOUNCE_API_KEY`, `NEVERBOUNCE_API_KEY`, `REOON_API_KEY` | Recommended | Mailbox verification; unlocks verified guesses | Trial credits |
| `EMAIL_VERIFIER` | Optional | Choose one when several are set (incl. `HUNTER`) | — |
| `ANTHROPIC_API_KEY`, `AUDIENCE_AI_MODEL` | Optional | AI review of shortlisted prospects + opener | — |

---

## 20. Status reference

**Lead** — New · Researching · Ready to contact · First email sent · Follow-up 1/2/3 due / sent ·
Replied · Interested · Demo sent · Meeting booked · Proposal sent · Won · Lost · Not interested ·
Unsubscribed · Invalid email · Do not contact

**Lead Finder business** — Queued · Researching · Ready to email · Email unconfirmed · No email (call) ·
In campaign · Excluded · Do not contact

**Audience prospect** — New · Researching · Profile found · Email found · Email verified · Ready to
contact · No contact · In campaign · Invalid email · Do not contact

**Email** — Verified (mailbox confirmed) · Unknown (domain accepts mail, mailbox not checked) ·
Risky (catch-all) · Invalid

**Campaign** — Draft · Sending (active) · Paused

**Search** — Queued · Running · Done · Error · Cancelled

---

## 21. What the system deliberately does not do

- **No LinkedIn scraping** — LinkedIn's terms forbid it and accounts get banned. Owner names come from
  public search-result titles only.
- **No Google Maps scraping** — Google's official Places API is used instead, capped under the free
  allowance. Note: Google's terms limit how long Places content (other than the place ID) may be stored.
- **No Reddit, Product Hunt or GitHub emails** — their terms forbid commercial or unsolicited-email use.
- **No SMTP probing** — outbound port 25 is blocked on Vercel; mailbox checks go through a verifier.
- **No rotating multiple YouTube keys** to exceed quota — one key, request a quota increase instead.
- **No guessed address is ever emailed unless a verifier confirms it.**
- Compliance rules in the app are safeguards, not legal advice.

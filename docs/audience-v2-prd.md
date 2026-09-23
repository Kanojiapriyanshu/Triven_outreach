# Audience v2: from "people who commented" to "people who want to build"

Research PRD, 2026-09-23. Extends the v1 YouTube audience system (`src/lib/audience/`).

## 1. Problem

v1 works mechanically but produces the wrong people:

1. **Wrong people.** A comment like "how do I build this?" puts a hobbyist, a student and a founder in the same bucket.
   Rules alone can't tell who can buy.
2. **Wrong emails.** Most addresses found were personal free-mail (`@gmail.com`) of anonymous commenters.
   These convert badly, bounce more, and are the riskiest to email legally.
3. **Too few emails for the right people.** A founder who comments with a plain display name and no links
   has no email anywhere in their YouTube footprint, so v1 finds nothing.

Goal: fewer, better prospects. **A prospect is ready only when we have evidence of buying intent, a confirmed
identity (who they are, where they work), and a business email that belongs to that identity.**

## 2. Research findings

### 2.1 What YouTube gives us (official Data API v3 only)

| Endpoint | Cost | What it reveals about a commenter |
|---|---|---|
| `commentThreads.list` | 1 / 100 comments | text, likes, reply count, author channel id, display name |
| `channels.list` (50 ids per call) | 1 | bio/description, country, handle, subscribers, video count, uploads playlist |
| `playlistItems.list` (their uploads) | 1 | their own latest videos |
| `videos.list` (50 ids per call) | 1 | **their own video descriptions**: creators put "business inquiries: …", websites, Calendly, agency links here |

The "About → View email address" button sits behind a CAPTCHA and the About-page links are not in the API.
Both are off limits: **policy III.E.6 forbids scraping YouTube**, and bypassing CAPTCHAs is not allowed.

**Quota.** 10,000 units/day by default. **Policy III.D.1.c:** one API project per app, so rotating many keys to
exceed quota is a violation that risks every key and project. The legitimate path is the YouTube API quota
extension form (audit), which regularly grants 100k to 1M+ units/day. v2 spends quota where it pays:
- **Collection:** about 100 comments/unit.
- **Deep read:** about 2–3 units per shortlisted person, not per commenter.
- **Search:** 100 units, used sparingly. Channel scans cost 1–2 units.

**Retention.** Policy III.E.4.c: refresh or delete API data after 30 days (v1 already purges irrelevant data).

### 2.2 Where business emails actually come from

Ranked by quality for this audience (AI builders, agency owners, founders):

| Source | Legit? | Quality | Coverage | Notes |
|---|---|---|---|---|
| Their own video descriptions / channel bio | Yes (API, published by them for contact) | Very high | Creators only (~5–15% of shortlisted commenters have uploads) | "business inquiries" addresses are explicitly offered for contact |
| Their own website (contact/about pages) | Yes (public, robots.txt) | Very high | Needs the website first | v1 already crawls; v2 finds the site for many more people |
| Web search to resolve identity (name + handle → site / LinkedIn URL) | Yes (search API, not scraping Google) | Enables everything below | High for real names, low for anonymous handles | Brave Search API or Serper |
| Email-finder APIs (Hunter, Apollo, …) given name + company domain or LinkedIn URL | Yes (licensed B2B data via API) | High, with confidence scores | 40–70% once identity is known | This is the "lead websites" route, done through their APIs instead of scraping their sites |
| GitHub profile email | **No** | – | – | GitHub AUP §7 forbids using GitHub data for unsolicited email; v2 stops using it |
| Scraping lead sites (Apollo UI, LinkedIn, ZoomInfo) | **No** | – | – | Against their terms and fragile; use their APIs |
| Guessed patterns (first@domain) | Only with a verifier | Medium | High | Only kept when a verifier confirms the mailbox |

### 2.3 What "real interest" looks like in data

Strong buying signals, from observing AI-automation comment sections:
- Talks about **their** business, clients, team or product ("my agency", "our clinic", "I sell this to clients").
- Describes something they are **already building** ("I'm building…", "my n8n workflow keeps failing…").
- Asks **implementation / production** questions (deploying, pricing, integrating with a CRM, scaling), not "what is AI".
- **Comes back**: comments on several videos, or across several channels, over time.
- **Their own channel is about AI/automation** (a builder who publishes), or their bio says founder/agency/consultant.
- Mentions **money** (charging clients, cost, ROI).

Weak or negative: praise-only, jokes, job-loss fear, news reactions, giveaway/crypto, non-English, one-word questions.

## 3. Solution

### 3.1 Pipeline

```
collect comments (API)
  → classify (rules, optional AI)      intent evidence per comment
  → roll up per person                 INTENT score + evidence list
  → shortlist: intent ≥ threshold
  → deep read (API: channel, uploads, video descriptions)   own-channel topic, published emails, links
  → identity (web search API, only if no website yet)       website / LinkedIn / company, IDENTITY score
  → own-site crawl (existing)
  → email finder waterfall (Hunter → Apollo, only with identity)   business email + confidence
  → verify (ZeroBounce / NeverBounce / MillionVerifier / Reoon / Hunter)
  → READY = intent + identity + verified business email + country rules
```

Each step only runs for people who passed the previous one, so API credits go to people worth contacting.

### 3.2 Intent score (0–100), with evidence

Points:
- Best comment's substance (existing classifier): up to 45
- Business / agency / founder / building-now signal in any comment: +15
- Implementation or money signal: +8
- Repeat engagement: +6 per extra comment (max 12), +8 if across 2+ channels
- Their own channel publishes AI/automation content: +15
- Bio says founder / agency / consultant / developer: +10

The score is stored with a human-readable **evidence list** (e.g. "Runs an agency", "Commented on 3 videos",
"Own channel: 14 videos about n8n"), shown in the UI and passed to the AI reviewer.
Relevance: HIGH ≥ 60 **and** at least one strong signal; MEDIUM ≥ 35; else LOW.

### 3.3 Identity score (0–100)

- Own website confirmed (their name or handle appears on it): +40
- LinkedIn profile URL: +20
- Company name: +15
- Real first/last name: +15
- Own channel with uploads: +10

### 3.4 Email rules ("no normal-people emails")

New defaults, changeable in Audience → Rules:
- **Business email only.** Free-mail is accepted only when the person published it themselves as a contact
  address (channel bio, their video descriptions, their website) **and** intent is HIGH.
- **Outreach from HIGH only** (MEDIUM stays visible for manual review).
- **Identity required.** Identity ≥ 40 (e.g. real name + company, or a confirmed website).
- Unchanged: verified-only policy, stricter rules for EU/UK/CA/AU/NZ, suppression, DNC, delete & forget.

### 3.5 Integrations (all optional, keys in env)

| Purpose | Env | Endpoint |
|---|---|---|
| Identity search | `BRAVE_SEARCH_API_KEY` or `SERPER_API_KEY` | Brave `GET /res/v1/web/search`, Serper `POST /search` |
| Email finder | `HUNTER_API_KEY` | `GET /v2/email-finder`, `GET /v2/domain-search`, `GET /v2/email-verifier` |
| Email finder | `APOLLO_API_KEY` | `POST /api/v1/people/match` (name + domain or LinkedIn URL) |
| Verification | existing, plus Hunter | as above |

Credit guards: at most 2 searches and 1 finder call per person, only for shortlisted people with identity.

### 3.6 Success metrics

- % of READY prospects with a business-domain email (target > 70%)
- Positive reply rate by intent band (validates the score)
- Cost per READY prospect (quota units + search + finder credits)
- Bounce rate < 2%

## 4. Out of scope / not allowed

- Rotating multiple YouTube API keys or projects to exceed quota (policy III.D.1.c).
- Scraping youtube.com pages, the About-page email button, LinkedIn, or lead-database websites.
- Using GitHub profile data for outreach (GitHub AUP §7).
- CAPTCHA solving.

## 5. Rollout

1. Schema: intent/identity fields on `prospects`, confidence on `prospect_emails` (additive).
2. Ship the code; existing prospects are re-scored automatically on the next worker runs.
3. Add `BRAVE_SEARCH_API_KEY` (or Serper) and `HUNTER_API_KEY` and/or `APOLLO_API_KEY` in Vercel.
4. Apply for a YouTube quota extension if collection becomes the bottleneck.

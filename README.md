# Triven Outreach Engine (TOE)

Self-hosted cold-email system for Triven AI. It **finds** local businesses, **finds and verifies**
their email addresses for free, **writes** personalized plain-text emails, **sends** a 4-step sequence
from rotating Gmail accounts inside the prospect's business hours, **reads replies** and stops the
sequence automatically, and puts the interested prospects in front of you.

**No paid APIs, SaaS or data providers.** It only uses SMTP, IMAP, DNS, HTTP and open-source libraries.
Ollama (local AI) is optional.

---

## ⚡ Quickstart (≈15 min)

```bash
# 1. install (Windows: powershell -ExecutionPolicy Bypass -File scripts\setup.ps1)
make setup                       # venv + deps + Chromium + DB + `toe doctor`

# 2. see it work with fake data (nothing can be sent)
toe seed                         # 18 fake clinics/contractors on .test domains
toe preview --lead 1 --all-steps # the exact 4 emails lead 1 would get
toe run --dry-run                # simulate a full sending day, minute by minute
toe dashboard                    # http://localhost:8501

# 3. go real
#    fill .env (Gmail App Passwords, OWNER_EMAIL, SENDER_PHYSICAL_ADDRESS)
toe seed --clear
toe account test --all           # SMTP+IMAP login + 1 real email to you per account
toe campaign create dental-tx --niche dental
toe source maps --query "dental clinic" --locations locations/tx.txt --campaign dental-tx
toe enrich --campaign dental-tx --limit 200
#    → review + approve in the dashboard (Approval queue), or:
toe approve --campaign dental-tx --min-score 70
toe run --dry-run                # see tomorrow's sends
#    set ALLOW_SENDING=true in .env, then:
toe run --live                   # scheduler + IMAP reply pollers
```

On Windows the commands are `.venv\Scripts\toe …` (or activate the venv first:
`.venv\Scripts\Activate.ps1`).

### Gmail App Passwords (one per sending account)

1. Sign into the Gmail account → <https://myaccount.google.com/security>.
2. Turn on **2-Step Verification**. App Passwords only exist when 2FA is on.
3. Go to <https://myaccount.google.com/apppasswords> and create one called "TOE". Copy the 16 characters.
4. Gmail → ⚙ Settings → *Forwarding and POP/IMAP* → **Enable IMAP**.
5. Put it in `.env`: `GMAIL_1_USER=…@gmail.com`, `GMAIL_1_PASS=abcd efgh ijkl mnop`. Repeat for `GMAIL_2_…` through `GMAIL_5_…`.
6. Run `toe account test --all`. An account can't email prospects until its self-test passes.

App passwords live **only** in `.env`. The DB stores just the env key name (`GMAIL_1_PASS`), and passwords are never logged.

---

## How it works

```
 Google Maps / directory recipes / CSV
            │  dedupe (domain → phone → fuzzy name+zip)
            ▼
 companies ──► ENRICH waterfall (free Apollo/Hunter replacement)
            │   1 website crawl (mailto, JSON-LD, Cloudflare-obfuscated, [at]/[dot], reversed CSS, JS render fallback)
            │   2 Facebook / Instagram public pages (login wall → manual task)
            │   3 names → email patterns + role addresses → MX + SMTP RCPT probe + catch-all test → score 0-100
            │   4 LinkedIn → human task card (search links + paste a name → step 3 runs automatically)
            ▼
 signals (no online booking, closed weekends, closes 4pm, reviews saying "nobody answers", 300+ reviews…)
            ▼
 APPROVAL QUEUE (rendered email #1 + score + signals) ── you click Approve
            ▼
 SCHEDULER (1 email max per tick)  pre-send checklist → rotation → prospect-local window → SMTP
            │   follow-ups: same account, same Gmail thread (In-Reply-To/References, "Re:")
            ▼
 IMAP POLLER (5 min) → bounce / OOO / unsubscribe / negative / wrong person / positive
            │   human reply ⇒ stop sequence + pause colleagues + 🔥 Hot replies + draft (never auto-sent)
            ▼
 PIPELINE (interested → demo building → demo sent → call → won)
```

### The 4-email sequence

| Step | Day | What | Sent as |
|---|---|---|---|
| 0 | 0 | intro + personal line + demo number (or "I'll build you one") + opt-out + address | new thread |
| 1 | 3 | "did you try the number?" | reply in thread |
| 2 | 7 | the offer to build a version trained on them | reply in thread |
| 3 | 14 | breakup, and the first time the price is mentioned ($199 setup + usage) | reply in thread |

Change the day offsets per campaign (`--offsets 0,3,7,14` or in the dashboard).

### Sending rules

- **Windows:** Tue–Thu at full volume, Mon/Fri at 50 %, 08:00–11:30 and 13:00–16:00 in the **prospect's** timezone (from state/ZIP). Never on weekends or US federal holidays (`config/holidays_us.txt`, 2025–2030).
- **Caps:** warm-up of 8/15/25/35 per day for weeks 1/2/3/4+, a hard ceiling of 40, a global daily cap (default 120, with a confirmation prompt above 150), a per-campaign cap on new sends, and addresses scoring 40–69 limited to 20 % of volume. Anything under 40 is never sent.
- **Throttling:** random 90–420 s gap per account and at least 20 s between any two sends.
- **Checklist before every send:** not suppressed, score OK, account active and under cap, inside the window, no reply received, template valid, step not already sent, live mode on, account self-tested. **Suppression is checked again immediately before `sendmail()`**.
- **Failures:** 4xx errors back off exponentially. Auth or quota errors pause the account and alert you. SMTP-time 5xx on the recipient marks a hard bounce and suppresses the address. A >4 % 7-day bounce rate or 3 consecutive failures auto-pause the account.

---

## CLI

```
toe init | doctor | seed [--clear] | dashboard | backup | kill | unkill
toe campaign create NAME --niche dental [--demo-number …] [--agent-type …] [--offsets 0,3,7,14]
toe campaign list | pause NAME | resume NAME
toe source maps --query "dental clinic" --locations locations/tx.txt --campaign dental-tx
toe source maps --query "plumber" --grid 30.27,-97.74,20,5 --campaign hvac-atx   # lat,lng,radius_km,step_km
toe source directory --recipe yellowpages_home_services --campaign hvac-atx
toe source csv examples/sample_import.csv --campaign dental-tx [--map "Biz=name"]
toe enrich --campaign dental-tx --limit 200 [--retry] [--no-probe] [--no-social]
toe verify --campaign dental-tx [--all]
toe signals --campaign dental-tx
toe preview --lead 123 [--step 2] [--all-steps]
toe approve --campaign dental-tx --min-score 70   |   toe reject --lead 5 --reason competitor --suppress-domain
toe leads [--campaign …] [--status queued]
toe run --dry-run [--date 2026-09-22] [--bodies]   # simulate a day, send nothing
toe run                                           # scheduler + IMAP, DRY mode
toe run --live                                    # real sending
toe replies [--all]   |   toe inbox poll   |   toe inbox handled 7
toe inbox simulate-reply --lead 3 --text "not interested"   # test auto-stop offline
toe stats --campaign dental-tx --days 30
toe account sync | list | test --all | pause EMAIL | resume EMAIL | set-cap EMAIL 20
toe suppress add me@example.com --reason manual | add @competitor.com --reason competitor
toe suppress remove X | list | import file.txt
toe task list | resolve 12 --first Sarah --last Nguyen --title "Office Manager" | resolve 12 --email x@y.com | dismiss 12
toe blocklist-update my_list.txt --kind disposable
```

## Dashboard (`toe dashboard`, localhost only)

| Page | What it's for |
|---|---|
| **Today** | sent vs cap, what's due, per-account health bars (sent/cap, bounce %, reply %), alerts, a **🛑 kill switch**, and a one-click dry-run of the next send day |
| **Hot replies** | triage inbox (hot first), full thread, fix the classification, mark handled, suppress an email or domain, an editable draft (Ollama or rules), and *open in mail app* / *open thread in Gmail*. Replies are **never sent automatically** |
| **Approval queue** | email, score, source, MX provider, signals, the **exact rendered first email**, an editable personal line, other candidates; approve or reject one at a time or in bulk, with a reason |
| **Manual tasks** | LinkedIn lookups (Google/LinkedIn search links + name box), Facebook login walls, wrong-person re-targets (emails mentioned in the reply are pre-filled) |
| **Leads & import** | CSV upload with column mapping, run enrichment, company browser/export, company detail (signals, every candidate, review text), "I called — voicemail" signal |
| **Campaigns & templates** | create/edit campaigns (niche, demo number, agent type, daily cap, step offsets), **edit template YAML** with a live preview and validation |
| **Pipeline** | interested → building demo → demo sent → call booked → won/lost, with notes |
| **Analytics** | reply/positive rate by template, subject variant, niche, account, opener signal, day of week and hour, with **sample size, 95 % Wilson interval and an A/B significance verdict** |
| **Suppression** | search, add email/@domain, import, export |
| **System** | health checks, sync accounts, poll IMAP now, backup now, audit log |

## Templates

`templates/<set>/step{0..3}.yaml` are hot-reloaded, so edits need no restart.

```yaml
subject_variants: ["quick question about missed calls", "{{CompanyName}} — after-hours calls"]
required_vars: [CompanyName, UnsubLine]
fallback_if_missing: {City: ""}
body: |
  Hi {{FirstName}},
  {{#if DemoNumber}}call {{DemoNumber}}{{else}}I'll build you one{{/if}}
  {I noticed|I saw} …                                  # spintax, seeded per lead → same lead = same text
body_no_name: |                                        # used when the first name is unknown
  Hi {{CompanyName}} team,
```

- **Variables:** `{{FirstName}} {{CompanyName}} {{City}} {{Niche}} {{DemoNumber}} {{PersonalLine}} {{SenderName}} {{Signature}} {{UnsubLine}}`, plus `{{DemoOrOffer}}`, `{{GapParagraph}}`, `{{AgentParagraph}}` (home services / generic) and `{{DemoPrompt}}`.
- **Unknown first name:** `body_no_name` is used, or the greeting is rewritten automatically. The validator blocks `Hi ,` and `Hi there`.
- **Demo number:** set per niche in `config/settings.yaml` (`niches.dental.demo_number`), or per campaign. If there's no number, every template falls back to the "I'll build you one" copy.
- **New niche:** add it under `niches:` in `settings.yaml`, with `template_set: generic` or your own folder. The generic set changes its gap and agent paragraphs based on `agent_type` (receptionist, salesperson, follow_up, scheduler or support).
- **Openers:** `config/personalization.yaml` maps each signal to 3–5 spintax lines. If Ollama is running it may rewrite the opener, but the output is checked (≤25 words, no compliments, no dashes or "!", and no numbers or proper nouns that weren't in the input). If the check fails, the rule-based line is used.

### Copy validator (blocks the send)

- Step 0 is limited to 120 words and follow-ups to `max_words_followup`. The footer isn't counted.
- Step 0 can't contain any links. Follow-ups can have one.
- Plain text only: no HTML, no tracking pixel.
- Blocked: spam words (`config/spam_words.txt`), ALL-CAPS words longer than 3 characters (there's an allowlist, e.g. HVAC), more than one `!`, and `$$$`.
- Subjects must be 45 characters or fewer and lowercase-ish, with no fake `Re:` on step 0. If a subject variant is too long for a given company name, the next variant is tried.
- Step 0 must include the opt-out line and the physical address.

> ⚠️ The v1 seed copy for **dental step 2 is ~85 words**, which is over the spec's 60-word follow-up limit.
> `validator.max_words_followup` is set to **90** so the copy you supplied can be sent. Trim step 2 and set it back to 60 if you want the stricter rule.
> The home-services build offer says "No charge" rather than "free", because "free" is on the spam-word list.

## Email verification (free)

Each address gets a score from 0 to 100 through these checks: syntax → disposable list → free-mail/role flags → **MX lookup** (the provider is recorded) → **SMTP RCPT probe** (HELO / `MAIL FROM:<>` / `RCPT TO` / QUIT, never DATA; one session per domain per 60 s with the catch-all probe first) → catch-all cap of 60.

- Google/Microsoft-hosted domains often accept every address, so an **accept from them counts as unknown, not valid**. A clear `550 5.1.1 user unknown` is still treated as invalid.
- **Most home ISPs block port 25.** `toe doctor` detects this and turns probing off. Scores then depend on MX plus *where the address was found*: an address published on the company's own site scores about 70–80, a guessed pattern about 50. For better scores, run `toe verify` from a VPS with port 25 open.
- Sending by score: **≥70** normal · **40–69** "risky" sub-cap (20 % of volume) · **<40** never sent.

## Local AI (optional)

```bash
ollama pull qwen2.5:7b        # or llama3.1:8b — set ollama.model in settings.yaml
ollama serve
```

Ollama is used to rewrite openers (checked, with a rule-based fallback), as a second opinion on unclear reply classifications, and to draft reply suggestions. If Ollama isn't running, everything still works.

## Files

```
config/settings.yaml          caps, windows, warm-up, niches, demo numbers, validator limits
config/personalization.yaml   signal → opener lines, "nobody answers" review phrases
config/holidays_us.txt        no-send dates · tz_by_state.yaml state/ZIP → timezone
config/*_domains.txt, role_addresses.txt, spam_words.txt   editable lists
config/recipes/*.yaml         directory crawler recipes (2 examples)
templates/{dental,home_services,generic}/step0-3.yaml
src/toe/…                     db, sourcing, enrich, templating, sending, inbox, ai, dashboard, cli
tests/                        pytest: spintax, validator, patterns, extraction, bounces, classifier,
                              timezone windows, suppression enforcement, dedupe, verification, full sequence
RISKS.md                      read before sending
```

Data lives in `data/toe.db` (SQLite, WAL mode, so the dashboard, scheduler and CLI can run at the same time). `toe backup` writes a consistent snapshot plus templates and config to `backups/` (**never `.env`**). The scheduler also takes one automatically every 24 hours.

## Tests

```bash
make test        # or: .venv\Scripts\python -m pytest -q
```

## Things TOE adds beyond the brief

- A **pipeline board** (interested → won) and a **template editor** with a live preview, both in the dashboard.
- An **ICP priority score** built from signals, which sorts the approval queue and the send order.
- A `List-Unsubscribe: mailto:` header. It isn't a link, and it gives Gmail and Yahoo an unsubscribe button, which beats being marked as spam.
- **Cloudflare email-protection decoding** in the crawler, plus booking and chat widget detection for about 60 vendors.
- Reviews are sorted by **lowest rating**, which is where "nobody answers the phone" complaints show up.
- A short opt-out line on follow-ups (CAN-SPAM covers every commercial message). Configure it with `sender.followup_optout`.
- The **Spam folder** is polled too, so replies that land there aren't missed. Mail is read-only (`BODY.PEEK`), so nothing is marked as read.
- A **wrong-person** reply: any email address mentioned in it is captured as a new candidate.
- **Crash-safe sending:** a crash in the middle of a send never produces a duplicate.
- `toe inbox simulate-reply` tests the whole auto-stop path offline, and `toe doctor` runs pre-flight checks.

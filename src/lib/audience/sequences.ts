// AI Builder sequences for people found through YouTube comments. One per PRD campaign.
// Each opens with WHY we're writing ({{commentHook}}: the video they commented on + what
// they talked about), then Email 1 → use case → examples → try/demo.
// Written for a worldwide English-speaking audience: plain words, no idioms, no US-only
// references, no links before the last step, one easy question per email.
import type { LibrarySequence } from '../sequence-library'

const OPT_OUT = `{If it's not relevant, just reply "no" and I won't follow up.|Not for you? Reply "no" and I'll leave it there.}`
const FOOTER = `{{#if senderAddress}}
{{senderAddress}}{{/if}}`
const NOTE = `{{#if personalNote}}{{personalNote}}

{{/if}}`
const SUBJECT = `{{#if commentTopic}}{your comment about {{commentTopic}}|{{commentTopic}}}{{else}}{your comment on {{sourceChannel|a YouTube video}}|building {{useCaseShort}}}{{/if}}`

const TRY_IT = `{{#if builderUrl}}If you'd like to try building one yourself, you can start here: {{builderUrl}}{{else}}If you'd like to try building one yourself, reply "access" and I'll send you a link.{{/if}}`

const EXAMPLES = `- An AI receptionist that answers every call, handles common questions and books appointments
- An AI sales agent that replies to new leads within a minute, qualifies them and books a call
- A follow-up agent that chases quotes, no-shows and unpaid invoices
- A support agent trained on your own documents and FAQs`

export const AI_BUILDER_SEQUENCES: LibrarySequence[] = [
  // ─── Founders & business owners ──────────────────────────────────────────
  {
    id: 'ai_builder_founders',
    niche: 'AI Builder — Founders & business owners',
    description: 'For YouTube commenters who run a startup or business. Opens with their comment, then pitches building an agent for their own business. Personal line from the AI review is used when available.',
    steps: [
      {
        type: 'FIRST_EMAIL',
        name: 'AI Builder Founders: your comment',
        subject: SUBJECT,
        body: `{Hi|Hello} {{name}},

{{commentHook}}

${NOTE}A lot of founders run into the same wall with AI agents: the demo in the video takes an afternoon, but making it work with real customers, your calendar and your tools takes weeks.

{I'm building|We're building} Triven, an AI Builder where you describe the agent you need, for example {{useCase}}, and it runs on your business without you building everything from scratch.

{Would it be useful if I set one up around {{companyName|your business}} so you can try it?|Worth me setting one up for {{companyName|your business}} so you can try it?}

{{senderFirstName}}

${OPT_OUT}${FOOTER}`,
      },
      {
        type: 'FOLLOW_UP_1',
        name: 'AI Builder Founders: how it works',
        subject: '',
        body: `{Hi|Hello} {{name}},

{Quick follow-up|Following up on my note} with what this looks like in practice.

You tell Triven in plain English what the agent should do: who it talks to, what it needs to know, and what happens next (book a call, update your CRM, send a follow-up). Triven builds the agent and handles the setup, so you're not stitching five different tools together.

For {{companyName|your business}} that could be {{useCase}}.

{Want me to set one up so you can see it working?|Shall I put one together for you to try?}

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_2',
        name: 'AI Builder Founders: examples',
        subject: '',
        body: `{Hi|Hello} {{name}},

A few examples of agents you can build with Triven:

${EXAMPLES}

Each one is set up by describing it, not by coding it.

{Which of these would save you the most time?|Would any of these be useful for {{companyName|your business}}?}

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_3',
        name: 'AI Builder Founders: try it',
        subject: '',
        body: `{Hi|Hello} {{name}},

I'll leave it here so I'm not filling your inbox.

${TRY_IT}

Or if a 15-minute walkthrough is easier, reply "demo" and I'll send a few times that suit your timezone.

Thanks,
{{senderFirstName}}
Triven${FOOTER}`,
      },
    ],
  },

  // ─── Developers ──────────────────────────────────────────────────────────
  {
    id: 'ai_builder_developers',
    niche: 'AI Builder — Developers',
    description: 'For commenters who write code (APIs, LangChain, RAG, agent frameworks). Technical tone: skip the plumbing, keep control of the logic. Asks for honest feedback rather than a sale.',
    steps: [
      {
        type: 'FIRST_EMAIL',
        name: 'AI Builder Developers: your comment',
        subject: SUBJECT,
        body: `{Hi|Hello} {{name}},

{{commentHook}}

${NOTE}If you've built agents from scratch, you know most of the time goes into the plumbing rather than the agent: voice and telephony, memory, tool calls, retries, integrations, hosting.

{I'm building|We're building} Triven, an AI Builder that takes care of that layer, so you can go from idea to a working agent (for example {{useCase}}) much faster and spend your time on the logic that's actually yours.

{Would you be up for trying it and telling me where it falls short?|Would you try it and give me honest feedback?}

{{senderFirstName}}

${OPT_OUT}${FOOTER}`,
      },
      {
        type: 'FOLLOW_UP_1',
        name: 'AI Builder Developers: where it helps',
        subject: '',
        body: `{Hi|Hello} {{name}},

{Quick follow-up|Following up on my note}. Where I think Triven helps a developer most:

- Prototypes: get a working agent in front of a client or your team the same day
- Client projects: stop rebuilding the same voice, memory and integration setup for every job
- The boring parts: phone numbers, calendars, CRMs and webhooks are already handled

You still decide how the agent behaves, what tools it can call and what data it uses.

{Want early access?|Shall I send you access?}

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_2',
        name: 'AI Builder Developers: things to ship',
        subject: '',
        body: `{Hi|Hello} {{name}},

A few things you could ship on Triven in a day rather than a sprint:

${EXAMPLES}

{Is one of these close to something you're working on?|Which of these is closest to what you're building?}

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_3',
        name: 'AI Builder Developers: try it',
        subject: '',
        body: `{Hi|Hello} {{name}},

Last note from me.

${TRY_IT}

If you do try it, I'd value a blunt reply about what's missing. That's what shapes what we build next.

Thanks,
{{senderFirstName}}
Triven${FOOTER}`,
      },
    ],
  },

  // ─── Agencies ────────────────────────────────────────────────────────────
  {
    id: 'ai_builder_agencies',
    niche: 'AI Builder — AI & automation agencies',
    description: 'For agency owners who build agents for clients. Angle: deliver the tenth client agent as fast as the first, without rebuilding the stack.',
    steps: [
      {
        type: 'FIRST_EMAIL',
        name: 'AI Builder Agencies: your comment',
        subject: SUBJECT,
        body: `{Hi|Hello} {{name}},

{{commentHook}}

${NOTE}When you build agents for clients, the hard part usually isn't the first one. It's delivering the fifth and the tenth without rebuilding the whole stack each time, and keeping them all running.

{I'm building|We're building} Triven, an AI Builder made for that: you set up agents for each client, such as receptionists, sales agents or follow-up agents, from one place and without starting from scratch.

{Would it help to see how a client build looks on it?|Worth a look for your client work?}

{{senderFirstName}}

${OPT_OUT}${FOOTER}`,
      },
      {
        type: 'FOLLOW_UP_1',
        name: 'AI Builder Agencies: delivery',
        subject: '',
        body: `{Hi|Hello} {{name}},

{Quick follow-up|Following up on my note}. Where Triven helps an agency:

- Faster delivery: describe what the client needs and have a working agent to show in the first meeting
- Less maintenance: one place to update prompts, knowledge and integrations across clients
- More clients per person: less custom plumbing per project

{Want me to build a sample agent for one of your client types so you can see it?|Shall I set up a sample for one of your client types?}

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_2',
        name: 'AI Builder Agencies: client examples',
        subject: '',
        body: `{Hi|Hello} {{name}},

A few client agents you could set up on Triven:

- A dental or medical clinic: a receptionist that answers every call and books appointments
- A real estate team: a lead agent that replies in under a minute and books viewings
- A home services company: a follow-up agent that chases quotes and reviews
- A SaaS company: a support agent trained on its docs

{Which kind of client do you work with most?|What kind of clients do you mostly build for?}

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_3',
        name: 'AI Builder Agencies: try it',
        subject: '',
        body: `{Hi|Hello} {{name}},

I'll stop here so I'm not crowding your inbox.

${TRY_IT}

If you'd rather see it built around one of your clients, reply "demo" and I'll send a few times that suit your timezone.

Thanks,
{{senderFirstName}}
Triven${FOOTER}`,
      },
    ],
  },

  // ─── Automation consultants & freelancers ───────────────────────────────
  {
    id: 'ai_builder_consultants',
    niche: 'AI Builder — Automation consultants & freelancers',
    description: 'For consultants and freelancers (n8n, Make, Zapier, Upwork). Angle: add AI agents to what you already sell, prototype live with the client.',
    steps: [
      {
        type: 'FIRST_EMAIL',
        name: 'AI Builder Consultants: your comment',
        subject: SUBJECT,
        body: `{Hi|Hello} {{name}},

{{commentHook}}

${NOTE}A lot of automation work is moving from "connect app A to app B" to "put an agent in the middle that talks to customers". That's a big opportunity, but building each agent by hand eats the margin.

{I'm building|We're building} Triven, an AI Builder where you describe the agent, for example {{useCase}}, and it's ready to deliver, so you can offer AI agents on top of the automation work you already do.

{Would that be useful for your clients?|Is that something your clients ask for?}

{{senderFirstName}}

${OPT_OUT}${FOOTER}`,
      },
      {
        type: 'FOLLOW_UP_1',
        name: 'AI Builder Consultants: how it fits',
        subject: '',
        body: `{Hi|Hello} {{name}},

{Quick follow-up|Following up on my note}. How Triven fits alongside your existing tools:

Your workflows keep doing what they do well. Triven adds the agent that talks to people: it answers the call or message, understands what the customer wants, and then hands off to the workflow (create the booking, update the CRM, send the quote).

You can build the first version live with the client, which makes the proposal much easier to sell.

{Want to try building one for a client you're working with now?|Shall I send you access?}

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_2',
        name: 'AI Builder Consultants: examples',
        subject: '',
        body: `{Hi|Hello} {{name}},

A few agents consultants can deliver with Triven:

${EXAMPLES}

{Which of these do your clients ask about most?|Would any of these fit a project you have now?}

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_3',
        name: 'AI Builder Consultants: try it',
        subject: '',
        body: `{Hi|Hello} {{name}},

Last note from me.

${TRY_IT}

If a quick walkthrough is easier, reply "demo" and I'll send a few times that suit your timezone.

Thanks,
{{senderFirstName}}
Triven${FOOTER}`,
      },
    ],
  },

  // ─── Enthusiasts ─────────────────────────────────────────────────────────
  {
    id: 'ai_builder_enthusiasts',
    niche: 'AI Builder — AI enthusiasts',
    description: 'For engaged learners who comment "how do I build this?". Friendly, low-pressure: build your first agent without learning five tools. Invites them to try it.',
    steps: [
      {
        type: 'FIRST_EMAIL',
        name: 'AI Builder Enthusiasts: your comment',
        subject: SUBJECT,
        body: `{Hi|Hello} {{name}},

{{commentHook}}

${NOTE}Videos like that make building an agent look easy, and then you find out you need five different tools, API keys and a lot of trial and error before anything works.

{I'm building|We're building} Triven to fix that: an AI Builder where you describe the agent you want, for example {{useCase}}, and build it without writing code or connecting everything yourself.

{Would you like to try building your first one?|Want to give it a try?}

{{senderFirstName}}

${OPT_OUT}${FOOTER}`,
      },
      {
        type: 'FOLLOW_UP_1',
        name: 'AI Builder Enthusiasts: how it works',
        subject: '',
        body: `{Hi|Hello} {{name}},

{Quick follow-up|Following up on my note}. Here's how building an agent on Triven works:

1. Describe what it should do, in plain English
2. Add what it needs to know (a website, documents, FAQs)
3. Test it by chatting or calling it
4. Connect it to where it should work: a phone number, your website, your calendar

{Want access so you can try it?|Shall I send you access?}

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_2',
        name: 'AI Builder Enthusiasts: ideas',
        subject: '',
        body: `{Hi|Hello} {{name}},

A few first projects people enjoy building:

${EXAMPLES}

Any of them is a good way to learn how agents work in a real setting.

{Which one would you build first?|Is there one you'd want to try?}

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_3',
        name: 'AI Builder Enthusiasts: try it',
        subject: '',
        body: `{Hi|Hello} {{name}},

Last note from me.

${TRY_IT}

Thanks, and good luck with what you're building.

{{senderFirstName}}
Triven${FOOTER}`,
      },
    ],
  },
]

/** Sample audience lead for template previews */
export const SAMPLE_AUDIENCE_LEAD = {
  firstName: 'Sarah',
  lastName: 'Okafor',
  fullName: 'Sarah Okafor',
  companyName: 'Brightline Studio',
  companyEmail: 'sarah@brightline.studio',
  industry: 'AI Builder',
  sourceChannel: 'Liam Ottley',
  sourceVideo: 'How I Built an AI Receptionist in 20 Minutes (n8n + Vapi) | Full Tutorial',
  commentTopic: 'building voice agents for dental clinics',
  interestCategory: 'AI_RECEPTIONIST',
  persona: 'AGENCY',
  personalizationNotes: 'Handing off to a human mid-call is where most voice agents still break, so testing that path first is smart.',
}

// Use-case campaigns (PRD M6): the campaign is chosen by what the person wants to build;
// persona only changes the tone ({{#if isAgency}} / {{#if isDeveloper}}); their words
// ({{commentHook}}, {{blockerLine}}) open the email; each ends by offering a ready-made
// template for that exact use case ({{templateOffer}}).
// Same rules as the other AI Builder sequences: plain text, no links before the last step,
// one easy question per email, spintax, soft opt-out, postal address in the footer.
// Claims about Triven stay within the capability sheet (Settings → Triven capabilities).
import type { LibrarySequence, LibraryStep } from '../sequence-library'

const OPT_OUT = `{If it's not relevant, just reply "no" and I won't follow up.|Not for you? Reply "no" and I'll leave it there.}`
const FOOTER = `{{#if senderAddress}}
{{senderAddress}}{{/if}}`
const NOTE = `{{#if personalNote}}{{personalNote}}

{{/if}}`
const BLOCKER = `{{#if blockerLine}}{{blockerLine}}

{{/if}}`
const TRY_IT = `{{#if builderUrl}}If you'd like to try it yourself, you can start here: {{builderUrl}}{{else}}If you'd like to try it yourself, reply "access" and I'll send you a link.{{/if}}`

interface Copy {
  id: string
  name: string
  subject: string
  why: string            // paragraph after the hook: the problem + what Triven does for it
  agencyWhy?: string     // replaces `why` for agencies / consultants
  devWhy?: string        // replaces `why` for developers
  question: string
  how: string            // follow-up 1: how it works for this use case
  examples: string[]     // follow-up 2
}

function whyBlock(c: Copy) {
  const agency = c.agencyWhy ? `{{#if isAgency}}${c.agencyWhy}{{else}}` : ''
  const dev = c.devWhy ? `{{#if isDeveloper}}${c.devWhy}{{else}}` : ''
  const close = (c.agencyWhy ? '{{/if}}' : '') + (c.devWhy ? '{{/if}}' : '')
  return `${agency}${dev}${c.why}${close}`
}

function build(c: Copy): LibrarySequence {
  const steps: LibraryStep[] = [
    {
      type: 'FIRST_EMAIL',
      name: `${c.name}: your comment`,
      subject: c.subject,
      body: `{Hi|Hello} {{name}},

{{commentHook}}

${NOTE}${BLOCKER}${whyBlock(c)}

{{templateOffer}}

${c.question}

{{senderFirstName}}

${OPT_OUT}${FOOTER}`,
    },
    {
      type: 'FOLLOW_UP_1',
      name: `${c.name}: how it works`,
      subject: '',
      body: `{Hi|Hello} {{name}},

{Quick follow-up|Following up on my note} with what this looks like in practice.

${c.how}

{Want me to send the template so you can see it working?|Shall I send it over?}

{{senderFirstName}}`,
    },
    {
      type: 'FOLLOW_UP_2',
      name: `${c.name}: examples`,
      subject: '',
      body: `{Hi|Hello} {{name}},

A few ways people use ${c.name.toLowerCase()} agents built with Triven:

${c.examples.map((e) => `- ${e}`).join('\n')}

{Which of these is closest to what you're building?|Is one of these close to what you had in mind?}

{{senderFirstName}}`,
    },
    {
      type: 'FOLLOW_UP_3',
      name: `${c.name}: last note`,
      subject: '',
      body: `{Hi|Hello} {{name}},

I'll leave it here so I'm not filling your inbox.

${TRY_IT}

Or if a 15-minute walkthrough is easier, reply "demo" and I'll send a few times that suit your timezone.

Thanks,
{{senderFirstName}}
Triven${FOOTER}`,
    },
  ]
  return {
    id: c.id,
    niche: `AI Builder — ${c.name}`,
    description: `Use-case campaign for people who want to build ${c.name.toLowerCase()} agents. Opens with their own comment and blocker, pitches the matching template; agency and developer tone variants.`,
    steps,
  }
}

const SUBJ = (fallback: string) => `{{#if commentTopic}}{your comment about {{commentTopic}}|{{commentTopic}}}{{else}}${fallback}{{/if}}`

export const USE_CASE_SEQUENCES: LibrarySequence[] = [
  build({
    id: 'uc_receptionist', name: 'AI Receptionist', subject: SUBJ('{your AI receptionist|the receptionist you\'re building}'),
    why: `Most AI receptionists stall in the same place: the call works in a demo, but running it every day for a real business takes weeks. {With Triven you describe the receptionist you need and Triven runs it|Triven lets you describe the receptionist and runs it for you}, so your time goes into the conversation instead of the infrastructure.`,
    agencyWhy: `If you're building receptionists for clients, the hard part isn't the first one, it's setting up the next ten. With Triven you describe the receptionist once, then adapt it for each client instead of rebuilding it.`,
    question: `{Want me to send the template?|Shall I send it over?}`,
    how: `You tell Triven in plain English what the receptionist should do: what it answers, what it needs to ask, when to book and when to hand over to a person. Triven builds the agent from that, so you're not stitching several tools together.`,
    examples: ['Answering every call and booking appointments outside office hours', 'Handling the common questions so the front desk doesn\'t have to', 'Taking a message and passing urgent calls to a person'],
  }),
  build({
    id: 'uc_voice', name: 'Voice Agent', subject: SUBJ('{your voice agent|the voice agent you\'re building}'),
    why: `Making a voice agent sound natural is the fun part. Keeping it reliable on real calls is what eats the week. Triven gives you the agent layer ready-made, so you can focus on what the agent says and does.`,
    devWhy: `You clearly know how to wire a voice agent together yourself. Triven is for the parts you'd rather not rebuild each time, so the conversation logic stays yours and the plumbing isn't your problem.`,
    question: `{Want me to send the starter template?|Shall I send it over?}`,
    how: `You describe the call flow in plain English: how the agent opens, what it needs to find out, and what happens at the end of the call. Triven builds the agent from that description, and you adjust it the same way.`,
    examples: ['Outbound calls that confirm appointments and reschedule no-shows', 'Inbound calls that answer questions and capture the caller\'s details', 'A first-line agent that qualifies callers before a person takes over'],
  }),
  build({
    id: 'uc_sales', name: 'AI Sales Agent', subject: SUBJ('{your AI sales agent|the sales agent you\'re building}'),
    why: `An AI sales agent only earns its keep if it replies within a minute, follows up without being told and gets the call booked. With Triven you describe that flow in plain English and Triven runs it.`,
    agencyWhy: `If you sell lead-response to clients, the same sales agent gets rebuilt for every account. With Triven you describe it once and adapt it per client.`,
    question: `{Want me to send the sales-agent template?|Shall I send it over?}`,
    how: `You write down what a good sales rep would do with a new lead: the first reply, the questions, the follow-ups and when to book a call. Triven turns that into an agent that does it for every lead.`,
    examples: ['Replying to every new lead within a minute, day or night', 'Following up on quotes that went quiet', 'Booking a call with the leads that are ready to talk'],
  }),
  build({
    id: 'uc_leadqual', name: 'Lead Qualification', subject: SUBJ('{qualifying leads with AI|your lead qualification agent}'),
    why: `Qualifying leads is mostly the same few questions, asked quickly and the same way every time, followed by the right next step. With Triven you write those questions and rules down, and the agent handles every new lead that way.`,
    question: `{Want me to send the qualification template?|Shall I send it over?}`,
    how: `You list the questions that decide whether a lead is a fit and what should happen for each answer: book a call, send information, or politely close it out. Triven builds the agent from that list.`,
    examples: ['Scoring inbound form leads before anyone on the team sees them', 'Asking budget, timing and need questions in a friendly chat', 'Sending qualified leads straight to a calendar and the rest to nurture'],
  }),
  build({
    id: 'uc_support', name: 'Customer Support', subject: SUBJ('{your support agent|AI customer support}'),
    why: `A support agent is only as good as what it knows and when it knows to stop. With Triven you give it your own documents and FAQs and describe when it should hand over to a person.`,
    agencyWhy: `If you set up support agents for clients, most of the work is repeating the same setup with different documents. With Triven you describe the agent once and point it at each client's material.`,
    question: `{Want me to send the support-agent template?|Shall I send it over?}`,
    how: `You give Triven the material the agent should answer from and describe the rules: what it can answer on its own, what it should never promise, and when a person takes over. Triven builds the agent around that.`,
    examples: ['Answering order and booking questions from your own FAQ', 'Helping new customers get set up step by step', 'Passing anything unusual to a person with a short summary'],
  }),
  build({
    id: 'uc_agency', name: 'Agency Automation', subject: SUBJ('{automations for your clients|your client automations}'),
    why: `If you build automations for clients, the hard part isn't the first build. It's rebuilding it for the next client and keeping them all running. Triven lets you describe an agent once and adapt it for each client.`,
    question: `{Want me to send a template you could adapt for a client?|Shall I send one over?}`,
    how: `You describe the agent in plain English, then copy it for the next client and change what's different: their documents, their tone, their next step. Triven handles the setup, so one person can run far more client agents.`,
    examples: ['A receptionist or lead-response agent you set up per client', 'Follow-up agents that chase quotes and no-shows for each client', 'Support agents trained on each client\'s own material'],
  }),
  build({
    id: 'uc_developer', name: 'Developer Builder', subject: SUBJ('{the agent you\'re building|your agent workflow}'),
    why: `You clearly know how to build this yourself. Triven is for the parts you'd rather not rebuild each time, so the logic stays yours and the plumbing around the agent isn't your problem.`,
    question: `{Would you be up for trying the starter template and telling me honestly where it falls short?|Would you try the starter template and tell me what's missing?}`,
    how: `You describe what the agent should do and where it should hand over. Triven builds and runs it, and you can keep adjusting the behaviour instead of maintaining the setup.`,
    examples: ['Agents that call your own tools and APIs as part of a workflow', 'Multi-step workflows that would otherwise need several services glued together', 'Internal agents your team can change without a deploy'],
  }),
  build({
    id: 'uc_business', name: 'Business Automation', subject: SUBJ('{automating your business with AI|your automation idea}'),
    why: `Most of the value in automation is in the unglamorous parts: follow-ups, data entry, keeping the CRM up to date. Triven lets you describe that work in plain English and turns it into an agent that does it.`,
    question: `{Want me to send a template to start from?|Shall I send one over?}`,
    how: `You write down the task the way you'd explain it to a new assistant: what comes in, what to do with it, and what "done" looks like. Triven builds an agent from that, and you adjust it the same way.`,
    examples: ['Following up with every lead, quote and no-show automatically', 'Moving information between email, forms and your CRM', 'Sending a daily summary of what came in and what needs you'],
  }),
]

/** Which use-case campaign a person belongs in */
export const USE_CASE_CAMPAIGNS = [
  { key: 'uc_receptionist', name: 'AI Builder — AI Receptionist', useCases: ['AI_RECEPTIONIST', 'APPOINTMENT_BOOKING'] },
  { key: 'uc_voice', name: 'AI Builder — Voice Agent', useCases: ['VOICE_AGENT'] },
  { key: 'uc_sales', name: 'AI Builder — AI Sales Agent', useCases: ['AI_SALES_AGENT'] },
  { key: 'uc_leadqual', name: 'AI Builder — Lead Qualification', useCases: ['LEAD_QUALIFICATION'] },
  { key: 'uc_support', name: 'AI Builder — Customer Support', useCases: ['CUSTOMER_SUPPORT', 'ONBOARDING', 'INTERNAL_KNOWLEDGE'] },
  { key: 'uc_agency', name: 'AI Builder — Agency Automation', useCases: [] as string[] },
  { key: 'uc_developer', name: 'AI Builder — Developer Builder', useCases: ['CUSTOM_WORKFLOW'] },
  { key: 'uc_business', name: 'AI Builder — Business Automation', useCases: ['OPERATIONS_AUTOMATION', 'MARKETING_AUTOMATION', 'UNKNOWN'] },
] as const

export function useCaseCampaignKey(p: { useCase?: string | null; forWhom?: string | null; persona?: string | null }) {
  const u = p.useCase || 'UNKNOWN'
  // Agencies building generic automations get the agency campaign; specific use cases keep theirs
  if (p.forWhom === 'CLIENTS' && ['OPERATIONS_AUTOMATION', 'MARKETING_AUTOMATION', 'CUSTOM_WORKFLOW', 'UNKNOWN'].includes(u)) return 'uc_agency'
  if (u === 'CUSTOM_WORKFLOW' && !['DEVELOPER', 'TECH_PRO'].includes(p.persona || '')) return 'uc_business'
  return (USE_CASE_CAMPAIGNS.find((c) => (c.useCases as readonly string[]).includes(u)) || USE_CASE_CAMPAIGNS[7]).key
}

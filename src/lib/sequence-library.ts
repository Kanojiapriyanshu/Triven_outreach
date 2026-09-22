// Ready-made 4-step sequences per niche. Plain text, no links, one question each:
// short, specific emails that are easy to answer get the most replies and land in the inbox.
// Follow-ups are sent as replies in the same thread, so they have no subject.

export interface LibraryStep {
  type: 'FIRST_EMAIL' | 'FOLLOW_UP_1' | 'FOLLOW_UP_2' | 'FOLLOW_UP_3'
  name: string
  subject: string
  body: string
}

export interface LibrarySequence {
  id: string
  niche: string
  description: string
  steps: LibraryStep[]
}

const SIGN = `{{senderFirstName}}
Triven`

export const SEQUENCE_LIBRARY: LibrarySequence[] = [
  {
    id: 'dental',
    niche: 'Dental practices',
    description: 'Built from each practice\'s research (hours, closed days, doctor, reviews). Follow-up 3 invites them to call your demo line and test the agent as a patient. Wording varies per practice.',
    steps: [
      {
        type: 'FIRST_EMAIL',
        name: 'Dental: the gap in your hours',
        subject: '{{#if companyName}}{{{companyName}} after {{closingTime|hours}}|missed calls at {{companyName}}|calls to {{companyName}} after {{closingTime|hours}}}{{else}}{{{#if closingTime}}calls after {{closingTime}}{{else}}after-hours patient calls{{/if}}|missed patient calls}{{/if}}',
        body: `{Hi|Hello} {{name}},

{{hook}}

{Most new patients call when it suits them|New patients tend to call when it suits them}: after work, at lunch, or on a weekend with a toothache. If nobody picks up, {most don't leave a voicemail|very few leave a message}. They {call|try} the next practice on Google.

{I built|We built} Triven, an AI receptionist for dental practices. It {answers every call|picks up every call}, day or night, handles insurance and availability questions the way your team would, and books {straight into your schedule|directly into your calendar}.

{Happy to set one up|I'd be glad to set one up} trained on {{#if companyName}}{{companyName}}'s{{else}}your practice's{{/if}} services and hours, so you can call it and {hear it for yourself|judge it yourself}. {No charge and no sales call|No cost to you and no call needed}.

{Worth me setting it up?|Would that be useful?|Shall I put one together?}

{{forwardLine}}

{{senderFirstName}}

{If this isn't relevant, just say so and I won't follow up.|Not a priority right now? Just reply "no" and I'll leave it there.}`,
      },
      {
        type: 'FOLLOW_UP_1',
        name: 'Dental: what a patient hears',
        subject: '',
        body: `{Hi|Hello} {{name}},

{Quick follow-up|Just following up on my note}. {The fastest way to judge this is to hear it.|It's much easier to judge by hearing it.}

Picture a new patient calling {{companyName|your practice}} {{testMoment}}. Instead of voicemail, they hear a friendly receptionist who answers their insurance question, finds a slot, books the cleaning, and texts them a confirmation. Your team sees it in the schedule the next morning.

{I can have a version trained on {{companyName|your practice}} ready within a day.|I can set that up for {{companyName|your practice}} within a day.} {Shall I?|Want me to go ahead?}

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_2',
        name: 'Dental: your numbers',
        subject: '',
        body: `{Hi|Hello} {{name}},

{I ran some rough numbers for {{companyName|your practice}}.|I did some quick maths for {{companyName|your practice}}.}

{{gapLine}} If that means just three missed new-patient calls a month, and a new patient is often worth well over a thousand dollars over their first couple of years, that's {thousands every month|several thousand a month} going to other practices in {{city|your area}}.

Triven costs a small fraction of that. No new hire, no training, and nothing changes for your team except fewer missed calls.

{Would 10 minutes this week be worth it?|Open to a quick 10-minute look this week?}

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_3',
        name: 'Dental: call the demo line',
        subject: '',
        body: `{Hi|Hello} {{name}},

{{#if demoPhone}}{Last note from me, and it takes two minutes.|One last idea, and it only takes two minutes.}

Call {{demoPhone}} and pretend you're a new patient. {Ask to book a cleaning next week|Try booking a cleaning for next week}, ask if it takes your insurance, or say you've got a toothache and need to be seen soon.

That's the AI receptionist {{companyName|your practice}} would have answering {{#if closedWhen}}{{closedWhen}}{{else}}after hours{{/if}}. If it handles your call better than voicemail does, reply "set it up" and I'll build yours within a day.{{else}}{I'll take the silence as "not right now" and close this out.|I'll assume the timing isn't right and stop here.}

One thing worth doing either way: call {{companyName|your practice}} {{testMoment}} from your mobile and listen to what a new patient hears. If it's voicemail, that's the gap we close.

If it's ever useful, reply to this and I'll have a demo ready within a day.{{/if}}

{Either way, this is my last email.|Either way, I won't keep filling your inbox.} All the best {{practiceWish}},
{{senderFirstName}}`,
      },
    ],
  },
  {
    id: 'medspa',
    niche: 'Med spas & aesthetics',
    description: 'Evening and weekend enquiries that go unanswered and book elsewhere.',
    steps: [
      {
        type: 'FIRST_EMAIL',
        name: 'Med spa: evening enquiries',
        subject: 'the 8pm botox enquiry',
        body: `Hi {{firstName}},

{{personalNote}}

Most med spa enquiries come in the evening, when someone finally has time to look at treatments. If nobody picks up, they usually book with whoever answers first.

We built an AI receptionist for clinics like {{companyName}}. It answers calls and messages 24/7, explains treatments and pricing the way your team would, and books consultations straight into your calendar.

I can set up a version trained on your treatment menu and send you a number to test it yourself. No cost, and it takes me about a day.

Would that be worth 5 minutes of your time?

${SIGN}

P.S. If this isn't relevant, just let me know and I won't follow up.`,
      },
      {
        type: 'FOLLOW_UP_1',
        name: 'Med spa: quick bump',
        subject: '',
        body: `Hi {{firstName}}, just bumping this up.

Happy to build the demo trained on {{companyName}}'s treatments so you can call it and ask about lip filler pricing like a real client would. Takes a minute to test.

Shall I set it up?

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_2',
        name: 'Med spa: speed wins',
        subject: '',
        body: `Hi {{firstName}},

A pattern we see across aesthetics clinics: the clinic that replies within 5 minutes wins most new clients, and the ones that call back the next morning have usually lost them already.

That's the gap we close. Every enquiry at {{companyName}} gets answered and booked instantly, even at 10pm on a Sunday.

Open to a quick 10-minute call to see if it fits?

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_3',
        name: 'Med spa: close the loop',
        subject: '',
        body: `Hi {{firstName}},

I'll leave it here so I'm not crowding your inbox.

If after-hours enquiries ever become something you want to fix at {{companyName}}, reply "demo" and I'll get one set up for you.

All the best,
${SIGN}`,
      },
    ],
  },
  {
    id: 'home_services',
    niche: 'Home services (HVAC, plumbing, roofing)',
    description: 'Emergency jobs that call while the crew is on site or after hours.',
    steps: [
      {
        type: 'FIRST_EMAIL',
        name: 'Home services: the emergency call',
        subject: 'calls while you\'re on a job',
        body: `Hi {{firstName}},

{{personalNote}}

In home services, the call that comes in at 7pm or while your team is up a ladder is usually the emergency job, and it goes to whoever picks up first.

We built an AI receptionist that answers every call 24/7, qualifies the job, books it into your schedule, and texts back anyone you miss while you're on site.

If you'd like to hear it, I'll set up a version trained on {{companyName}}'s services and service area and send you a number to call. No cost, takes me a day.

Worth a look?

${SIGN}

P.S. Wrong person? Just say, and I'll leave you be.`,
      },
      {
        type: 'FOLLOW_UP_1',
        name: 'Home services: quick bump',
        subject: '',
        body: `Hi {{firstName}}, bumping this in case it got buried under job sheets.

I can have a version trained on {{companyName}} ready tomorrow. Call it, say your AC's out or a pipe burst, and see how it books you in. Takes a minute.

Want me to set it up?

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_2',
        name: 'Home services: one job pays for it',
        subject: '',
        body: `Hi {{firstName}},

Quick bit of maths: one missed emergency call is often a $300 to $1,000+ job. Most contractors we speak to miss several a week, mostly evenings and weekends.

Catching even one or two of those a month usually pays for this many times over, and your team never has to pick up the phone mid-job.

Open to a 10-minute call to see what it would catch for {{companyName}}?

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_3',
        name: 'Home services: close the loop',
        subject: '',
        body: `Hi {{firstName}},

I'll stop here so I'm not filling up your inbox.

If missed calls ever become a problem worth fixing at {{companyName}}, reply "demo" and I'll set one up for you to test.

Thanks, and good luck with the busy season.

${SIGN}`,
      },
    ],
  },
  {
    id: 'sales_teams',
    niche: 'Sales & appointment-setting teams',
    description: 'Speed-to-lead for inbound leads that arrive outside setter hours.',
    steps: [
      {
        type: 'FIRST_EMAIL',
        name: 'Setters: leads outside hours',
        subject: 'leads outside your setters\' hours',
        body: `Hi {{firstName}},

{{personalNote}}

What happens to the leads that come in after your setters log off?

Speed-to-lead is most of the game. A lead called within 5 minutes is many times more likely to book than one called the next morning, and by then they've often spoken to a competitor.

We build AI voice agents that call every new lead within seconds, 24/7, qualify them with your script, and book them straight onto your closers' calendars. Your setters pick up everything else in the morning.

I can set up a version on your script so you can hear it call you. No cost, takes me a day.

Worth a look for {{companyName}}?

${SIGN}`,
      },
      {
        type: 'FOLLOW_UP_1',
        name: 'Setters: quick bump',
        subject: '',
        body: `Hi {{firstName}}, bumping this up.

Simplest test: send me a lead form, fill it in yourself, and our agent calls you back within 30 seconds and books you in. Takes 2 minutes to see.

Want me to set that up?

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_2',
        name: 'Setters: cost per lead',
        subject: '',
        body: `Hi {{firstName}},

If you're paying for leads, the leak is usually between the form fill and the first call. Anything that sits overnight costs the same but converts a fraction as well.

Teams we work with typically see more booked appointments from the same ad spend, just by making sure every lead gets called instantly, including nights and weekends.

Open to a quick 10-minute call to see what that looks like for {{companyName}}?

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_3',
        name: 'Setters: close the loop',
        subject: '',
        body: `Hi {{firstName}},

I'll close the loop here.

If speed-to-lead or after-hours coverage becomes a priority, reply "demo" and I'll build one on your script for you to test.

All the best,
${SIGN}`,
      },
    ],
  },
  {
    id: 'general',
    niche: 'Any local business',
    description: 'A general version that works for most businesses that rely on phone calls.',
    steps: [
      {
        type: 'FIRST_EMAIL',
        name: 'General: missed calls',
        subject: 'quick question about {{companyName}}',
        body: `Hi {{firstName}},

{{personalNote}}

Quick question: what happens to calls that come into {{companyName}} when everyone's busy or after you close?

For most businesses they go to voicemail, and most people don't leave one. They call the next name on Google.

We built an AI receptionist that answers every call 24/7, answers common questions the way your team would, books appointments, and texts back anyone who hangs up.

If it's useful, I'll set up a version trained on {{companyName}} and send you a number to test it yourself. No cost, takes me a day.

Worth a look?

${SIGN}

P.S. Not the right person? Just say, and I won't follow up.`,
      },
      {
        type: 'FOLLOW_UP_1',
        name: 'General: quick bump',
        subject: '',
        body: `Hi {{firstName}}, bumping this in case it got buried.

The easiest way to judge it is to hear it. I'll have a version trained on {{companyName}} ready tomorrow for you to call. Takes about a minute.

Want me to set it up?

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_2',
        name: 'General: the missed-call maths',
        subject: '',
        body: `Hi {{firstName}},

Most businesses we look at miss 20 to 30% of their calls, mostly at lunch, evenings and weekends, which is exactly when new customers have time to ring.

If even a couple of those a month turn into customers, the receptionist pays for itself many times over.

Open to a 10-minute call to see what it would catch at {{companyName}}?

{{senderFirstName}}`,
      },
      {
        type: 'FOLLOW_UP_3',
        name: 'General: close the loop',
        subject: '',
        body: `Hi {{firstName}},

I'll leave it here so I'm not filling your inbox.

If missed calls ever become worth fixing at {{companyName}}, reply "demo" and I'll set one up for you to test.

Thanks for your time.

${SIGN}`,
      },
    ],
  },
]

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding Triven CRM…')

  // Admin user
  const password = await bcrypt.hash('Triven@2024', 12)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@triven.ai' },
    update: {},
    create: {
      email: 'admin@triven.ai',
      name: 'Admin',
      passwordHash: password,
      role: 'ADMIN',
    },
  })
  console.log('✅ Admin user:', admin.email)

  // Sender accounts (5 – placeholder until Gmail OAuth is connected)
  const senderData = [
    { displayName: 'Sender Account 1', email: 'sender1@yourdomain.com', dailyEmailTarget: 20 },
    { displayName: 'Sender Account 2', email: 'sender2@yourdomain.com', dailyEmailTarget: 25 },
    { displayName: 'Sender Account 3', email: 'sender3@yourdomain.com', dailyEmailTarget: 20 },
    { displayName: 'Sender Account 4', email: 'sender4@yourdomain.com', dailyEmailTarget: 25 },
    { displayName: 'Sender Account 5', email: 'sender5@yourdomain.com', dailyEmailTarget: 20 },
  ]

  const senders = []
  for (const s of senderData) {
    const sender = await prisma.senderAccount.upsert({
      where: { email: s.email },
      update: {},
      create: { ...s, timezone: 'America/New_York', gmailStatus: 'NOT_CONNECTED' },
    })
    senders.push(sender)
  }
  console.log('✅ Created 5 sender accounts')

  // Sample campaigns
  const campaigns = await Promise.all([
    prisma.campaign.upsert({
      where: { id: 'seed-campaign-dental' },
      update: {},
      create: {
        id: 'seed-campaign-dental',
        name: 'Dental AI Receptionist',
        industry: 'Dental',
        targetCountry: 'USA',
        product: 'AI Receptionist',
        description: 'Outreach to dental practices across the US',
        timezone: 'America/New_York',
        followUpDay1: 1,
        followUpDay2: 2,
        followUpDay3: 3,
        senderAccounts: {
          create: [
            { senderAccountId: senders[0].id },
            { senderAccountId: senders[1].id },
          ],
        },
      },
    }),
    prisma.campaign.upsert({
      where: { id: 'seed-campaign-hvac' },
      update: {},
      create: {
        id: 'seed-campaign-hvac',
        name: 'HVAC AI Receptionist',
        industry: 'HVAC',
        targetCountry: 'USA',
        product: 'AI Receptionist',
        description: 'Outreach to HVAC companies',
        timezone: 'America/Chicago',
        followUpDay1: 1,
        followUpDay2: 3,
        followUpDay3: 7,
        senderAccounts: {
          create: [
            { senderAccountId: senders[2].id },
            { senderAccountId: senders[3].id },
          ],
        },
      },
    }),
    prisma.campaign.upsert({
      where: { id: 'seed-campaign-solar' },
      update: {},
      create: {
        id: 'seed-campaign-solar',
        name: 'Solar AI Receptionist',
        industry: 'Solar',
        targetCountry: 'USA',
        product: 'AI Receptionist',
        description: 'Outreach to solar installation companies',
        timezone: 'America/Los_Angeles',
        followUpDay1: 1,
        followUpDay2: 2,
        followUpDay3: 4,
        senderAccounts: {
          create: [{ senderAccountId: senders[4].id }],
        },
      },
    }),
  ])
  console.log('✅ Created 3 sample campaigns')

  // Sample leads
  const sampleLeads = [
    {
      companyName: 'Bright Smile Family Dental',
      companyEmail: 'info@brightsmile-demo.test',
      firstName: 'Sarah',
      lastName: 'Nguyen',
      fullName: 'Sarah Nguyen',
      jobTitle: 'Practice Owner',
      website: 'brightsmile-demo.test',
      industry: 'Dental',
      state: 'Texas',
      city: 'Austin',
      country: 'USA',
      status: 'FIRST_EMAIL_SENT',
      campaignId: campaigns[0].id,
      senderAccountId: senders[0].id,
      assignedUserId: admin.id,
      personalizationNotes: 'Promotes same-day appointments. Has 3 locations in Austin.',
      companyPainPoint: 'Losing after-hours calls to competitors.',
      firstEmailSubject: 'Quick question about after-hours patient calls',
      firstEmailBody: 'Hi Sarah, I noticed Bright Smile offers same-day appointments — impressive for 3 locations…',
      firstEmailSentAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
      priority: 'HIGH',
      leadSource: 'MANUAL',
    },
    {
      companyName: 'Lone Star Air & Heat',
      companyEmail: 'contact@lonestar-demo.test',
      firstName: 'Rick',
      lastName: 'Dawson',
      fullName: 'Rick Dawson',
      jobTitle: 'Owner',
      website: 'lonestar-demo.test',
      industry: 'HVAC',
      state: 'Texas',
      city: 'Austin',
      country: 'USA',
      status: 'FOLLOW_UP_1_DUE',
      campaignId: campaigns[1].id,
      senderAccountId: senders[2].id,
      assignedUserId: admin.id,
      personalizationNotes: '4.9 stars, 312 reviews. Seasonal peak coming up.',
      firstEmailSubject: 'Handling the summer rush at Lone Star',
      firstEmailBody: 'Hi Rick, with Austin summers getting brutal, I imagine your team is swamped…',
      firstEmailSentAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // yesterday
      nextFollowUpAt: new Date(), // today
      priority: 'MEDIUM',
      leadSource: 'MANUAL',
    },
    {
      companyName: 'Desert Sun Solar',
      companyEmail: 'hello@desertsun-demo.test',
      firstName: 'Maria',
      lastName: 'Garcia',
      fullName: 'Maria Garcia',
      jobTitle: 'CEO',
      website: 'desertsun-demo.test',
      industry: 'Solar',
      state: 'Arizona',
      city: 'Phoenix',
      country: 'USA',
      status: 'REPLIED',
      hasReplied: true,
      isInterested: true,
      campaignId: campaigns[2].id,
      senderAccountId: senders[4].id,
      assignedUserId: admin.id,
      personalizationNotes: 'Expanding into commercial solar. Interested in AI for lead qualification.',
      firstEmailSubject: 'AI Receptionist for Desert Sun Solar',
      firstEmailBody: 'Hi Maria, I saw your post about expanding into commercial projects…',
      firstEmailSentAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      lastResponseAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      priority: 'HIGH',
      leadSource: 'MANUAL',
    },
  ]

  for (const leadData of sampleLeads) {
    const existing = await prisma.lead.findFirst({ where: { companyEmail: leadData.companyEmail } })
    if (!existing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await prisma.lead.create({ data: leadData as any })
    }
  }
  console.log('✅ Created 3 sample leads')

  console.log('\n🚀 Done! Login with: admin@triven.ai / Triven@2024')
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => { console.error(err); prisma.$disconnect(); process.exit(1) })

// ─────────────────────────────────────────────────────────────────────────────
// Triven CRM – Shared TypeScript Types
// ─────────────────────────────────────────────────────────────────────────────

export type LeadStatus =
  | 'NEW'
  | 'RESEARCHING'
  | 'READY_TO_CONTACT'
  | 'FIRST_EMAIL_SENT'
  | 'FOLLOW_UP_1_DUE'
  | 'FOLLOW_UP_1_SENT'
  | 'FOLLOW_UP_2_DUE'
  | 'FOLLOW_UP_2_SENT'
  | 'FOLLOW_UP_3_DUE'
  | 'FOLLOW_UP_3_SENT'
  | 'REPLIED'
  | 'INTERESTED'
  | 'DEMO_SENT'
  | 'MEETING_BOOKED'
  | 'PROPOSAL_SENT'
  | 'WON'
  | 'LOST'
  | 'NOT_INTERESTED'
  | 'UNSUBSCRIBED'
  | 'INVALID_EMAIL'
  | 'DO_NOT_CONTACT'

export type LeadPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
export type LeadSource =
  | 'MANUAL'
  | 'IMPORT'
  | 'REFERRAL'
  | 'WEBSITE'
  | 'LINKEDIN'
  | 'COLD_OUTREACH'
  | 'YOUTUBE'
  | 'OTHER'

export type ActivityType =
  | 'EMAIL_SENT'
  | 'FOLLOW_UP_SENT'
  | 'EMAIL_OPENED'
  | 'EMAIL_REPLIED'
  | 'CALL'
  | 'DEMO_SENT'
  | 'MEETING_BOOKED'
  | 'STATUS_CHANGED'
  | 'NOTE_ADDED'
  | 'TASK_CREATED'
  | 'SALE'
  | 'OTHER'

export type FollowUpTaskStatus = 'PENDING' | 'SENT' | 'SKIPPED' | 'CANCELLED'
export type FollowUpTaskType = 'FOLLOW_UP_1' | 'FOLLOW_UP_2' | 'FOLLOW_UP_3'
export type GmailStatus = 'NOT_CONNECTED' | 'CONNECTED' | 'ERROR' | 'EXPIRED'

// ─────────────────────────────────────────────────────────────────────────────
// API Response shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────

export interface DashboardStats {
  today: {
    newLeads: number
    firstEmailsDue: number
    followUpsDue: number
    replies: number
    interested: number
    demos: number
    meetings: number
    won: number
    revenue: number
    overdue: number
  }
  totals: {
    leads: number
    active: number
    replied: number
    interested: number
    won: number
    lost: number
    revenue: number
  }
  senderStats: SenderAccountStats[]
}

export interface SenderAccountStats {
  id: string
  displayName: string
  email: string
  gmailStatus: GmailStatus
  dailyEmailTarget: number
  todayNewEmails: number
  todayFollowUps: number
  todayReplies: number
  todayInterested: number
  totalLeads: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Lead
// ─────────────────────────────────────────────────────────────────────────────

export interface LeadRow {
  id: string
  firstName: string | null
  lastName: string | null
  fullName: string | null
  jobTitle: string | null
  companyName: string
  website: string | null
  companyEmail: string | null
  phone: string | null
  linkedIn: string | null
  country: string | null
  state: string | null
  city: string | null
  industry: string | null
  subIndustry: string | null
  companySize: string | null
  notes: string | null
  campaignId: string | null
  leadSource: LeadSource
  status: LeadStatus
  stage: string | null
  priority: LeadPriority
  score: number
  assignedUserId: string | null
  senderAccountId: string | null
  lastContactedAt: string | null
  nextFollowUpAt: string | null
  lastResponseAt: string | null
  personalizationNotes: string | null
  companyPainPoint: string | null
  whyThisLead: string | null
  researchSummary: string | null
  websiteNotes: string | null
  socialMediaNotes: string | null
  relevantService: string | null
  prospectingNotes: string | null
  firstEmailSubject: string | null
  firstEmailBody: string | null
  firstEmailSentAt: string | null
  followUp1Subject: string | null
  followUp1Body: string | null
  followUp1SentAt: string | null
  followUp2Subject: string | null
  followUp2Body: string | null
  followUp2SentAt: string | null
  followUp3Subject: string | null
  followUp3Body: string | null
  followUp3SentAt: string | null
  hasReplied: boolean
  isInterested: boolean
  demoSent: boolean
  demoDate: string | null
  meetingBooked: boolean
  meetingDate: string | null
  proposalSent: boolean
  hasSale: boolean
  saleDate: string | null
  dealValue: string | null
  lostReason: string | null
  prospectId?: string | null
  sourcePlatform?: string | null
  sourceChannel?: string | null
  sourceVideo?: string | null
  sourceVideoUrl?: string | null
  sourceComment?: string | null
  commentTopic?: string | null
  interestCategory?: string | null
  persona?: string | null
  createdAt: string
  updatedAt: string
  campaign?: { id: string; name: string } | null
  senderAccount?: { id: string; displayName: string; email: string } | null
  assignedUser?: { id: string; name: string } | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Import wizard
// ─────────────────────────────────────────────────────────────────────────────

export interface ImportPreview {
  importId: string
  fileName: string
  totalRows: number
  columns: string[]
  sampleRows: Record<string, string>[]
  status: string
}

export interface ImportValidationResult {
  importId: string
  totalRows: number
  validRows: number
  duplicateRows: number
  errorRows: number
  missingEmail: number
  unknownSender: number
  invalidDates: number
  preview: ImportRowPreview[]
}

export interface ImportRowPreview {
  rowNumber: number
  data: Record<string, string>
  status: string
  errorMsg: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Session
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionData {
  userId: string
  email: string
  name: string
  role: string
  isLoggedIn: boolean
}

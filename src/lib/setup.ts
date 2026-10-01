// What is configured and what isn't, with the impact of each gap (System Health + dashboard).
import prisma from './prisma'
import { getSettings } from './settings'
import { googleConfigured } from './finder/places'
import { verifierProvider } from './audience/verify'
import { searchProvider } from './audience/identity'
import { aiConfigured } from './audience/ai'
import { youtubeConfigured } from './audience/youtube'
import { finderProviders } from './audience/finders'
import { configured } from './providers/keys'

export interface SetupItem { key: string; ok: boolean; required: boolean; label: string; impact: string; href: string }

export async function setupChecklist(): Promise<SetupItem[]> {
  const [settings, inboxes] = await Promise.all([
    getSettings(),
    prisma.senderAccount.count({ where: { isActive: true, gmailStatus: 'CONNECTED' } }),
  ])
  return [
    { key: 'inbox', ok: inboxes > 0, required: true, label: 'Gmail inbox connected', impact: 'Nothing can be sent without one.', href: '/sender-accounts' },
    { key: 'address', ok: !!settings.senderAddress, required: true, label: 'Postal address in the footer', impact: 'Required by CAN-SPAM, CASL and the Spam Act. Campaigns can\'t launch without it.', href: '/settings' },
    { key: 'worker', ok: !!process.env.WORKER_SECRET, required: true, label: 'Worker secret', impact: 'The scheduler can\'t call the worker.', href: '/system' },
    { key: 'builderUrl', ok: !!settings.builderUrl, required: false, label: 'AI Builder link', impact: 'AI Builder emails fall back to "reply and I\'ll send access".', href: '/settings' },
    { key: 'verifier', ok: !!verifierProvider(), required: false, label: 'Email verifier key (Reoon, ZeroBounce…)', impact: 'Guessed addresses can\'t be confirmed: far fewer reachable people, more bounces.', href: '/system' },
    { key: 'ai', ok: aiConfigured(), required: false, label: 'Anthropic API key', impact: 'No AI use-case detection, "Why Triven" or reply sorting (rules only).', href: '/system' },
    { key: 'youtube', ok: youtubeConfigured(), required: false, label: 'YouTube API key', impact: 'No YouTube audience discovery.', href: '/system' },
    { key: 'search', ok: !!searchProvider(), required: false, label: 'Web-search key (Serper / Brave)', impact: 'No identity search or "published elsewhere" email search.', href: '/system' },
    { key: 'hunter', ok: finderProviders().length > 0, required: false, label: 'Email-finder key (Hunter, Apollo, Prospeo or Tomba)', impact: 'No email-finder fallback when a website publishes no address.', href: '/system' },
    { key: 'google', ok: googleConfigured() || configured('foursquare') || configured('tomtom'), required: false, label: 'Business-search key (Google Places, Foursquare or TomTom)', impact: 'Lead Finder uses only the free sources (NPI Registry, OpenStreetMap): fewer websites, ratings and hours.', href: '/system' },
    { key: 'calendar', ok: !!process.env.CALENDAR_WEBHOOK_SECRET, required: false, label: 'Calendar webhook', impact: 'Meetings must be marked by hand.', href: '/system' },
  ]
}

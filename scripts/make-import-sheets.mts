// Builds the official lead-import sheets served from /import/…
//   npx tsx scripts/make-import-sheets.mts
// Tab 1 of each workbook is what the importer reads; tab 2 is the field guide.
import ExcelJS from 'exceljs'
import { mkdirSync, writeFileSync } from 'fs'

const OUT = 'public/import'
mkdirSync(OUT, { recursive: true })

interface Column { header: string; required: 'Required' | 'Recommended' | 'Optional'; width: number; what: string; example: string; powers: string }

export const COLUMNS: Column[] = [
  { header: 'Company', required: 'Required', width: 30, what: 'Practice / business name', example: 'Harrison Dental', powers: 'Subject line and "{{companyName}}" everywhere. Without it the email says "your practice".' },
  { header: 'Email', required: 'Required', width: 36, what: 'One email address. Rows without one are imported but not emailed.', example: 'office@harrisondental.com', powers: 'Where the email goes. info@/office@/front@ inboxes get "Hi <Practice> team" and a pass-it-to-the-doctor line.' },
  { header: 'Contact Name', required: 'Recommended', width: 22, what: 'Person to greet. Write doctors as "Dr. First Last".', example: 'Dr. Sarah Neely', powers: 'Greeting: "Hi Dr. Neely" / "Hi Sarah".' },
  { header: 'Job Title', required: 'Optional', width: 18, what: 'Their role', example: 'Owner / Office Manager', powers: '{{jobTitle}}' },
  { header: 'Phone', required: 'Optional', width: 16, what: 'Main phone number', example: '(208) 342-3695', powers: 'Shown on the lead; handy for calling warm replies.' },
  { header: 'Website', required: 'Optional', width: 26, what: 'Website (with or without https://)', example: 'harrisondental.com', powers: 'Saved on the lead; also used to guess the company name.' },
  { header: 'City', required: 'Recommended', width: 14, what: 'City', example: 'Boise', powers: '"…going to other practices in Boise" (follow-up 2).' },
  { header: 'State', required: 'Optional', width: 8, what: 'State / province (short or full)', example: 'ID', powers: 'Saved on the lead.' },
  { header: 'Country', required: 'Optional', width: 10, what: 'Country', example: 'US', powers: 'Saved on the lead; filter and export by it.' },
  { header: 'Industry', required: 'Recommended', width: 12, what: 'Niche. Use the same word every time.', example: 'Dental', powers: 'Picks "patients" vs "customers" and the right wording.' },
  { header: 'Hours', required: 'Recommended', width: 38, what: 'Opening hours as on Google. Write closed days as "Fri-Sun CLOSED".', example: 'Mon-Thu 8-5, Fri-Sun CLOSED', powers: 'The strongest hook: subject "Harrison Dental after 5pm", "you\'re closed Friday to Sunday…", follow-up numbers.' },
  { header: 'Research', required: 'Recommended', width: 48, what: 'Anything notable, short facts separated by ";". See the list below.', example: 'Nominated Best of Boise 2026; 4.9 rating / 312 reviews; accepting new patients', powers: 'Compliment + angle in the first line: awards, "4.9 stars from 312 reviews", "opened Jan 2026", "text us" sites, promos, CDCP, emergency care, several locations, "since 1994".' },
  { header: 'Personal Note', required: 'Optional', width: 36, what: 'One full sentence written by you, used as-is.', example: 'Saw your new Invisalign page last week.', powers: '{{personalNote}} (only in templates that use it).' },
  { header: 'Priority', required: 'Optional', width: 10, what: 'Urgent / High / Medium / Low (or P0–P3)', example: 'High', powers: 'Higher priority leads are emailed first.' },
  { header: 'Notes', required: 'Optional', width: 30, what: 'Internal notes. Never used in emails.', example: 'Met at dental expo', powers: 'Only you see this.' },
]

const RESEARCH_TIPS = [
  ['Award', 'Nominated Best of Boise 2026'],
  ['Reviews', '4.9 rating / 312 reviews'],
  ['New practice', 'BRAND NEW, opened Jan 2026'],
  ['Few open days', 'Only open 4 days/week'],
  ['Phone overwhelm', '"Skip the phone call - text us" on website'],
  ['Promotions', '$50 gift card for new patients'],
  ['Canada', 'CDCP accepted'],
  ['Emergency', 'Emergency appointments'],
  ['Locations', '2 locations'],
  ['Longevity', 'Independent since 1994 / 20+ yrs'],
  ['New patients', 'Accepting new patients'],
]

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1)
  row.height = 22
  row.eachCell((cell, col) => {
    const req = COLUMNS[col - 1]?.required
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: req === 'Required' ? 'FF4F46E5' : req === 'Recommended' ? 'FF6366F1' : 'FF94A3B8' } }
    cell.alignment = { vertical: 'middle' }
    cell.note = `${req}: ${COLUMNS[col - 1]?.what ?? ''}`
  })
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

function addLeadsSheet(wb: ExcelJS.Workbook, rows: Array<Record<string, string>>) {
  const ws = wb.addWorksheet('Leads')
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.header, width: c.width }))
  for (const r of rows) ws.addRow(r)
  styleHeader(ws)
  // Priority dropdown
  for (let i = 2; i <= Math.max(rows.length + 1, 500); i++) {
    ws.getCell(`N${i}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Urgent,High,Medium,Low"'] }
  }
  return ws
}

function addGuideSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet('How to fill this in')
  ws.columns = [
    { header: 'Column', key: 'c', width: 16 },
    { header: 'Required?', key: 'r', width: 13 },
    { header: 'What to put', key: 'w', width: 52 },
    { header: 'Example', key: 'e', width: 42 },
    { header: 'What it does in the email', key: 'p', width: 70 },
  ]
  for (const c of COLUMNS) ws.addRow({ c: c.header, r: c.required, w: c.what, e: c.example, p: c.powers })
  ws.getRow(1).font = { bold: true }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } }
  ws.eachRow((row, n) => { if (n > 1) row.alignment = { wrapText: true, vertical: 'top' } })

  ws.addRow({})
  ws.addRow({ c: 'RESEARCH: phrases the system understands' }).font = { bold: true }
  for (const [what, example] of RESEARCH_TIPS) ws.addRow({ c: what, w: example })
  ws.addRow({})
  ws.addRow({ c: 'RULES' }).font = { bold: true }
  for (const rule of [
    'Keep the column names exactly as they are. Extra columns are fine (you can skip them when importing).',
    'Only Company + Email are needed to send. Every extra column makes the email more personal.',
    'One lead per row, one email per row. Duplicates (same email) are detected and skipped.',
    'Do not merge cells or add blank rows between leads. Keep this "Leads" tab first.',
    'Save as .xlsx or .csv, then go to Import, choose a campaign (niche) and import.',
  ]) ws.addRow({ w: rule })
}

// ── 1. Blank template ────────────────────────────────────────────────────────
{
  const wb = new ExcelJS.Workbook()
  addLeadsSheet(wb, [{
    Company: 'Harrison Dental', Email: 'office@harrisondental.com', 'Contact Name': 'Dr. Sarah Neely', 'Job Title': 'Owner',
    Phone: '(208) 342-3695', Website: 'harrisondental.com', City: 'Boise', State: 'ID', Country: 'US', Industry: 'Dental',
    Hours: 'Mon-Thu 8-5, Fri-Sun CLOSED', Research: 'Nominated Best of Boise 2026; 4.9 rating / 312 reviews; accepting new patients',
    'Personal Note': '', Priority: 'High', Notes: 'EXAMPLE ROW: delete before importing',
  }])
  addGuideSheet(wb)
  await wb.xlsx.writeFile(`${OUT}/Triven_Lead_Import_Template.xlsx`)
  writeFileSync(`${OUT}/Triven_Lead_Import_Template.csv`, '﻿' + COLUMNS.map((c) => c.header).join(',') + '\r\n')
}

// ── 2. Demo sheet for testing (Gmail "+" aliases all land in your own inboxes) ──
const A = 'priyanshukanojia907'
const B = 'kanojiapriyanshu18'
const demo: Array<Record<string, string>> = [
  { Company: 'Harrison Dental Studio', Email: `${A}+harrison@gmail.com`, 'Contact Name': 'Dr. Sarah Neely', 'Job Title': 'Owner', Phone: '(208) 555-0101', Website: 'harrisondentalstudio.com', City: 'Boise', State: 'ID', Country: 'US', Industry: 'Dental', Hours: 'Mon 7-4, Tue-Thu 8-5, Fri-Sun CLOSED', Research: 'Nominated Best of Boise 2026; accepting new patients', Priority: 'Urgent', Notes: 'TEST: full data + award + closed 3 days' },
  { Company: 'Bright Smile Family Dentistry', Email: `${B}+brightsmile@gmail.com`, 'Contact Name': 'Mark Ellis', 'Job Title': 'Office Manager', Phone: '(512) 555-0102', Website: 'brightsmileaustin.com', City: 'Austin', State: 'TX', Country: 'US', Industry: 'Dental', Hours: 'Mon-Thu 8-4, Fri-Sun CLOSED', Research: '4.9 rating / 312 reviews; family owned', Priority: 'High', Notes: 'TEST: first name greeting + reviews' },
  { Company: 'Ingalls Family Dental', Email: `${A}+ingalls@gmail.com`, 'Contact Name': 'Dr. Preet Kulaar', Phone: '(765) 555-0103', City: 'Pendleton', State: 'IN', Country: 'US', Industry: 'Dental', Research: 'BRAND NEW, opened Jan 2026; solo practice', Priority: 'High', Notes: 'TEST: new-practice angle' },
  { Company: 'Maplewood Dental Care', Email: `${B}+maplewood@gmail.com`, City: 'Denver', State: 'CO', Country: 'US', Industry: 'Dental', Hours: 'Mon-Fri 9-5, Sat-Sun CLOSED', Research: 'Independent since 1998', Priority: 'Medium', Notes: 'TEST: no contact name -> "Hi Maplewood Dental Care team"' },
  { Company: 'Elmwood Park Dental', Email: `${A}+elmwood@gmail.com`, City: 'Toronto', State: 'ON', Country: 'Canada', Industry: 'Dental', Research: '"Skip the phone call - text us" on website; CDCP accepted', Priority: 'Medium', Notes: 'TEST: text-us angle (Canada)' },
  { Company: 'Lakeside Dental Group', Email: `${B}+lakeside@gmail.com`, 'Contact Name': 'Dr. James Carter', City: 'Chicago', State: 'IL', Country: 'US', Industry: 'Dental', Research: '$50 gift card for new patients; 2 locations', Priority: 'Medium', Notes: 'TEST: promo angle' },
  { Company: 'Kensington Dental Clinic', Email: `${A}+kensington@gmail.com`, 'Contact Name': 'Dr. Amelia Hughes', City: 'London', Country: 'UK', Industry: 'Dental', Hours: 'Mon-Fri 9-6, Sat 9-1, Sun CLOSED', Research: 'Emergency appointments; 4.8 rating / 210 reviews', Priority: 'Low', Notes: 'TEST: UK + Sundays closed' },
  { Company: 'Riverside Smiles', Email: `${B}+riverside@gmail.com`, Industry: 'Dental', Priority: 'Low', Notes: 'TEST: thin data (company + email only)' },
  { Company: '', Email: `${A}+onlyemail@gmail.com`, Notes: 'TEST: email only, no company -> "Hi there" / "your practice"' },
  { Company: 'Oak Street Dental', Email: '', Phone: '(208) 555-0110', City: 'Boise', State: 'ID', Country: 'US', Industry: 'Dental', Notes: 'TEST: no email -> imported, never emailed' },
]
{
  const wb = new ExcelJS.Workbook()
  addLeadsSheet(wb, demo)
  addGuideSheet(wb)
  await wb.xlsx.writeFile(`${OUT}/Triven_Demo_Leads.xlsx`)
}
console.log(`Wrote ${OUT}/Triven_Lead_Import_Template.xlsx, .csv and Triven_Demo_Leads.xlsx`)

// Niches the Lead Finder knows: what to search on Google, which place types count as on-niche
// (anything else in the results is dropped), the matching OpenStreetMap tags, and which ready-made
// sequence in the library fits. Browser-safe.

export interface Niche {
  id: string
  label: string
  group: 'Health' | 'Home services' | 'Professional' | 'Local'
  /** Text sent to Google ("dentist" → "dentist in Austin TX") */
  query: string
  /** Google place types that count as this niche (any match keeps the result) */
  types: string[]
  /** Name words that also count (Google types are often just "health") */
  nameHint?: RegExp
  /** OpenStreetMap tag filters, e.g. ['amenity=dentist', 'healthcare=dentist'] */
  osm: string[]
  /** Sequence id in the library (lib/sequence-library.ts) */
  sequence: 'dental' | 'medspa' | 'home_services' | 'sales_teams' | 'general'
  /** How much a missed call costs this kind of business: drives the fit score (1-3) */
  callValue: 1 | 2 | 3
  /** Role inboxes worth guessing when nothing is published (verified before use) */
  roleGuesses: string[]
}

const CLINIC_ROLES = ['info', 'office', 'frontdesk', 'reception', 'appointments', 'contact', 'hello']
const TRADE_ROLES = ['info', 'office', 'service', 'contact', 'hello', 'admin']
const PRO_ROLES = ['info', 'office', 'contact', 'hello', 'admin']

export const NICHES: Niche[] = [
  { id: 'dental', label: 'Dentists', group: 'Health', query: 'dentist', types: ['dentist', 'dental_clinic'], nameHint: /dent|smile|orthodon|teeth|oral/i, osm: ['amenity=dentist', 'healthcare=dentist'], sequence: 'dental', callValue: 3, roleGuesses: CLINIC_ROLES },
  { id: 'orthodontist', label: 'Orthodontists', group: 'Health', query: 'orthodontist', types: ['dentist', 'dental_clinic'], nameHint: /orthodon|braces|smile/i, osm: ['healthcare:speciality=orthodontics'], sequence: 'dental', callValue: 3, roleGuesses: CLINIC_ROLES },
  { id: 'medspa', label: 'Med spas', group: 'Health', query: 'med spa', types: ['spa', 'beauty_salon', 'skin_care_clinic', 'wellness_center', 'medical_clinic'], nameHint: /med ?spa|aesthetic|botox|laser|skin|injectables|rejuvenat/i, osm: ['beauty=medical', 'shop=beauty][beauty=skin_care', 'leisure=spa'], sequence: 'medspa', callValue: 3, roleGuesses: CLINIC_ROLES },
  { id: 'chiropractor', label: 'Chiropractors', group: 'Health', query: 'chiropractor', types: ['chiropractor'], nameHint: /chiro|spine|back/i, osm: ['healthcare=chiropractor', 'healthcare:speciality=chiropractic'], sequence: 'medspa', callValue: 2, roleGuesses: CLINIC_ROLES },
  { id: 'physio', label: 'Physical therapy', group: 'Health', query: 'physical therapy clinic', types: ['physiotherapist'], nameHint: /physio|physical therap|rehab|sports med/i, osm: ['healthcare=physiotherapist'], sequence: 'medspa', callValue: 2, roleGuesses: CLINIC_ROLES },
  { id: 'vet', label: 'Veterinary clinics', group: 'Health', query: 'veterinarian', types: ['veterinary_care'], nameHint: /vet|animal|pet/i, osm: ['amenity=veterinary'], sequence: 'medspa', callValue: 2, roleGuesses: CLINIC_ROLES },
  { id: 'dermatology', label: 'Dermatology', group: 'Health', query: 'dermatologist', types: ['doctor', 'skin_care_clinic', 'medical_clinic'], nameHint: /derm|skin/i, osm: ['healthcare:speciality=dermatology'], sequence: 'medspa', callValue: 3, roleGuesses: CLINIC_ROLES },
  { id: 'optometrist', label: 'Optometrists', group: 'Health', query: 'optometrist', types: ['optometrist', 'doctor'], nameHint: /optom|eye|vision|optical/i, osm: ['healthcare=optometrist', 'shop=optician'], sequence: 'medspa', callValue: 2, roleGuesses: CLINIC_ROLES },

  { id: 'plumber', label: 'Plumbers', group: 'Home services', query: 'plumber', types: ['plumber'], nameHint: /plumb|rooter|drain/i, osm: ['craft=plumber'], sequence: 'home_services', callValue: 3, roleGuesses: TRADE_ROLES },
  { id: 'hvac', label: 'HVAC', group: 'Home services', query: 'HVAC contractor', types: ['hvac_contractor', 'general_contractor'], nameHint: /hvac|heating|cooling|air|furnace/i, osm: ['craft=hvac'], sequence: 'home_services', callValue: 3, roleGuesses: TRADE_ROLES },
  { id: 'electrician', label: 'Electricians', group: 'Home services', query: 'electrician', types: ['electrician'], nameHint: /electri/i, osm: ['craft=electrician'], sequence: 'home_services', callValue: 3, roleGuesses: TRADE_ROLES },
  { id: 'roofing', label: 'Roofers', group: 'Home services', query: 'roofing contractor', types: ['roofing_contractor', 'general_contractor'], nameHint: /roof/i, osm: ['craft=roofer'], sequence: 'home_services', callValue: 3, roleGuesses: TRADE_ROLES },
  { id: 'pest', label: 'Pest control', group: 'Home services', query: 'pest control', types: ['pest_control_service'], nameHint: /pest|termite|exterminat/i, osm: ['craft=pest_control'], sequence: 'home_services', callValue: 2, roleGuesses: TRADE_ROLES },
  { id: 'cleaning', label: 'Cleaning services', group: 'Home services', query: 'house cleaning service', types: ['house_cleaning_service', 'cleaning_service'], nameHint: /clean|maid/i, osm: ['craft=cleaning', 'shop=dry_cleaning'], sequence: 'home_services', callValue: 2, roleGuesses: TRADE_ROLES },
  { id: 'landscaping', label: 'Landscaping', group: 'Home services', query: 'landscaping company', types: ['landscaper', 'lawn_care_service'], nameHint: /landscap|lawn|garden|tree/i, osm: ['craft=gardener'], sequence: 'home_services', callValue: 1, roleGuesses: TRADE_ROLES },
  { id: 'garage_door', label: 'Garage door repair', group: 'Home services', query: 'garage door repair', types: ['general_contractor'], nameHint: /garage|door/i, osm: ['craft=door_construction'], sequence: 'home_services', callValue: 2, roleGuesses: TRADE_ROLES },
  { id: 'auto_repair', label: 'Auto repair', group: 'Local', query: 'auto repair shop', types: ['car_repair'], nameHint: /auto|car|motor|tire|brake|mechanic/i, osm: ['shop=car_repair'], sequence: 'home_services', callValue: 2, roleGuesses: TRADE_ROLES },

  { id: 'law_pi', label: 'Law firms (injury)', group: 'Professional', query: 'personal injury lawyer', types: ['lawyer', 'legal_services'], nameHint: /law|legal|attorney|injury/i, osm: ['office=lawyer'], sequence: 'sales_teams', callValue: 3, roleGuesses: PRO_ROLES },
  { id: 'law_family', label: 'Law firms (family)', group: 'Professional', query: 'family law attorney', types: ['lawyer', 'legal_services'], nameHint: /law|legal|attorney|family/i, osm: ['office=lawyer'], sequence: 'sales_teams', callValue: 3, roleGuesses: PRO_ROLES },
  { id: 'real_estate', label: 'Real estate agencies', group: 'Professional', query: 'real estate agency', types: ['real_estate_agency'], nameHint: /realt|real estate|homes|properties/i, osm: ['office=estate_agent'], sequence: 'sales_teams', callValue: 2, roleGuesses: PRO_ROLES },
  { id: 'property_mgmt', label: 'Property management', group: 'Professional', query: 'property management company', types: ['real_estate_agency', 'property_management_company'], nameHint: /property|management|rentals/i, osm: ['office=property_management'], sequence: 'general', callValue: 2, roleGuesses: PRO_ROLES },
  { id: 'insurance', label: 'Insurance agencies', group: 'Professional', query: 'insurance agency', types: ['insurance_agency'], nameHint: /insur/i, osm: ['office=insurance'], sequence: 'sales_teams', callValue: 2, roleGuesses: PRO_ROLES },
  { id: 'accounting', label: 'Accountants & tax', group: 'Professional', query: 'accounting firm', types: ['accounting'], nameHint: /account|cpa|tax|bookkeep/i, osm: ['office=accountant', 'office=tax_advisor'], sequence: 'general', callValue: 1, roleGuesses: PRO_ROLES },

  { id: 'salon', label: 'Hair & beauty salons', group: 'Local', query: 'hair salon', types: ['hair_salon', 'beauty_salon', 'barber_shop'], nameHint: /salon|hair|barber|beauty|nail/i, osm: ['shop=hairdresser', 'shop=beauty'], sequence: 'medspa', callValue: 1, roleGuesses: CLINIC_ROLES },
  { id: 'gym', label: 'Gyms & studios', group: 'Local', query: 'fitness studio', types: ['gym', 'fitness_center', 'yoga_studio'], nameHint: /fit|gym|yoga|pilates|crossfit|studio/i, osm: ['leisure=fitness_centre'], sequence: 'general', callValue: 1, roleGuesses: PRO_ROLES },
  { id: 'restaurant', label: 'Restaurants (bookings)', group: 'Local', query: 'restaurant', types: ['restaurant'], nameHint: /./, osm: ['amenity=restaurant'], sequence: 'general', callValue: 1, roleGuesses: PRO_ROLES },
]

export const NICHE_BY_ID = new Map(NICHES.map((n) => [n.id, n]))

export function nicheOf(id?: string | null) {
  return id ? NICHE_BY_ID.get(id) || null : null
}

/** Franchises and chains: the local manager can't buy, and head office isn't reached this way */
export const CHAIN_NAMES = /\b(aspen dental|western dental|bright now|coast dental|heartland dental|pacific dental|smile brands|monarch dental|castle dental|gentle dental|perfect teeth|ideal dental|kool smiles|dental works|clear choice|clearchoice|affordable dentures|comfort dental|great expressions|mydentist|bupa dental|portman dental|smile direct|roto.?rooter|mr\.? rooter|benjamin franklin plumbing|one hour heating|ars.?rescue rooter|aire serv|mister sparky|mr\.? electric|terminix|orkin|rentokil|truly nolen|molly maid|merry maids|the maids|servpro|servicemaster|stanley steemer|jiffy lube|midas|firestone|pep boys|meineke|valvoline|goodyear|mavis|ntb|great clips|supercuts|sport clips|fantastic sams|regis|european wax|drybar|massage envy|hand ?& ?stone|elements massage|ideal image|laseraway|skin laundry|banfield|vca|bluepearl|petsmart|petco|planet fitness|la fitness|anytime fitness|orangetheory|24 hour fitness|gold'?s gym|snap fitness|state farm|allstate|farmers insurance|nationwide|geico|progressive|liberty mutual|keller williams|re\/?max|coldwell banker|century 21|berkshire hathaway|compass|exp realty|sotheby|h&r block|jackson hewitt|liberty tax|the joint chiropractic|athletico|ati physical|select physical|u\.?s\.? physiotherapy|novacare|pearle vision|lenscrafters|visionworks|america'?s best|walmart|costco|target|cvs|walgreens|mcdonald|starbucks|subway)\b/i

/** One-click location lists (a Google search returns at most 60 places, so big areas go city by city) */
export const LOCATION_PRESETS: Array<{ label: string; country: string; locations: string[] }> = [
  { label: 'Top US metros', country: 'US', locations: ['New York NY', 'Los Angeles CA', 'Chicago IL', 'Houston TX', 'Phoenix AZ', 'Philadelphia PA', 'San Antonio TX', 'San Diego CA', 'Dallas TX', 'Austin TX', 'Jacksonville FL', 'Columbus OH', 'Charlotte NC', 'Indianapolis IN', 'Seattle WA', 'Denver CO', 'Nashville TN', 'Atlanta GA', 'Miami FL', 'Tampa FL'] },
  { label: 'Texas', country: 'US', locations: ['Austin TX', 'Dallas TX', 'Houston TX', 'San Antonio TX', 'Fort Worth TX', 'Plano TX', 'Frisco TX', 'Round Rock TX', 'Cedar Park TX', 'Sugar Land TX', 'The Woodlands TX', 'Katy TX', 'McKinney TX', 'Arlington TX', 'El Paso TX'] },
  { label: 'Florida', country: 'US', locations: ['Miami FL', 'Tampa FL', 'Orlando FL', 'Jacksonville FL', 'Fort Lauderdale FL', 'St. Petersburg FL', 'Sarasota FL', 'Naples FL', 'Boca Raton FL', 'Tallahassee FL'] },
  { label: 'California', country: 'US', locations: ['Los Angeles CA', 'San Diego CA', 'San Jose CA', 'San Francisco CA', 'Sacramento CA', 'Fresno CA', 'Irvine CA', 'Long Beach CA', 'Oakland CA', 'Santa Monica CA'] },
  { label: 'Canada', country: 'CA', locations: ['Toronto ON', 'Vancouver BC', 'Calgary AB', 'Edmonton AB', 'Ottawa ON', 'Mississauga ON', 'Winnipeg MB', 'Hamilton ON', 'Surrey BC', 'Halifax NS'] },
  { label: 'UK', country: 'GB', locations: ['London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow', 'Bristol', 'Liverpool', 'Edinburgh', 'Sheffield', 'Nottingham'] },
  { label: 'Australia', country: 'AU', locations: ['Sydney NSW', 'Melbourne VIC', 'Brisbane QLD', 'Perth WA', 'Adelaide SA', 'Gold Coast QLD', 'Canberra ACT', 'Newcastle NSW'] },
]

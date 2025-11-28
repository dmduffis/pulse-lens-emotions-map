// =====================
// COUNTRY CODE MAP
// =====================
// Maps country names to their 2-letter ISO codes
// Used for NewsAPI and other country-based APIs

export const countryCodeMap: Record<string, string> = {
  // United States
  "united states": "us",
  "usa": "us",
  "us": "us",
  "america": "us",
  "new york": "us",
  "los angeles": "us",
  "chicago": "us",
  "houston": "us",
  "miami": "us",
  "california": "us",
  "texas": "us",
  "florida": "us",
  "new york": "us",
  
  // Other countries
  "canada": "ca",
  "united kingdom": "gb",
  "uk": "gb",
  "england": "gb",
  "london": "gb",
  "france": "fr",
  "paris": "fr",
  "germany": "de",
  "japan": "jp",
  "tokyo": "jp",
  "brazil": "br",
  "brasil": "br",
  "india": "in",
  "nigeria": "ng",
  "south africa": "za",
  "mexico": "mx",
  "haiti": "ht",
  "netherlands": "nl",
  "holland": "nl",
  "australia": "as", // GDELT uses "AS" for Australia
  "austria": "au", // GDELT uses "AU" for Austria
  "china": "ch",
  "russia": "rs",
  "spain": "sp",
  "italy": "it",
  "sweden": "sw",
  "norway": "no",
  "denmark": "da", // GDELT uses "DA" for Denmark
  "finland": "fi",
  "ireland": "ei", // GDELT uses "EI" for Ireland
  "new zealand": "nz",
  "argentina": "ar",
  "colombia": "co",
  "egypt": "eg",
  "saudi arabia": "sa",
  "united arab emirates": "ae",
  "turkey": "tu", // GDELT uses "TU" for Turkey
  "indonesia": "id",
  "philippines": "rp", // GDELT uses "RP" for Philippines
  "thailand": "th",
  "vietnam": "vm", // GDELT uses "VM" for Vietnam
  "south korea": "ks", // GDELT uses "KS" for South Korea
  "pakistan": "pk",
  "bangladesh": "bg", // GDELT uses "BG" for Bangladesh
  "iran": "ir",
  "israel": "is",
  "greece": "gr",
  "poland": "pl",
  "switzerland": "sz", // GDELT uses "SZ" for Switzerland
  "belgium": "be",
  "lebanon": "le",
  
  // Default
  "default": "us",
};

/**
 * Get country code from country name
 * @param countryName - Country name (case-insensitive)
 * @returns 2-letter country code or "us" as default
 */
export function getCountryCode(countryName: string): string {
  const normalized = countryName.toLowerCase().trim();
  return countryCodeMap[normalized] || countryCodeMap["default"];
}

/**
 * Map country codes to full country names for GDELT API
 * GDELT's sourcecountry parameter expects full country names like "United States"
 */
/**
 * Map country codes to full country names for GDELT API
 * GDELT's sourcecountry parameter expects full country names like "United States"
 * Note: Uses standard ISO codes where possible, but GDELT has some unique codes
 */
export const countryNameMap: Record<string, string> = {
  "us": "United States",
  "ca": "Canada",
  "gb": "United Kingdom",
  "uk": "United Kingdom", // Alternative
  "fr": "France",
  "de": "Germany",
  "gm": "Germany", // GDELT code
  "jp": "Japan",
  "ja": "Japan", // GDELT code
  "br": "Brazil",
  "in": "India",
  "ng": "Nigeria",
  "za": "South Africa",
  "sf": "South Africa", // GDELT code
  "mx": "Mexico",
  "ht": "Haiti",
  "ha": "Haiti", // GDELT code
  "nl": "Netherlands",
  "as": "Australia", // GDELT uses "AS" for Australia
  "au": "Austria", // GDELT uses "AU" for Austria
  "ch": "China",
  "rs": "Russia",
  "sp": "Spain",
  "it": "Italy",
  "sw": "Sweden",
  "no": "Norway",
  "da": "Denmark", // GDELT uses "DA" for Denmark
  "fi": "Finland",
  "ei": "Ireland", // GDELT uses "EI" for Ireland
  "nz": "New Zealand",
  "ar": "Argentina",
  "co": "Colombia",
  "eg": "Egypt",
  "sa": "Saudi Arabia",
  "ae": "United Arab Emirates",
  "tu": "Turkey", // GDELT uses "TU" for Turkey
  "id": "Indonesia",
  "rp": "Philippines", // GDELT uses "RP" for Philippines
  "th": "Thailand",
  "vm": "Vietnam", // GDELT uses "VM" for Vietnam
  "ks": "South Korea", // GDELT uses "KS" for South Korea
  "pk": "Pakistan",
  "bg": "Bangladesh", // GDELT uses "BG" for Bangladesh
  "ir": "Iran",
  "is": "Israel",
  "gr": "Greece",
  "pl": "Poland",
  "sz": "Switzerland", // GDELT uses "SZ" for Switzerland
  "be": "Belgium",
  "le": "Lebanon",
};

/**
 * Get full country name from country code or region name
 * @param region - Region name (could be country name, city name, or country code)
 * @returns Full country name for GDELT API, or undefined if not found
 */
export function getCountryNameForGdelt(region: string): string | undefined {
  const normalized = region.toLowerCase().trim();
  
  // First check if it's already a country code
  if (countryNameMap[normalized]) {
    return countryNameMap[normalized];
  }
  
  // Check if it's in the country code map (city/region -> country code)
  const countryCode = countryCodeMap[normalized];
  if (countryCode && countryNameMap[countryCode]) {
    return countryNameMap[countryCode];
  }
  
  // Check if it's already a full country name (capitalize properly)
  const countryNames = Object.values(countryNameMap);
  const match = countryNames.find(name => name.toLowerCase() === normalized);
  if (match) {
    return match;
  }
  
  return undefined;
}


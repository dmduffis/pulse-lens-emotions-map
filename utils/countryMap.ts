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


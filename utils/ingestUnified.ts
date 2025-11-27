// =====================
// UNIFIED INGESTION MODULE
// =====================
// Collects posts/events from multiple sources:
// - NewsAPI (country-level)
// - GDELT (geo-coded)
// - Optional region filtering
// Returns normalized Post objects

import { fetchNewsForCountry } from "./newsApiClient";
import { fetchGdeltEvents } from "./gdeltClient";
import { countryCodeMap } from "./countryMap";
import { filterByRegion } from "./regionFilter";

// Unified Post interface (compatible with regionFilter)
export interface UnifiedPost {
  text: string;
  createdAt: string; // ISO string
  source: 'newsapi' | 'gdelt';
  uri: string;
  cid: string;
  lat: number | null;
  lon: number | null;
  region?: string;
  tone?: number; // GDELT sentiment score
}

/**
 * Unified ingestion function that collects posts from multiple sources
 * @param region - Region name (e.g., "United States", "New York", "France")
 * @returns Array of normalized post objects
 */
export async function ingestUnified(region?: string): Promise<UnifiedPost[]> {
  // ------------------------------
  // 1. DETERMINE COUNTRY CODE
  // ------------------------------
  const normalizedRegion = (region || "").toLowerCase().trim();
  const countryCode = countryCodeMap[normalizedRegion] || countryCodeMap["default"];

  // ------------------------------
  // 2. NEWSAPI POSTS (country-level)
  // ------------------------------
  const newsPosts = await fetchNewsForCountry(countryCode, 20).catch(err => {
    console.warn('[Ingest] NewsAPI error:', err);
    return [];
  });

  // ------------------------------
  // 3. GDELT EVENTS (geo-coded)
  // ------------------------------
  const gdeltPosts = await fetchGdeltEvents(100).catch(err => {
    console.warn('[Ingest] GDELT error:', err);
    return [];
  });

  // ------------------------------
  // MERGE SOURCES (normalize to UnifiedPost format)
  // ------------------------------
  const newsPostsNormalized: UnifiedPost[] = newsPosts.map((post, index) => ({
    text: post.text,
    createdAt: new Date(post.createdAt).toISOString(),
    source: 'newsapi' as const,
    uri: post.url || `newsapi-${index}`,
    cid: `newsapi-${index}`,
    lat: null,
    lon: null,
    region: post.region,
  }));

  const gdeltPostsNormalized: UnifiedPost[] = gdeltPosts.map((post, index) => ({
    text: post.text,
    createdAt: new Date(post.createdAt).toISOString(),
    source: 'gdelt' as const,
    uri: post.url || `gdelt-${index}`,
    cid: `gdelt-${index}`,
    lat: post.coordinates ? post.coordinates[1] : null, // lat is second in [lng, lat]
    lon: post.coordinates ? post.coordinates[0] : null, // lng is first
    region: post.region,
    tone: post.tone,
  }));

  let all: UnifiedPost[] = [...newsPostsNormalized, ...gdeltPostsNormalized];

  // ------------------------------
  // REGION FILTERING (text-based)
  // ------------------------------
  if (region) {
    // filterByRegion expects posts with text property, which UnifiedPost has
    // Cast to any to work with existing filterByRegion function
    all = filterByRegion(all as any, region) as UnifiedPost[];
  }

  return all;
}


// =====================
// REGION FILTER
// =====================
// Enables region-based filtering for Bluesky Firehose posts.
// When user scans a region, returns ONLY posts that reference that region
// (keywords, hashtags, cities, landmarks).
// 
// Uses multiple approaches:
// 1. Keyword matching (fast, exact matches)
// 2. NLP location extraction (slower, but finds implicit location mentions)

import type { BlueskyPost } from './blueskyClient';
import { extractLocationsBatch } from './extractLocations';

// =====================
// STEP 1 — KEYWORD MAP
// =====================
export const RegionKeywords: Record<string, string[]> = {
  "new york": [
    "new york", "newyork", "manhattan", "brooklyn", "queens", "bronx",
    "staten island", "harlem", "times square", "empire state", "central park",
    "#nyc", "#newyork", "#manhattan", "#brooklyn"
  ],
  "los angeles": [
    "los angeles", "losangeles", "hollywood", "santa monica", "venice beach",
    "beverly hills", "malibu", "downtown la", "dtla", "la county",
    "#la", "#losangeles", "#hollywood"
  ],
  "miami": [
    "miami", "miami beach", "south beach", "dade county", "miami dade",
    "#miami", "#miamibeach"
  ],
  "chicago": [
    "chicago", "chitown", "windy city", "loop", "magnificent mile",
    "#chicago", "#chitown"
  ],
  "houston": [
    "houston", "htown", "space city", "bayou city",
    "#houston", "#htown"
  ],
  "london": [
    "london", "greater london", "westminster", "camden", "greenwich",
    "#london", "#uk"
  ],
  "paris": [
    "paris", "paris france", "eiffel tower", "champs elysees",
    "#paris"
  ],
  "tokyo": [
    "tokyo", "tokyo japan", "shibuya", "shinjuku", "harajuku",
    "#tokyo", "#japan"
  ],
  "toronto": [
    "toronto", "toronto ontario", "downtown toronto", "yonge street",
    "#toronto", "#canada"
  ],
  "brazil": [
    "brazil", "brasil", "rio de janeiro", "são paulo", "sao paulo",
    "rio", "brazilian", "#brazil", "#brasil", "#rio"
  ],
  "haiti": [
    "haiti", "haitian", "port-au-prince", "port au prince",
    "#haiti"
  ],
  "beirut": [
    "beirut", "beyrouth", "beirut lebanon", "lebanon",
    "#beirut", "#lebanon"
  ],
  "ohio": [
    "ohio", "oh", "columbus ohio", "cleveland", "cincinnati",
    "#ohio"
  ],

  // fallback
  "default": []
};

// =====================
// STEP 2 — NORMALIZE TEXT
// =====================
/**
 * Normalize text for comparison (lowercase, remove special chars)
 */
function normalize(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9# ]/g, "");
}

// =====================
// STEP 3 — EXTRACT MAIN REGION NAME
// =====================
/**
 * Extract main region/city name from full geocoded string
 * Examples:
 *   "Queens, New York, United States" -> "new york"
 *   "Manhattan, New York, NY" -> "new york"
 *   "Los Angeles, CA" -> "los angeles"
 *   "New York, New York, United States" -> "new york"
 */
export function extractMainRegion(fullRegion: string): string {
  const lower = fullRegion.toLowerCase();
  
  // Check for known major cities in the string
  for (const [key] of Object.entries(RegionKeywords)) {
    if (key === "default") continue;
    
    // Check if the region key appears in the full string
    if (lower.includes(key)) {
      return key;
    }
  }
  
  // If no match, try to extract first significant word/phrase
  // Remove common suffixes like ", United States", ", NY", etc.
  const cleaned = lower
    .replace(/,?\s*(united states|usa|us)$/i, '')
    .replace(/,?\s*[a-z]{2}$/i, '') // Remove state codes
    .split(',')[0] // Take first part before comma
    .trim();
  
  return cleaned;
}

// =====================
// STEP 4 — REGION FILTER FUNCTION
// =====================
/**
 * Filter posts by region keywords (fast keyword-based matching)
 * @param posts - Array of Bluesky posts
 * @param region - Region name to filter by (can be full address like "Queens, New York, United States")
 * @returns Filtered array of posts that match the region
 */
export function filterByRegion(posts: BlueskyPost[], region: string): BlueskyPost[] {
  console.log(`[RegionFilter] Filtering ${posts.length} posts for region: "${region}"`);
  
  // Extract main region name from full geocoded string
  const mainRegion = extractMainRegion(region);
  console.log(`[RegionFilter] Extracted main region: "${mainRegion}"`);
  
  const regionKeys = RegionKeywords[mainRegion] || RegionKeywords["default"];
  console.log(`[RegionFilter] Found ${regionKeys.length} keywords for region "${mainRegion}"`);

  if (regionKeys.length === 0) {
    // Fallback: if unknown region, extract the main city/region name
    // and use word boundary matching to avoid false positives
    const mainRegionName = extractMainRegion(region);
    const normalizedMainRegion = normalize(mainRegionName);
    
    console.log(`[RegionFilter] Using fallback matching for "${normalizedMainRegion}"`);
    
    // Only use fallback if we have a meaningful region name (at least 3 chars)
    if (normalizedMainRegion.length >= 3) {
      // Use word boundary matching to ensure we match the full region name
      // This prevents "ohio" from matching "ohio state" or partial matches
      const escapedRegion = normalizedMainRegion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regionRegex = new RegExp(`\\b${escapedRegion}\\b`, 'i');
      
      const filtered = posts.filter((post) => {
        const text = normalize(post.text || "");
        const matches = regionRegex.test(text);
        if (matches) {
          console.log(`[RegionFilter] Match found: "${text.substring(0, 50)}..."`);
        }
        return matches;
      });
      
      console.log(`[RegionFilter] Fallback filter: ${filtered.length} posts matched out of ${posts.length}`);
      return filtered;
    }
    
    // If we can't extract a meaningful region name, return empty array
    // This is stricter than before - we don't want to show unrelated posts
    console.warn(`[RegionFilter] Unknown region "${region}" (normalized: "${normalizedMainRegion}") - no posts will match`);
    return [];
  }

  // Normalize region keys for comparison
  const normalizedKeys = regionKeys.map(key => normalize(key));

  const filtered = posts.filter((post) => {
    const postText = post.text || "";
    const text = normalize(postText);
    
    // Debug: log first post to see what we're matching against
    if (posts.indexOf(post) === 0) {
      console.log(`[RegionFilter] Sample post text (normalized): "${text.substring(0, 100)}..."`);
      console.log(`[RegionFilter] Sample keywords to match: ${normalizedKeys.slice(0, 5).join(', ')}`);
    }
    
    // Check each keyword with word boundary matching for better accuracy
    const matches = normalizedKeys.some((key) => {
      // Skip hashtags in word boundary check (they're already isolated)
      if (key.startsWith('#')) {
        const found = text.includes(key);
        if (found && posts.indexOf(post) === 0) {
          console.log(`[RegionFilter] Matched hashtag keyword: "${key}"`);
        }
        return found;
      }
      
      // For short keywords (1-3 chars), require word boundaries to avoid false matches
      // Examples: "rio" in "prior", "uk" in "duke", "ny" in "any"
      if (key.length <= 3) {
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wordBoundaryRegex = new RegExp(`\\b${escapedKey}\\b`, 'i');
        const found = wordBoundaryRegex.test(text);
        if (found && posts.indexOf(post) === 0) {
          console.log(`[RegionFilter] Matched short keyword: "${key}"`);
        }
        return found;
      } else if (key.includes(' ')) {
        // Multi-word phrases - match as phrase (e.g., "new york", "los angeles")
        // For multi-word phrases, we need to match the phrase but word boundaries might not work
        // because "new york" should match "new york city" or "in new york"
        // So we'll use a simpler approach: check if the phrase appears in the text
        const found = text.includes(key);
        if (found && posts.indexOf(post) === 0) {
          console.log(`[RegionFilter] Matched phrase keyword: "${key}"`);
        }
        return found;
      } else {
        // Longer single words - use word boundaries for better accuracy
        // This prevents matches like "chicago" in "chicagoland" (though that might be okay)
        // But prevents "rio" matching in "prior" or "uk" in "duke"
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wordBoundaryRegex = new RegExp(`\\b${escapedKey}\\b`, 'i');
        const found = wordBoundaryRegex.test(text);
        if (found && posts.indexOf(post) === 0) {
          console.log(`[RegionFilter] Matched single word keyword: "${key}"`);
        }
        return found;
      }
    });
    
    return matches;
  });
  
  console.log(`[RegionFilter] Keyword filter: ${filtered.length} posts matched out of ${posts.length}`);
  return filtered;
}

/**
 * Filter posts by region using combined approach:
 * 1. Keyword matching (fast)
 * 2. NLP location extraction (slower, but more accurate)
 * @param posts - Array of Bluesky posts
 * @param region - Region name to filter by
 * @param useNLP - Whether to use NLP location extraction (default: false for performance)
 * @returns Filtered array of posts that match the region
 */
export async function filterByRegionCombined(
  posts: BlueskyPost[], 
  region: string,
  useNLP: boolean = false
): Promise<BlueskyPost[]> {
  // Step 1: Fast keyword matching
  const keywordMatches = filterByRegion(posts, region);
  
  // If we have enough matches or NLP is disabled, return keyword matches
  if (keywordMatches.length >= 20 || !useNLP) {
    return keywordMatches;
  }
  
  // Step 2: Use NLP to extract locations from posts that didn't match keywords
  const nonMatches = posts.filter(p => !keywordMatches.some(km => km.uri === p.uri));
  
  if (nonMatches.length === 0) {
    return keywordMatches;
  }
  
  console.log(`[RegionFilter] Using NLP to extract locations from ${nonMatches.length} posts...`);
  
  // Extract locations from non-matching posts
  const locationMap = await extractLocationsBatch(nonMatches.slice(0, 50)); // Limit to 50 for performance
  
  // Extract main region name for comparison
  const mainRegion = extractMainRegion(region);
  const regionLower = mainRegion.toLowerCase();
  
  // Check if extracted locations match the region
  const nlpMatches = nonMatches.filter(post => {
    const extractedLocations = locationMap.get(post.uri) || [];
    return extractedLocations.some(loc => {
      // Check if extracted location contains region name or vice versa
      return loc.includes(regionLower) || regionLower.includes(loc);
    });
  });
  
  console.log(`[RegionFilter] NLP found ${nlpMatches.length} additional matches`);
  
  // Combine keyword matches with NLP matches
  return [...keywordMatches, ...nlpMatches];
}


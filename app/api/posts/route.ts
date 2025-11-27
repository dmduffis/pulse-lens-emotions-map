import { NextRequest, NextResponse } from 'next/server';
import { classifyEmotionsBatch, generateEmotionsSummary, EmotionResult } from '../../utils/classifyEmotion';
import { fetchNewsForCountry } from '@/utils/newsApiClient';
import { fetchGdeltEvents } from '@/utils/gdeltClient';
import { getCountryCode, countryCodeMap } from '@/utils/countryMap';
import { formatMapData } from '@/utils/formatMapData';
import type { GeoJSON } from 'geojson';

// Helper to extract country code from region name
function extractCountryFromRegion(region: string): string {
  const lower = region.toLowerCase();
  // Check if region contains a country name
  for (const [countryName, code] of Object.entries(countryCodeMap)) {
    if (countryName === "default") continue;
    if (lower.includes(countryName)) {
      return code;
    }
  }
  // If no match, use getCountryCode helper
  return getCountryCode(region);
}

// =====================
// TYPES
// =====================
interface PostWithEmotion {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
  emotion: EmotionResult;
  source: string;
  uri: string;
  cid: string;
}

interface ResponseData {
  region: string;
  coordinates: { lat: number; lon: number };
  geoJson: GeoJSON.FeatureCollection;
  emotionsSummary: Record<string, number>;
  topPosts: Array<{ text: string; emotion: string }>;
  posts: PostWithEmotion[];
}

interface CacheEntry {
  timestamp: number;
  data: ResponseData;
}

const cache: Record<string, CacheEntry> = {};
const CACHE_TTL = 60 * 1000; // 60 seconds in milliseconds

// =====================
// HELPER: GET REGION COORDINATES
// =====================
async function getRegionCoordinates(region: string): Promise<{ lat: number; lon: number }> {
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  
  if (!mapboxToken) {
    throw new Error('NEXT_PUBLIC_MAPBOX_TOKEN is not configured');
  }

  const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(region)}.json?access_token=${mapboxToken}`;
  
  const geocodeResponse = await fetch(geocodeUrl);
  
  if (!geocodeResponse.ok) {
    throw new Error('Failed to geocode region');
  }

  const geocodeData = await geocodeResponse.json();
  
  if (!geocodeData.features || geocodeData.features.length === 0) {
    throw new Error(`Region "${region}" not found`);
  }

  // Extract coordinates from Mapbox response
  const [longitude, latitude] = geocodeData.features[0].center;
  return { lat: latitude, lon: longitude };
}

// =====================
// MAIN POST HANDLER
// =====================
export async function POST(request: NextRequest) {
  try {
    // =====================
    // STEP 1 — INPUT VALIDATION
    // =====================
    const body = await request.json();
    const { region } = body;

    // Region is optional - if empty, use global posts
    const regionQuery = region && typeof region === 'string' ? region.trim() : '';

    // =====================
    // CHECK CACHE (region-specific, with timestamp for freshness)
    // =====================
    // Use region name + a time window for cache key to ensure some variety
    // Cache is region-specific but refreshes more frequently
    const cacheKey = regionQuery ? `region:${regionQuery.toLowerCase().trim()}` : 'global';
    const cachedEntry = cache[cacheKey];
    
    if (cachedEntry) {
      const age = Date.now() - cachedEntry.timestamp;
      // Reduce cache TTL to 30 seconds for more variety
      if (age < 30000) { // 30 seconds instead of 60
        console.log(`Cache hit for region: ${cacheKey} (age: ${age}ms)`);
        return NextResponse.json(cachedEntry.data);
      } else {
        // Cache expired, delete it
        delete cache[cacheKey];
      }
    }

    // =====================
    // STEP 2 — GET REGION COORDINATES
    // =====================
    let regionCoords: { lat: number; lon: number };
    let regionName: string;

    if (regionQuery) {
      try {
        regionCoords = await getRegionCoordinates(regionQuery);
        regionName = regionQuery;
      } catch (error) {
        return NextResponse.json(
          { 
            error: 'Region not found or invalid',
            details: error instanceof Error ? error.message : 'Unknown error'
          },
          { status: 404 }
        );
      }
    } else {
      // Default to a global center point if no region specified
      regionCoords = { lat: 0, lon: 0 };
      regionName = 'Global';
    }

    // =====================
    // STEP 3 — FETCH POSTS FROM MULTIPLE SOURCES
    // =====================
    console.log(`Fetching posts${regionQuery ? ` for region: ${regionQuery}` : ' (global)'}...`);
    
    // Get country code from region
    const countryCode = regionQuery 
      ? extractCountryFromRegion(regionQuery)
      : countryCodeMap["default"];
    
    console.log(`[Fetch] Mapped region "${regionQuery || 'global'}" to country code: ${countryCode}`);
    
    // Extract main region name for NewsAPI search
    const { extractMainRegion } = await import('@/utils/regionFilter');
    const mainRegionName = regionQuery ? extractMainRegion(regionQuery) : undefined;
    console.log(`[Fetch] Using region name for NewsAPI search: "${mainRegionName || 'country-level'}"`);
    
    // Fetch from multiple sources in parallel
    // Fetch more articles to increase chances of finding city-specific content
    const [newsPosts, gdeltPosts] = await Promise.all([
      // Get NewsAPI posts - search by city name if available, otherwise by country
      fetchNewsForCountry(countryCode, 200, mainRegionName).catch(err => {
        console.warn('[Fetch] NewsAPI error:', err);
        return [];
      }),
      // Get GDELT posts (geo-coded events) - use max 250
      fetchGdeltEvents(250).catch(err => {
        console.warn('[Fetch] GDELT error:', err);
        return [];
      }),
    ]);
    
    console.log(`[Fetch] Retrieved ${newsPosts.length} news articles and ${gdeltPosts.length} GDELT events`);
    
    // Convert NewsPost format to uniform format
    const newsPostsFormatted = newsPosts.map((newsPost, index) => ({
      text: newsPost.text,
      createdAt: new Date(newsPost.createdAt).toISOString(),
      source: newsPost.source,
      uri: newsPost.url || `newsapi-${index}`,
      cid: `newsapi-${index}`,
      lat: null,
      lon: null,
    }));
    
    // Convert GDELT format to uniform format
    // GDELT has coordinates, so we can use them directly
    const gdeltPostsFormatted = gdeltPosts.map((gdeltPost, index) => ({
      text: gdeltPost.text,
      createdAt: new Date(gdeltPost.createdAt).toISOString(),
      source: gdeltPost.source,
      uri: gdeltPost.url || `gdelt-${index}`,
      cid: `gdelt-${index}`,
      lat: gdeltPost.coordinates ? gdeltPost.coordinates[1] : null, // lat is second in [lng, lat]
      lon: gdeltPost.coordinates ? gdeltPost.coordinates[0] : null, // lng is first
      tone: gdeltPost.tone, // Keep tone for potential use
    }));
    
    // Combine all posts
    const combined = [...newsPostsFormatted, ...gdeltPostsFormatted];
    
    if (combined.length === 0) {
      return NextResponse.json(
        { 
          error: `No posts found for region: ${regionQuery || 'global'}`,
          region: regionName,
          coordinates: regionCoords,
          suggestion: `Could not fetch posts from NewsAPI or GDELT. Make sure NEWSAPI_KEY is set in your environment variables, or try a different region.`
        },
        { status: 404 }
      );
    }
    
    console.log(`[Fetch] Combined ${combined.length} posts (${newsPostsFormatted.length} news, ${gdeltPostsFormatted.length} GDELT)`);
    
    // Apply region filtering if region is specified
    // This filters posts by text content to match the specific region (e.g., "New York" not just "US")
    let filteredPosts = combined;
    if (regionQuery) {
      const { filterByRegion, extractMainRegion } = await import('@/utils/regionFilter');
      
      // Extract just the main region name from the full autocomplete string
      // e.g., "New York, New York, United States" -> "new york"
      const mainRegionName = extractMainRegion(regionQuery);
      console.log(`[Fetch] Applying region filter for: "${regionQuery}" -> extracted: "${mainRegionName}"`);
      console.log(`[Fetch] Sample post text: "${combined[0]?.text?.substring(0, 100)}..."`);
      
      // Filter posts by region keywords using the extracted main region name
      // This ensures we're matching against "new york" not the full geocoded string
      filteredPosts = filterByRegion(combined as any, mainRegionName) as typeof combined;
      console.log(`[Fetch] After region filtering: ${filteredPosts.length} posts (from ${combined.length} total) for region "${mainRegionName}"`);
      
      // If filtering removed all posts, that's a problem - log it
      if (filteredPosts.length === 0 && combined.length > 0) {
        console.warn(`[Fetch] WARNING: Region filter removed ALL posts! This might indicate the filter is too strict or posts don't contain region keywords.`);
      }
      
      // If filtering removed all posts, that's a problem
      // This means the posts don't contain the region keywords
      // For now, we'll return an error rather than showing unrelated posts
      if (filteredPosts.length === 0) {
        console.warn(`[Fetch] Region filter removed ALL ${combined.length} posts for "${regionQuery}"`);
        return NextResponse.json(
          { 
            error: `No posts found matching region: ${regionQuery}`,
            region: regionName,
            coordinates: regionCoords,
            suggestion: `Found ${combined.length} posts but none mentioned "${regionQuery}" in the title or description. NewsAPI only filters by country, so city-specific filtering is limited. Try searching for a country instead, or a larger city.`
          },
          { status: 404 }
        );
      }
    }
    
    // Use filtered posts
    const posts = filteredPosts;

    // =====================
    // STEP 4 — EMOTION CLASSIFICATION
    // =====================
    console.log(`Classifying emotions for ${posts.length} posts...`);
    
    // Extract post texts for batch classification
    const postTexts = posts.map(post => post.text);
    
    // Classify all posts in parallel
    const emotionResults: EmotionResult[] = await classifyEmotionsBatch(postTexts);

    // =====================
    // STEP 5 — FORMAT POSTS FOR MAP
    // =====================
    const postsWithEmotions: PostWithEmotion[] = posts.map((post, index) => ({
      id: post.uri || `post-${index}`,
      text: post.text,
      created_at: post.createdAt,
      author_id: post.cid || `author-${index}`,
      emotion: emotionResults[index],
      source: post.source,
      uri: post.uri,
      cid: post.cid,
    }));

    // Generate emotions summary
    const emotionsSummary = generateEmotionsSummary(emotionResults);

    // =====================
    // STEP 6 — FORMAT MAP DATA (SMART SPREADING)
    // =====================
    // Transform posts to format expected by formatMapData
    // formatMapData will apply smart spreading around region center
    const postsForMap = postsWithEmotions.map(post => ({
      id: post.id,
      text: post.text,
      created_at: post.created_at,
      author_id: post.author_id,
      emotion: post.emotion,
      // Don't set lat/lon - let formatMapData apply smart spreading
      source: post.source,
      source_file: undefined, // NewsAPI posts don't have source_file
    }));

    // formatMapData now expects UnifiedPost[] format, but we have postsWithEmotions
    // Convert to UnifiedPost format for formatMapData
    const unifiedPosts = postsWithEmotions.map((post, index) => ({
      text: post.text,
      createdAt: post.created_at,
      source: post.source as 'newsapi' | 'gdelt',
      uri: post.uri,
      cid: post.cid || `post-${index}`,
      lat: null, // Will be spread around region center
      lon: null,
      tone: undefined,
    }));

    // formatMapData will spread posts naturally around region center
    const geoJson = await formatMapData(unifiedPosts, { lat: regionCoords.lat, lng: regionCoords.lon });

    // =====================
    // STEP 7 — PREPARE TOP POSTS (HIGHEST CONFIDENCE)
    // =====================
    const topPosts = postsWithEmotions
      .filter(post => post.text && post.text.length > 0)
      .sort((a, b) => b.emotion.confidence - a.emotion.confidence) // Sort by confidence descending
      .slice(0, 10) // Top 10 highest confidence
      .map(post => ({
        text: post.text.substring(0, 280),
        emotion: post.emotion.emotion,
      }));

    // =====================
    // STEP 8 — PREPARE RESPONSE
    // =====================
    const responseData: ResponseData = {
      region: regionName,
      coordinates: regionCoords,
      geoJson,
      emotionsSummary,
      topPosts,
      posts: postsWithEmotions,
    };

    // =====================
    // STEP 9 — CACHE THE RESULT
    // =====================
    cache[cacheKey] = {
      timestamp: Date.now(),
      data: responseData,
    };

    // =====================
    // RETURN RESPONSE
    // =====================
    return NextResponse.json(responseData);

  } catch (error) {
    console.error('Error in tweets API route:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

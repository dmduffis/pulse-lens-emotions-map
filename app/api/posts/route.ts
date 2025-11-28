import { NextRequest, NextResponse } from 'next/server';
import { classifyEmotionsBatch, generateEmotionsSummary, EmotionResult } from '../../utils/classifyEmotion';
import { fetchGdeltEvents } from '@/utils/gdeltClient';
import { formatMapData } from '@/utils/formatMapData';
import type { GeoJSON } from 'geojson';

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
    // STEP 3 — FETCH GDELT EVENTS
    // =====================
    // GDELT API only supports country-level filtering via sourcecountry parameter
    // We need to extract the country from the region query (cities map to countries)
    const { getCountryNameForGdelt } = await import('@/utils/countryMap');
    const countryName = regionQuery ? getCountryNameForGdelt(regionQuery) : undefined;
    
    if (regionQuery && !countryName) {
      console.warn(`[Fetch] Could not map region "${regionQuery}" to a country. Skipping GDELT fetch.`);
      // Continue without GDELT data rather than failing
    } else {
      console.log(`Fetching GDELT events${countryName ? ` for country: ${countryName}` : ' (global)'}...`);
    }
    
    // Fetch GDELT events - filter by country using query-based search
    // Only fetch if we have a valid country name or no region specified (global search)
    // Note: GDELT API has a maximum of 250 records per request
    // Using 100 for testing
    const gdeltPosts = countryName !== undefined || !regionQuery
      ? await fetchGdeltEvents(100, countryName).catch(err => {
          console.warn('[Fetch] GDELT error:', err);
          return [];
        })
      : [];
    
    console.log(`[Fetch] Retrieved ${gdeltPosts.length} GDELT events`);
    
    // Convert GDELT format to uniform format
    // GDELT has coordinates, so we can use them directly
    const combined = gdeltPosts.map((gdeltPost, index) => ({
      text: gdeltPost.text,
      createdAt: new Date(gdeltPost.createdAt).toISOString(),
      source: gdeltPost.source,
      uri: gdeltPost.url || `gdelt-${index}`,
      cid: `gdelt-${index}`,
      lat: gdeltPost.coordinates ? gdeltPost.coordinates[1] : null, // lat is second in [lng, lat]
      lon: gdeltPost.coordinates ? gdeltPost.coordinates[0] : null, // lng is first
      tone: gdeltPost.tone, // Keep tone for potential use
    }));
    
    if (combined.length === 0) {
      return NextResponse.json(
        { 
          error: `No posts found for region: ${regionQuery || 'global'}`,
          region: regionName,
          coordinates: regionCoords,
          suggestion: `Could not fetch GDELT events for this region. Try a different region or wait a few minutes for new events to appear.`
        },
        { status: 404 }
      );
    }
    
    console.log(`[Fetch] Retrieved ${combined.length} GDELT events`);
    
    // Since we're already filtering by country at the API level (sourcecountry parameter),
    // we don't need to apply additional text-based region filtering for country searches.
    // The GDELT API already ensures all returned articles are from sources in that country.
    let filteredPosts = combined;
    
    // Only apply text-based filtering if we have posts and want to further refine
    // For now, skip text filtering since country-level filtering is already done by the API
    console.log(`[Fetch] Using ${combined.length} GDELT events (already filtered by country: ${countryName || 'global'})`);
    
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
      source_file: undefined,
    }));

    // formatMapData now expects UnifiedPost[] format, but we have postsWithEmotions
    // Convert to UnifiedPost format for formatMapData
    const unifiedPosts = postsWithEmotions.map((post, index) => ({
      text: post.text,
      createdAt: post.created_at,
      source: post.source as 'gdelt',
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

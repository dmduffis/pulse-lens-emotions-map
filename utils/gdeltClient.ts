// =====================
// GDELT CLIENT
// =====================
// Fetches the last 15 minutes of GDELT events
// and converts them into Post-like objects for emotion mapping

export interface GdeltEvent {
  text: string;
  createdAt: number;
  source: 'gdelt';
  region: string;
  url: string;
  coordinates: [number, number] | null; // [lng, lat]
  tone: number; // sentiment score
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * @returns Distance in kilometers
 */
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Fetch GDELT events filtered by country
 * Uses the DOC 2.0 API which returns articles with metadata
 * @param limit - Maximum number of events to return (default: 2000)
 * @param countryName - Optional: Filter by country name (e.g., "United States", "France")
 * @returns Array of GDELT events in Post-like format, filtered by country if provided
 */
export async function fetchGdeltEvents(
  limit = 2000,
  countryName?: string
): Promise<GdeltEvent[]> {
  // GDELT DOC 2.0 API - this is the documented working endpoint
  // Returns articles with geo-location data
  // Using mode=ArtList (capital A, capital L) to get article list
  // timespan must be at least 1d (1 day) - shorter timespans are rejected
  // IMPORTANT: API has a maximum of 250 records per request
  // 
  // STRATEGY: The sourcecountry parameter doesn't work reliably.
  // Instead, we use the country name in the query to find articles about/from that country.
  // This approach works better than sourcecountry parameter.
  const maxRecords = Math.min(limit, 250); // Cap at 250 (API limit)
  
  // Build query: include country name in search to find relevant articles
  let query = 'news';
  if (countryName) {
    // Add country name to query to find articles about/from that country
    query = `news ${countryName}`;
    console.log(`[GDELT] Using query-based search: "${query}" for country: ${countryName}`);
  } else {
    console.log('[GDELT] Fetching global results (no country filter)');
  }
  
  let url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&maxrecords=${maxRecords}&format=json&timespan=1d`;
  
  console.log(`[GDELT] API URL: ${url.substring(0, 150)}...`); // Log first 150 chars of URL

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });
    
    console.log(`[GDELT] Response status: ${res.status}, Content-Type: ${res.headers.get('content-type')}`);
    
    // Check if response is actually JSON
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    
    // GDELT DOC API should return JSON, but sometimes returns HTML for errors
    // Check if response is HTML (error page)
    if (!contentType.includes('application/json') || text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
      // Check if it's an error message in HTML
      if (text.includes('Your query was too short') || text.includes('Timespan is too short') || text.includes('error')) {
        console.error(`[GDELT] API error: ${text.substring(0, 200)}`);
        return [];
      }
      
      console.warn('[GDELT] API returned HTML instead of JSON. This may indicate an invalid query or API issue.');
      console.warn(`[GDELT] Response preview: ${text.substring(0, 300)}`);
      
      // Don't try to parse HTML - return empty array
      // The API should return JSON, so HTML means something went wrong
      return [];
    }

    // If we got JSON, parse it normally
    const json = JSON.parse(text);

    // GDELT DOC 2.0 API returns articles in different formats
    // Check for articles array, docs array, or other formats
    let articlesArray: any[] = [];
    
    if (json?.articles && Array.isArray(json.articles)) {
      // DOC API returns articles array
      articlesArray = json.articles;
    } else if (json?.docs && Array.isArray(json.docs)) {
      // Alternative docs array
      articlesArray = json.docs;
    } else if (json?.features && Array.isArray(json.features)) {
      // GeoJSON format with features
      articlesArray = json.features.map((feature: any) => ({
        ...(feature.properties || {}),
        geometry: feature.geometry || {},
      }));
    } else if (json?.events && Array.isArray(json.events)) {
      // Regular events array
      articlesArray = json.events;
    } else if (Array.isArray(json)) {
      // Direct array of articles
      articlesArray = json;
    } else {
      console.warn('[GDELT] Response does not contain articles array. Response structure:', Object.keys(json));
      return [];
    }

    console.log(`[GDELT] Found ${articlesArray.length} articles in response`);

    // Map all articles to events
    const allEvents = articlesArray.map((article: any) => {
      // DOC API format: articles have title, snippet, url, date, etc.
      // Some articles may have location data
      const geom = article.geometry || {};
      
      // Extract coordinates - DOC API may have location data
      let coordinates: [number, number] | null = null;
      if (geom.coordinates && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
        coordinates = [geom.coordinates[0], geom.coordinates[1]]; // [lon, lat]
      } else if (article.longitude && article.latitude) {
        coordinates = [Number(article.longitude), Number(article.latitude)];
      } else if (article.lng && article.lat) {
        coordinates = [Number(article.lng), Number(article.lat)];
      } else if (article.location) {
        // Location object with lat/lng
        if (article.location.lat && article.location.lng) {
          coordinates = [Number(article.location.lng), Number(article.location.lat)];
        }
      }

      // Extract date - DOC API uses seendate in format "20251128T021500Z"
      let dateMs = Date.now();
      if (article.seendate) {
        // Parse GDELT date format: "20251128T021500Z" -> "2025-11-28T02:15:00Z"
        const dateStr = article.seendate;
        if (dateStr.length >= 15) {
          const formatted = `${dateStr.substring(0,4)}-${dateStr.substring(4,6)}-${dateStr.substring(6,8)}T${dateStr.substring(9,11)}:${dateStr.substring(11,13)}:${dateStr.substring(13,15)}Z`;
          dateMs = new Date(formatted).getTime();
        }
      } else if (article.date) {
        dateMs = new Date(article.date).getTime();
      } else if (article.datetime) {
        dateMs = new Date(article.datetime).getTime();
      } else if (article.publishedAt) {
        dateMs = new Date(article.publishedAt).getTime();
      }

      return {
        text: article.title || article.snippet || article.url || "No title available",
        createdAt: dateMs,
        source: "gdelt" as const,
        region: article.sourcecountry || article.country_name || article.countrycode || article.location?.country || "unknown",
        url: article.url || article.url_mobile || article.shareurl || article.sourceurl || null,
        tone: article.tone || article.avgtone || null,   // GDELT sentiment score
        coordinates: coordinates, // DOC API doesn't include coordinates - will be null and spread around region center
      };
    });

    // Since we're using query-based search (query=news {countryName}), the API should return
    // articles that mention the country. We can optionally filter further by sourcecountry
    // field, but the query-based approach is more reliable.
    let filteredEvents = allEvents;
    
    if (countryName) {
      const beforeCount = filteredEvents.length;
      const requestedCountry = countryName.toLowerCase();
      
      // Filter by sourcecountry field to prioritize articles FROM the country
      // But also keep articles ABOUT the country (which may be from other countries)
      filteredEvents = allEvents.filter((event) => {
        const eventCountry = event.region?.toLowerCase() || '';
        const eventText = event.text?.toLowerCase() || '';
        
        // Priority 1: Exact country match in sourcecountry
        if (eventCountry === requestedCountry) {
          return true;
        }
        
        // Priority 2: Country name appears in article text (article is ABOUT the country)
        // This catches articles that mention the country even if from different source
        const countryInText = eventText.includes(requestedCountry) || 
                             eventText.includes(requestedCountry.split(' ')[0]); // e.g., "netherlands" or "united"
        
        // Country variations for matching
        const countryVariations: Record<string, string[]> = {
          'united states': ['united states', 'usa', 'us', 'america'],
          'netherlands': ['netherlands', 'holland', 'dutch', 'nederland'],
          'united kingdom': ['united kingdom', 'uk', 'britain', 'england'],
        };
        
        const variations = countryVariations[requestedCountry] || [requestedCountry];
        const matchesVariation = variations.some(v => 
          eventCountry.includes(v) || 
          v.includes(eventCountry) ||
          eventText.includes(v)
        );
        
        return countryInText || matchesVariation;
      });
      
      console.log(
        `[GDELT] Filtered ${filteredEvents.length} events (from ${beforeCount} total) for country: ${countryName}`
      );
      
      // If we have very few results, return all (better than nothing)
      if (filteredEvents.length < limit / 2 && allEvents.length > 0) {
        console.log(
          `[GDELT] Few filtered results (${filteredEvents.length}), returning all ${allEvents.length} events from query`
        );
        filteredEvents = allEvents;
      }
    } else {
      console.log(
        `[GDELT] Retrieved ${allEvents.length} events (global, no country filter)`
      );
    }

    // Return up to limit events
    return filteredEvents.slice(0, limit);
  } catch (err) {
    console.error("GDELT error:", err);
    return [];
  }
}


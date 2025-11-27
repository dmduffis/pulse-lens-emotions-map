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
 * Fetch the last 15 minutes of GDELT events
 * @param limit - Maximum number of events to return (default: 200)
 * @returns Array of GDELT events in Post-like format
 */
export async function fetchGdeltEvents(limit = 200): Promise<GdeltEvent[]> {
  // GDELT API v2 - use maxrecords parameter (can go up to 250)
  const maxRecords = Math.min(limit, 250); // GDELT max is 250
  const url =
    `https://api.gdeltproject.org/api/v2/doc/doc?query=*&mode=artlist&maxrecords=${maxRecords}&format=json`;

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });
    
    // Check if response is actually JSON
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await res.text();
      // If we get HTML, the endpoint might be wrong or API is down
      if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
        console.warn('[GDELT] API returned HTML instead of JSON, endpoint may be incorrect');
        return [];
      }
      console.warn('[GDELT] Response is not JSON, content-type:', contentType);
      return [];
    }

    const json = await res.json();

    // GDELT doc API returns different structure - check for articles or docs array
    const articles = json.articles || json.docs || json.results || [];
    if (!articles || articles.length === 0) {
      return [];
    }

    return articles.slice(0, limit).map((e: any) => {
      // Extract text from title or snippet
      const text = e.title || e.snippet || e.url || "";
      
      // Extract date - GDELT uses different date formats
      let dateMs = Date.now();
      if (e.date) {
        dateMs = new Date(e.date).getTime();
      } else if (e.datetime) {
        dateMs = new Date(e.datetime).getTime();
      } else if (e.publishedAt) {
        dateMs = new Date(e.publishedAt).getTime();
      }

      // Extract location if available
      let coordinates: [number, number] | null = null;
      let region = "unknown";
      
      if (e.latitude && e.longitude) {
        const lat = Number(e.latitude);
        const lng = Number(e.longitude);
        if (!isNaN(lat) && !isNaN(lng)) {
          coordinates = [lng, lat];
        }
      } else if (e.location) {
        // Try to parse location object
        if (e.location.lat && e.location.lng) {
          const lat = Number(e.location.lat);
          const lng = Number(e.location.lng);
          if (!isNaN(lat) && !isNaN(lng)) {
            coordinates = [lng, lat];
          }
        }
        region = e.location.country || e.location.name || "unknown";
      }

      return {
        text: text,
        createdAt: dateMs,
        source: "gdelt" as const,
        region: region,
        url: e.url || e.shareurl || "",
        coordinates: coordinates,
        tone: e.tone || e.avgtone || 0, // sentiment score
      };
    });
  } catch (err) {
    console.error("GDELT error:", err);
    return [];
  }
}


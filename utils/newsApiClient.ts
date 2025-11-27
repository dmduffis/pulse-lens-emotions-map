// =====================
// NEWS API CLIENT
// =====================
// Fetches top news headlines for a specific country
// and turns them into uniform Post objects.

export interface NewsPost {
  text: string;
  createdAt: number;
  source: 'newsapi';
  region: string;
  url: string;
  coordinates: null;
}

/**
 * Fetch news articles for a specific region (city or country)
 * @param countryCode - 2-letter country code (e.g., "us", "gb", "fr")
 * @param regionName - Optional city/region name for more specific search (e.g., "New York", "Los Angeles")
 * @param limit - Maximum number of articles to return (default: 100, max: 100 per NewsAPI)
 * @returns Array of news posts in uniform format
 */
export async function fetchNewsForCountry(countryCode: string, limit = 100, regionName?: string): Promise<NewsPost[]> {
  const apiKey = process.env.NEWSAPI_KEY;
  
  if (!apiKey) {
    console.warn('[NewsAPI] NEWSAPI_KEY not set, skipping news fetch');
    return [];
  }

  // NewsAPI top-headlines doesn't support pagination properly
  // Use the "everything" endpoint instead which supports pagination and has more results
  // We'll search for news in the country by using the country name as a query
  const maxPageSize = 100; // Everything endpoint allows up to 100 per page
  const maxPages = 3; // Fetch up to 3 pages = 300 articles max
  const pagesNeeded = Math.min(maxPages, Math.ceil(limit / maxPageSize));
  const articles: Array<{ title: string; description: string; publishedAt: string; url: string }> = [];
  
  // If regionName is provided, search for that specific city/region
  // Otherwise, search by country name
  let searchQuery: string;
  if (regionName) {
    // Search for the specific city/region name
    searchQuery = regionName;
    console.log(`[NewsAPI] Searching for region: "${regionName}"`);
  } else {
    // Get country name for search query (basic mapping)
    const countryNames: Record<string, string> = {
      'us': 'United States', 'gb': 'United Kingdom', 'ca': 'Canada', 'fr': 'France',
      'de': 'Germany', 'jp': 'Japan', 'br': 'Brazil', 'in': 'India', 'ng': 'Nigeria',
      'za': 'South Africa', 'mx': 'Mexico', 'ht': 'Haiti', 'au': 'Australia',
      'cn': 'China', 'ru': 'Russia', 'es': 'Spain', 'it': 'Italy', 'nl': 'Netherlands',
      'se': 'Sweden', 'no': 'Norway', 'dk': 'Denmark', 'fi': 'Finland', 'ie': 'Ireland',
      'nz': 'New Zealand', 'ar': 'Argentina', 'co': 'Colombia', 'eg': 'Egypt',
      'sa': 'Saudi Arabia', 'ae': 'United Arab Emirates', 'tr': 'Turkey', 'id': 'Indonesia',
      'ph': 'Philippines', 'th': 'Thailand', 'vn': 'Vietnam', 'kr': 'South Korea',
      'pk': 'Pakistan', 'bd': 'Bangladesh', 'ir': 'Iran', 'il': 'Israel', 'gr': 'Greece',
      'pl': 'Poland', 'ch': 'Switzerland', 'be': 'Belgium', 'lb': 'Lebanon'
    };
    searchQuery = countryNames[countryCode.toLowerCase()] || countryCode;
    console.log(`[NewsAPI] Searching for country: "${searchQuery}"`);
  }
  
  for (let page = 1; page <= pagesNeeded && articles.length < limit; page++) {
    const pageSize = Math.min(maxPageSize, limit - articles.length);
    // Use "everything" endpoint with region/country name search
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(searchQuery)}&language=en&pageSize=${pageSize}&page=${page}&sortBy=publishedAt&apiKey=${apiKey}`;
    
    try {
      const res = await fetch(url);
      const json = await res.json();
      
      if (json.articles && json.articles.length > 0) {
        articles.push(...json.articles);
        console.log(`[NewsAPI] Fetched page ${page}: ${json.articles.length} articles (total so far: ${articles.length})`);
      } else {
        // No more articles available
        break;
      }
      
      // If we got fewer articles than requested, we've reached the end
      if (json.articles.length < pageSize) {
        break;
      }
    } catch (err) {
      console.error(`[NewsAPI] Error fetching page ${page}:`, err);
      break;
    }
  }
  
  if (articles.length === 0) {
    console.warn('[NewsAPI] No articles in response');
    return [];
  }

  try {
    // Return articles up to the limit
    return articles.slice(0, limit).map((a) => ({
      text: `${a.title}. ${a.description || ""}`,
      createdAt: new Date(a.publishedAt).getTime(),
      source: "newsapi" as const,
      region: countryCode,
      url: a.url,
      coordinates: null, // NewsAPI does not return coordinates
    }));
  } catch (err) {
    console.error("NewsAPI error:", err);
    return [];
  }
}


// =====================
// LOCATION EXTRACTION
// =====================
// Uses OpenAI to extract location entities from post text
// This helps match posts that mention locations even if they don't use exact keywords

import type { BlueskyPost } from './blueskyClient';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

interface LocationExtraction {
  locations: string[];
  confidence: number;
}

/**
 * Extract location entities from post text using OpenAI
 * Returns an array of location names mentioned in the text
 */
export async function extractLocationsFromText(text: string): Promise<string[]> {
  if (!OPENAI_API_KEY) {
    console.warn('[LocationExtraction] OPENAI_API_KEY not set, skipping location extraction');
    return [];
  }

  if (!text || text.length < 10) {
    return [];
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Use cheaper model for entity extraction
        messages: [
          {
            role: 'system',
            content: 'You are a location extraction assistant. Extract all city, state, country, and landmark names from the text. Return ONLY a JSON array of location names, nothing else. Example: ["New York", "Manhattan", "United States"]'
          },
          {
            role: 'user',
            content: `Extract all location names from this text: "${text.substring(0, 500)}"`
          }
        ],
        temperature: 0.3,
        max_tokens: 100,
      }),
    });

    if (!response.ok) {
      console.warn('[LocationExtraction] OpenAI API error:', response.status);
      return [];
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      return [];
    }

    // Parse JSON array from response
    try {
      const locations = JSON.parse(content);
      if (Array.isArray(locations)) {
        return locations.map((loc: string) => loc.toLowerCase().trim());
      }
    } catch (parseError) {
      // If parsing fails, try to extract locations from text
      const locationMatches = content.match(/"([^"]+)"/g);
      if (locationMatches) {
        return locationMatches.map((match: string) => 
          match.replace(/"/g, '').toLowerCase().trim()
        );
      }
    }

    return [];
  } catch (error) {
    console.warn('[LocationExtraction] Error extracting locations:', error instanceof Error ? error.message : String(error));
    return [];
  }
}

/**
 * Batch extract locations from multiple posts
 * Uses Promise.all for parallel processing
 */
export async function extractLocationsBatch(posts: BlueskyPost[]): Promise<Map<string, string[]>> {
  const locationMap = new Map<string, string[]>();
  
  // Process in batches of 10 to avoid rate limits
  const batchSize = 10;
  for (let i = 0; i < posts.length; i += batchSize) {
    const batch = posts.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (post) => {
        const locations = await extractLocationsFromText(post.text);
        return { uri: post.uri, locations };
      })
    );
    
    results.forEach(({ uri, locations }) => {
      if (locations.length > 0) {
        locationMap.set(uri, locations);
      }
    });
    
    // Small delay between batches to avoid rate limits
    if (i + batchSize < posts.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return locationMap;
}


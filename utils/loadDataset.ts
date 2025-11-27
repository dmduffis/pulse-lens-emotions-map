import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

// =====================
// TYPES
// =====================
export interface TweetData {
  text: string;
  lat: number | null;
  lon: number | null;
  source: string;
  source_file?: string;
}

// =====================
// LOAD DATASET FUNCTION
// =====================
/**
 * Loads tweet data from CSV file
 * @param limit - Optional limit on number of rows to return (default: 1000)
 * @returns Promise with array of tweet data
 */
export async function loadDataset(limit: number = 1000): Promise<TweetData[]> {
  // Construct file path - check both possible locations
  const possiblePaths = [
    path.join(process.cwd(), 'data', 'disaster_tweets_merged.csv'),
    path.join(process.cwd(), 'app', 'data', 'disaster_tweets', 'disaster_tweets.csv'),
  ];

  let csvPath: string | null = null;
  for (const possiblePath of possiblePaths) {
    if (fs.existsSync(possiblePath)) {
      csvPath = possiblePath;
      break;
    }
  }

  if (!csvPath) {
    throw new Error(
      `CSV file not found. Checked: ${possiblePaths.join(', ')}`
    );
  }

  // Read CSV file
  const csvContent = fs.readFileSync(csvPath, 'utf-8');

  // Parse CSV
  const parseResult = Papa.parse(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase(),
  });

  if (parseResult.errors.length > 0) {
    console.warn('CSV parsing errors:', parseResult.errors);
  }

  // Get headers to check for lat/lon columns
  const headers = parseResult.meta.fields || [];
  const hasLat = headers.includes('lat') || headers.includes('latitude');
  const hasLon = headers.includes('lon') || headers.includes('longitude') || headers.includes('lng');

  // Transform data
  const tweets: TweetData[] = parseResult.data
    .slice(0, limit) // Apply limit
    .map((row: any) => {
      // Clean text - strip quotes and trim whitespace
      let text = row.text || row.tweet || '';
      if (typeof text === 'string') {
        // Remove surrounding quotes if present
        text = text.replace(/^["']|["']$/g, '').trim();
      } else {
        text = String(text).trim();
      }

      // Extract lat/lon if available
      let lat: number | null = null;
      let lon: number | null = null;

      if (hasLat) {
        const latValue = row.lat || row.latitude;
        if (latValue !== undefined && latValue !== null && latValue !== '') {
          const parsed = parseFloat(String(latValue));
          if (!isNaN(parsed)) {
            lat = parsed;
          }
        }
      }

      if (hasLon) {
        const lonValue = row.lon || row.longitude || row.lng;
        if (lonValue !== undefined && lonValue !== null && lonValue !== '') {
          const parsed = parseFloat(String(lonValue));
          if (!isNaN(parsed)) {
            lon = parsed;
          }
        }
      }

      // Extract source
      const source = row.source || 'unknown';
      const sourceFile = row.source_file || '';

      return {
        text,
        lat,
        lon,
        source: String(source),
        source_file: String(sourceFile),
      };
    })
    .filter((tweet: TweetData) => tweet.text.length > 0); // Filter out empty tweets

  return tweets;
}


// =====================
// FORMAT MAP DATA
// =====================
// Convert unified ingestion data (bluesky + newsapi + gdelt)
// into:
// 1. Emotion-labeled posts
// 2. Coordinates (true or smart-spread)
// 3. Valid GeoJSON FeatureCollection

import type { GeoJSON } from 'geojson';
import { classifyEmotion } from '../app/utils/classifyEmotion';
import { spreadAroundRegion } from './spreadUtil';
import type { UnifiedPost } from './ingestUnified';

// =====================
// EMOTION COLOR MAPPING
// =====================
export const EmotionColorMap = {
  anger: '#FF4C4C',
  fear: '#8B00FF',
  sadness: '#4C79FF',
  joy: '#FFD93D',
  hope: '#4CFF4C',
  neutral: '#AAAAAA',
} as const;

export type EmotionType = keyof typeof EmotionColorMap;

// =====================
// REGION COORDINATES
// =====================
interface RegionCoordinates {
  lat: number;
  lng: number; // Note: using lng to match user's code
}

// =====================
// MAIN FUNCTION
// =====================
/**
 * Converts unified ingestion data into a Mapbox-ready GeoJSON dataset
 * @param posts - Array of unified posts from NewsAPI, GDELT, etc.
 * @param regionCenter - Region center coordinates (required for posts without coordinates)
 * @returns Promise<GeoJSON.FeatureCollection>
 */
export async function formatMapData(
  posts: UnifiedPost[],
  regionCenter: RegionCoordinates
): Promise<GeoJSON.FeatureCollection> {
  // Handle empty posts
  if (!posts || posts.length === 0) {
    return {
      type: 'FeatureCollection',
      features: [],
    };
  }

  const features: GeoJSON.Feature[] = [];

  for (const p of posts) {
    // Classify emotion for this post
    const emotion = await classifyEmotion(p.text);

    // Coordinates:
    let coords: [number, number] | null = null;

    // 1. GDELT posts have REAL LAT/LON
    if (p.lat !== null && p.lon !== null && !isNaN(p.lat) && !isNaN(p.lon)) {
      coords = [p.lon, p.lat]; // GeoJSON format: [longitude, latitude]
    } else {
      // 2. Everything else → spread around region center
      if (!regionCenter || isNaN(regionCenter.lat) || isNaN(regionCenter.lng)) {
        console.warn(`Invalid region center for post ${p.cid || 'unknown'}, skipping`);
        continue;
      }
      
      const pt = spreadAroundRegion({
        lat: regionCenter.lat,
        lon: regionCenter.lng,
      });
      
      // Validate spread coordinates
      if (isNaN(pt.lat) || isNaN(pt.lon)) {
        console.warn(`Invalid spread coordinates for post ${p.cid || 'unknown'}, skipping`);
        continue;
      }
      
      coords = [pt.lon, pt.lat];
    }

    // Final validation
    if (!coords || isNaN(coords[0]) || isNaN(coords[1])) {
      console.warn(`Invalid coordinates for post ${p.cid || 'unknown'}, skipping`);
      continue;
    }

    // Get color for emotion
    const emotionType = emotion.emotion as EmotionType;
    const color = EmotionColorMap[emotionType] || EmotionColorMap.neutral;

    // Create GeoJSON Feature
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: coords,
      },
      properties: {
        emotion: emotion.emotion,
        confidence: emotion.confidence,
        intensity: emotion.confidence, // Use confidence as intensity
        color: color,
        text: p.text,
        source: p.source,
        url: p.uri || null,
        createdAt: p.createdAt,
        tone: p.tone !== undefined ? p.tone : null, // GDELT sentiment score
      },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}


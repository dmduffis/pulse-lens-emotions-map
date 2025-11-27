// =====================
// TWEETS API ROUTE
// =====================
// Uses unified ingestion module to pull all sources,
// run emotion classification, format into geojson, and return it

import { ingestUnified } from "@/utils/ingestUnified";
import { formatMapData } from "@/utils/formatMapData";
import { geocodeRegion } from "@/utils/geocodeRegion";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const region = (searchParams.get("region") || "united states").toLowerCase();

    // 1. Get geographic center for region
    const regionCenter = await geocodeRegion(region);

    // 2. Ingest ALL data sources
    const posts = await ingestUnified(region);

    // 3. Format into geojson for map
    const geoJson = await formatMapData(posts, regionCenter);

    return Response.json({ geoJson, count: posts.length });
  } catch (e) {
    console.error("Unified ingestion error:", e);
    return Response.json({ error: "Failed to process region" }, { status: 500 });
  }
}


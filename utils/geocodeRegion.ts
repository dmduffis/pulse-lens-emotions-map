// =====================
// GEOCODE REGION
// =====================
// Geocodes a region name to get its geographic center coordinates

/**
 * Geocode a region name to get its geographic center
 * @param region - Region name (e.g., "New York", "United States", "Paris")
 * @returns Region center coordinates with lat and lng
 */
export async function geocodeRegion(region: string): Promise<{ lat: number; lng: number }> {
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
  // Mapbox returns [longitude, latitude]
  const [longitude, latitude] = geocodeData.features[0].center;
  return { lat: latitude, lng: longitude };
}


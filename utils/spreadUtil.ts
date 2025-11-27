// =====================
// SPREAD UTILITY
// =====================
// Utility function to spread posts around a region center

/**
 * Spread posts around a region center with natural distribution
 * Uses directional offsets, distance decay, and small noise to simulate
 * natural geographic distribution inside a city or region.
 * @param center - Region center coordinates
 * @param spreadKm - Maximum spread distance in kilometers (default: 5km)
 * @returns Spread coordinates
 */
export function spreadAroundRegion(
  center: { lat: number; lon: number },
  spreadKm: number = 5
): { lat: number; lon: number } {
  // Direction (0–2π)
  const angle = Math.random() * 2 * Math.PI;

  // Distance (km), using sqrt to cluster closer to the center
  // This creates a natural distribution with more posts near the center
  const distance = Math.sqrt(Math.random()) * (spreadKm / 100); // Convert km to degrees approximation

  // Convert to degrees (1 deg ≈ 111km at equator)
  // Adjust for latitude to maintain accurate distance
  const offsetLat = (Math.cos(angle) * distance) / 1.111;
  const offsetLon = (Math.sin(angle) * distance) / (1.111 * Math.cos(center.lat * Math.PI / 180));

  return {
    lat: center.lat + offsetLat,
    lon: center.lon + offsetLon,
  };
}


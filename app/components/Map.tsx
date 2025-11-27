'use client';

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import type { GeoJSON } from 'geojson';
import 'mapbox-gl/dist/mapbox-gl.css';

// Add custom popup styles
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    .mapboxgl-popup-content {
      color: #000000 !important;
      background: #ffffff !important;
    }
    .mapboxgl-popup-content * {
      color: inherit;
    }
    .custom-popup .mapboxgl-popup-content {
      padding: 12px 16px;
    }
  `;
  document.head.appendChild(style);
}

// =====================
// COMPONENT PROPS
// =====================
interface MapProps {
  geoJson: GeoJSON.FeatureCollection | null;
  center: { lat: number; lon: number };
}

// =====================
// TIME FORMATTER
// =====================
function timeAgo(timestamp: string | number | null | undefined): string {
  if (!timestamp) return 'Unknown';
  
  let timestampMs: number;
  if (typeof timestamp === 'string') {
    timestampMs = new Date(timestamp).getTime();
  } else {
    timestampMs = timestamp;
  }
  
  if (isNaN(timestampMs)) return 'Unknown';
  
  const diff = Date.now() - timestampMs;
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// =====================
// MAP COMPONENT
// =====================
export default function Map({ geoJson, center }: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const initialized = useRef(false);

  // Initialize map only once
  useEffect(() => {
    // Ensure we're in the browser
    if (typeof window === 'undefined') return;

    // Get Mapbox token
    const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!mapboxToken) {
      console.error('NEXT_PUBLIC_MAPBOX_TOKEN is not configured');
      return;
    }

    // Set Mapbox access token
    mapboxgl.accessToken = mapboxToken;

    // Initialize map only once
    if (!map.current && mapContainer.current && !initialized.current) {
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/dark-v11', // Dark style for better heatmap visibility
        center: [center.lon, center.lat],
        zoom: 10, // Default zoom for city-level
        pitch: 0,
        bearing: 0, // Disable rotation
      });

      // Wait for map to load before adding sources/layers
      map.current.on('load', () => {
        if (!map.current) return;

        // Add GeoJSON source
        map.current.addSource('tweets', {
          type: 'geojson',
          data: geoJson || {
            type: 'FeatureCollection',
            features: [],
          },
        });

        // Add heatmap layer
        map.current.addLayer({
          id: 'emotion-heat',
          type: 'heatmap',
          source: 'tweets',
          paint: {
            'heatmap-weight': ['get', 'intensity'],
            'heatmap-intensity': 1,
            'heatmap-radius': 40,
            'heatmap-opacity': 0.9,
            'heatmap-color': [
              'interpolate',
              ['linear'],
              ['heatmap-density'],
              0,
              'rgba(0,0,0,0)',
              0.2,
              'rgba(0,0,255,0.6)', // sadness
              0.4,
              'rgba(255,0,255,0.6)', // fear
              0.6,
              'rgba(255,255,0,0.6)', // joy
              0.8,
              'rgba(255,0,0,0.6)', // anger
            ],
          },
        });

        // Add circle layer for clickable points (ABOVE heatmap)
        map.current.addLayer({
          id: 'emotion-points',
          type: 'circle',
          source: 'tweets',
          paint: {
            'circle-radius': 6,
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.8,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#ffffff',
          },
        });

        // =====================
        // CLICK HANDLER FOR POPUPS
        // =====================
        map.current.on('click', 'emotion-points', (e) => {
          const feature = e.features?.[0];
          if (!feature) return;

          const props = feature.properties;

          // Escape HTML to prevent XSS
          const escapeHtml = (str: string | null | undefined) => {
            if (!str) return '';
            const div = document.createElement('div');
            div.textContent = String(str);
            return div.innerHTML;
          };

          const emotionText = escapeHtml(props.emotion || 'unknown');
          const textContent = escapeHtml(props.text || 'No preview available');
          const sourceText = escapeHtml(props.source || 'unknown');
          const url = props.url;
          const tone = props.tone;

          // Sentiment section (if tone exists)
          const sentimentSection = tone !== null && tone !== undefined
            ? `<p style="margin:4px 0 0 0; font-size:12px; color: #666;">
                 <strong>Sentiment:</strong> ${Number(tone).toFixed(2)}
               </p>`
            : '';

          // Time section (relative timestamp)
          const timeSection = props.createdAt
            ? `<p style="margin:4px 0 0 0; font-size:12px; color: #666;">
                 <strong>Time:</strong> ${timeAgo(props.createdAt)}
               </p>`
            : '';

          // Build popup HTML
          const html = `
            <div style="font-family: sans-serif; max-width: 240px;">
              <h4 style="margin:0 0 8px 0; font-size:14px; text-transform: uppercase; color: #000;">
                ${emotionText}
              </h4>

              <p style="margin:0 0 6px 0; font-size:13px; line-height:1.3; color: #333;">
                ${textContent}
              </p>

              <p style="margin:0; font-size:12px; color: #666;">
                <strong>Source:</strong> ${sourceText}
              </p>

              ${sentimentSection}
              ${timeSection}

              ${
                url
                  ? `<p style="margin:6px 0 0 0;">
                       <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color:#3b82f6; font-size:12px; text-decoration: none;">
                         Open article →
                       </a>
                     </p>`
                  : ''
              }
            </div>
          `;

          new mapboxgl.Popup({ closeButton: true, offset: 15 })
            .setLngLat(e.lngLat)
            .setHTML(html)
            .addTo(map.current!);
        });

        // =====================
        // HOVER CURSOR CHANGES
        // =====================
        map.current.on('mouseenter', 'emotion-points', () => {
          if (map.current) {
            map.current.getCanvas().style.cursor = 'pointer';
          }
        });

        map.current.on('mouseleave', 'emotion-points', () => {
          if (map.current) {
            map.current.getCanvas().style.cursor = '';
          }
        });

        initialized.current = true;
      });
    }

    // Cleanup function - only runs on unmount
    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
        initialized.current = false;
      }
    };
  }, []); // Empty dependency array - only run once on mount

  // Update map center when center prop changes
  useEffect(() => {
    if (map.current && initialized.current) {
      map.current.setCenter([center.lon, center.lat]);
    }
  }, [center.lat, center.lon]);

  // Update GeoJSON source when geoJson prop changes
  useEffect(() => {
    if (!map.current || !initialized.current) return;

    const source = map.current.getSource('tweets') as mapboxgl.GeoJSONSource;
    if (source && geoJson) {
      source.setData(geoJson);
    } else if (source) {
      // Set empty FeatureCollection if geoJson is null
      source.setData({
        type: 'FeatureCollection',
        features: [],
      });
    }
  }, [geoJson]);

  return <div ref={mapContainer} id="map" className="w-full h-full" />;
}


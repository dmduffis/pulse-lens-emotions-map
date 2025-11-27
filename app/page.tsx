'use client';

import { useState, useEffect, useRef } from 'react';
import Map from './components/Map';
import ChatBox from './components/ChatBox';
import type { GeoJSON } from 'geojson';

// =====================
// TYPES
// =====================
interface PostResponse {
  region: string;
  coordinates: { lat: number; lon: number };
  geoJson: GeoJSON.FeatureCollection;
  emotionsSummary: {
    anger: number;
    sadness: number;
    fear: number;
    joy: number;
    hope: number;
    neutral: number;
  };
  topPosts: Array<{
    text: string;
    emotion: string;
  }>;
  posts: Array<{
    id: string;
    text: string;
    created_at: string;
    emotion: { emotion: string; confidence: number };
    [key: string]: any;
  }>;
}

interface EmotionsSummary {
  anger: number;
  sadness: number;
  fear: number;
  joy: number;
  hope: number;
  neutral: number;
}

interface AutocompleteSuggestion {
  place_name: string;
  center: [number, number]; // [lon, lat]
  text: string;
  context?: Array<{ text: string }>;
}

// =====================
// MAIN PAGE COMPONENT
// =====================
export default function Home() {
  const [region, setRegion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoJson, setGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [center, setCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [emotionsSummary, setEmotionsSummary] = useState<EmotionsSummary | null>(null);
  const [topPosts, setTopPosts] = useState<Array<{ text: string; emotion: string }>>([]);
  const [currentRegion, setCurrentRegion] = useState<string>('');
  
  // Autocomplete state
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Firehose removed - now using NewsAPI instead

  // =====================
  // HANDLE SCAN FUNCTION
  // =====================
  const handleScan = async () => {
    // Validate region is not empty
    if (!region.trim()) {
      setError('Please enter a region');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // POST to /api/posts (region is trimmed but otherwise sent as-is)
      // Note: This may take a few seconds if the Firehose buffer is small and needs to accumulate posts
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          region: region.trim()
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errorMessage = errorData.error || 'Failed to scan region';
        
        // Provide helpful error messages
        let userFriendlyError = errorMessage;
        const errorDetails = errorData.details || '';
        
        // Handle authentication errors
        if (errorData.authError || errorMessage.includes('authentication') || errorMessage.includes('Invalid identifier') || errorMessage.includes('credentials not configured')) {
          userFriendlyError = errorData.details || 'API authentication failed. Please check your credentials in the environment variables.';
        }
        // Handle rate limit errors
        else if (errorData.rateLimited || errorMessage.includes('rate limit') || errorMessage.includes('Too Many Requests')) {
          let rateLimitMsg = 'API rate limit exceeded.';
          
          if (errorMessage.includes('NewsAPI')) {
            rateLimitMsg = 'NewsAPI rate limit exceeded.';
          }
          
          if (errorData.rateLimitInfo?.reset) {
            const resetTime = new Date(errorData.rateLimitInfo.reset).toLocaleTimeString();
            rateLimitMsg += ` Rate limit resets at ${resetTime}.`;
          } else if (errorData.details) {
            // Extract reset time from error details if available
            rateLimitMsg += ` ${errorData.details}`;
          } else {
            rateLimitMsg += ' Please wait a few minutes before trying again.';
          }
          
          if (errorData.rateLimitInfo?.remaining !== null && errorData.rateLimitInfo.remaining !== undefined) {
            rateLimitMsg += ` (${errorData.rateLimitInfo.remaining} requests remaining)`;
          }
          
          userFriendlyError = rateLimitMsg;
        } else if (errorMessage === 'Region not found or invalid') {
          userFriendlyError = `Region "${region.trim()}" not found. Try: "City, State" or "City, Country" format`;
        } else if (errorMessage === 'Failed to geocode region') {
          userFriendlyError = `Could not find "${region.trim()}". Try a different format like "City, State" or "City, Country"`;
        } else if (errorMessage === 'No tweets found for this region') {
          userFriendlyError = `No tweets found for "${region.trim()}". Try a larger city or different region.`;
        } else if (errorMessage === 'Failed to fetch tweets from Twitter API') {
          // Try to parse Twitter API error details
          try {
            const twitterError = JSON.parse(errorDetails);
            if (twitterError.detail) {
              userFriendlyError = `Twitter API error: ${twitterError.detail}`;
            }
          } catch {
            // If parsing fails, use the generic message
          }
        }
        
        throw new Error(userFriendlyError);
      }

      const data: PostResponse = await response.json();

      // The API already returns geoJson formatted, so use it directly
      if (!data.geoJson) {
        console.error('API did not return geoJson');
        throw new Error('Invalid response from server: missing geoJson');
      }

      // Save into state
      setGeoJson(data.geoJson);
      setCenter(data.coordinates);
      setEmotionsSummary(data.emotionsSummary);
      setTopPosts(data.topPosts);
      setCurrentRegion(data.region);

      setLoading(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to scan region';
      setError(errorMessage);
      console.error('Error scanning region:', err);
      setLoading(false);
    }
  };

  // Fetch autocomplete suggestions from Mapbox
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (!region.trim() || region.length < 2) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }

      const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      if (!mapboxToken) return;

      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(region)}.json?access_token=${mapboxToken}&limit=5&types=place,locality,neighborhood,region`;
        const response = await fetch(url);
        
        if (response.ok) {
          const data = await response.json();
          setSuggestions(data.features || []);
          setShowSuggestions(data.features && data.features.length > 0);
          setSelectedIndex(-1);
        }
      } catch (err) {
        console.error('Error fetching suggestions:', err);
        setSuggestions([]);
        setShowSuggestions(false);
      }
    };

    // Debounce API calls
    const timeoutId = setTimeout(fetchSuggestions, 300);
    return () => clearTimeout(timeoutId);
  }, [region]);

  // Handle suggestion selection
  const handleSelectSuggestion = (suggestion: AutocompleteSuggestion) => {
    setRegion(suggestion.place_name);
    setShowSuggestions(false);
    setSuggestions([]);
    setError(null);
    inputRef.current?.focus();
  };

  // Handle keyboard navigation in suggestions
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => 
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        handleSelectSuggestion(suggestions[selectedIndex]);
      } else if (e.key === 'Enter' && !loading && region.trim()) {
        setShowSuggestions(false);
        handleScan();
      } else if (e.key === 'Escape') {
        setShowSuggestions(false);
      }
    } else if (e.key === 'Enter' && !loading && region.trim()) {
      handleScan();
    }
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Default center for map when no data
  const mapCenter = center || { lat: 40.7128, lon: -74.0060 };

  return (
    <div className="flex w-full h-screen flex-col">
      {/* Top Bar */}
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black">
        {loading && (
          <div className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
            ⏳ Fetching news articles... This may take a few seconds.
          </div>
        )}
        <div className="flex gap-2 items-start">
          <div className="flex-1 max-w-md relative">
            <input
              ref={inputRef}
              type="text"
              placeholder="Start typing a location (e.g. New York, Paris, London)..."
              value={region}
              onChange={(e) => {
                setRegion(e.target.value);
                setError(null); // Clear error when user types
                setShowSuggestions(true);
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                if (suggestions.length > 0) {
                  setShowSuggestions(true);
                }
              }}
              disabled={loading}
              className="border border-zinc-300 dark:border-zinc-700 px-3 py-2 rounded-lg w-full bg-white dark:bg-zinc-900 text-black dark:text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            
            {/* Autocomplete Suggestions Dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className="absolute z-50 w-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg max-h-60 overflow-y-auto"
              >
                {suggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => handleSelectSuggestion(suggestion)}
                    className={`w-full text-left px-4 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors ${
                      index === selectedIndex
                        ? 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-500'
                        : ''
                    } ${index === 0 ? 'rounded-t-lg' : ''} ${
                      index === suggestions.length - 1 ? 'rounded-b-lg' : ''
                    }`}
                  >
                    <div className="font-medium text-sm text-black dark:text-zinc-50">
                      {suggestion.text}
                    </div>
                    <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                      {suggestion.context
                        ?.map((ctx) => ctx.text)
                        .join(', ')}
                    </div>
                  </button>
                ))}
              </div>
            )}
            
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              {suggestions.length > 0
                ? 'Select a suggestion or press Enter to search'
                : 'Start typing to see location suggestions'}
            </p>
          </div>
          <button
            onClick={handleScan}
            disabled={loading || !region.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap mt-0"
          >
            {loading ? 'Collecting posts…' : 'Scan Emotions'}
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">{error}</p>
              <p className="text-xs text-red-700 dark:text-red-300 mt-1">
                Tip: Use formats like "City, State" or "City, Country". For cities with common names, include the state/country.
              </p>
            </div>
            <button
              onClick={() => setError(null)}
              className="flex-shrink-0 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200 transition-colors"
              aria-label="Close error message"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map Container */}
        <div className="flex-1 relative">
          {geoJson && center ? (
            <Map geoJson={geoJson} center={center} />
          ) : (
            <Map geoJson={null} center={mapCenter} />
          )}
        </div>

        {/* Chat Sidebar */}
        {emotionsSummary && topPosts.length > 0 && currentRegion && (
          <ChatBox
            emotionsSummary={emotionsSummary}
            topTweets={topPosts}
            region={currentRegion}
          />
        )}
      </div>
    </div>
  );
}

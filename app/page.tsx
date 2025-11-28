"use client";

import { useState, useEffect, useRef } from "react";
import Map from "./components/Map";
import ChatBox from "./components/ChatBox";
import type { GeoJSON } from "geojson";
import type { Emotion } from "./utils/classifyEmotion";
import { ClipLoader } from "react-spinners";

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
  const [region, setRegion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoJson, setGeoJson] = useState<GeoJSON.FeatureCollection | null>(
    null
  );
  const [center, setCenter] = useState<{ lat: number; lon: number } | null>(
    null
  );
  const [emotionsSummary, setEmotionsSummary] =
    useState<EmotionsSummary | null>(null);
  const [topPosts, setTopPosts] = useState<
    Array<{ text: string; emotion: string }>
  >([]);
  const [currentRegion, setCurrentRegion] = useState<string>("");
  const [loadingStep, setLoadingStep] = useState<string>("");

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Emotion filter state
  const [selectedEmotions, setSelectedEmotions] = useState<Set<Emotion>>(
    new Set()
  );
  const [originalGeoJson, setOriginalGeoJson] =
    useState<GeoJSON.FeatureCollection | null>(null);

  // Firehose removed - now using NewsAPI instead

  // =====================
  // HANDLE SCAN FUNCTION
  // =====================
  const handleScan = async () => {
    // Validate region is not empty
    if (!region.trim()) {
      setError("Please enter a region");
      return;
    }

    setLoading(true);
    setError(null);
    
    // Simulate progress steps while API is processing
    const progressSteps = [
      { step: "Finding your location...", delay: 200 },
      { step: "Gathering the latest news...", delay: 400 },
      { step: "Reading through articles...", delay: 800 },
      { step: "Understanding the stories...", delay: 600 },
      { step: "Detecting emotions in the news...", delay: 1000 },
      { step: "Preparing your map...", delay: 400 },
      { step: "Almost ready...", delay: 300 },
    ];
    
    let currentStepIndex = 0;
    const updateProgress = () => {
      if (currentStepIndex < progressSteps.length) {
        setLoadingStep(progressSteps[currentStepIndex].step);
        setTimeout(() => {
          currentStepIndex++;
          if (currentStepIndex < progressSteps.length) {
            updateProgress();
          }
        }, progressSteps[currentStepIndex].delay);
      }
    };
    updateProgress();

    try {
      // POST to /api/posts (region is trimmed but otherwise sent as-is)
      // Note: This may take a few seconds if the Firehose buffer is small and needs to accumulate posts
      const response = await fetch("/api/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          region: region.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errorMessage = errorData.error || "Failed to scan region";

        // Provide helpful error messages
        let userFriendlyError = errorMessage;
        const errorDetails = errorData.details || "";

        // Handle authentication errors
        if (
          errorData.authError ||
          errorMessage.includes("authentication") ||
          errorMessage.includes("Invalid identifier") ||
          errorMessage.includes("credentials not configured")
        ) {
          userFriendlyError =
            errorData.details ||
            "API authentication failed. Please check your credentials in the environment variables.";
        }
        // Handle rate limit errors
        else if (
          errorData.rateLimited ||
          errorMessage.includes("rate limit") ||
          errorMessage.includes("Too Many Requests")
        ) {
          let rateLimitMsg = "API rate limit exceeded.";

          if (errorMessage.includes("NewsAPI")) {
            rateLimitMsg = "NewsAPI rate limit exceeded.";
          }

          if (errorData.rateLimitInfo?.reset) {
            const resetTime = new Date(
              errorData.rateLimitInfo.reset
            ).toLocaleTimeString();
            rateLimitMsg += ` Rate limit resets at ${resetTime}.`;
          } else if (errorData.details) {
            // Extract reset time from error details if available
            rateLimitMsg += ` ${errorData.details}`;
          } else {
            rateLimitMsg += " Please wait a few minutes before trying again.";
          }

          if (
            errorData.rateLimitInfo?.remaining !== null &&
            errorData.rateLimitInfo.remaining !== undefined
          ) {
            rateLimitMsg += ` (${errorData.rateLimitInfo.remaining} requests remaining)`;
          }

          userFriendlyError = rateLimitMsg;
        } else if (errorMessage === "Region not found or invalid") {
          userFriendlyError = `Region "${region.trim()}" not found. Try: "City, State" or "City, Country" format`;
        } else if (errorMessage === "Failed to geocode region") {
          userFriendlyError = `Could not find "${region.trim()}". Try a different format like "City, State" or "City, Country"`;
        } else if (errorMessage === "No tweets found for this region") {
          userFriendlyError = `No tweets found for "${region.trim()}". Try a larger city or different region.`;
        } else if (errorMessage === "Failed to fetch tweets from Twitter API") {
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
        console.error("API did not return geoJson");
        throw new Error("Invalid response from server: missing geoJson");
      }

      // Save into state
      setOriginalGeoJson(data.geoJson); // Store original for filtering
      setGeoJson(data.geoJson);
      setCenter(data.coordinates);
      setEmotionsSummary(data.emotionsSummary);
      setTopPosts(data.topPosts);
      setCurrentRegion(data.region);
      setSelectedEmotions(new Set()); // Reset filters when new data loads

      // Small delay to show completion
      await new Promise(resolve => setTimeout(resolve, 200));

      setLoading(false);
      setLoadingStep("");
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to scan region";
      setError(errorMessage);
      console.error("Error scanning region:", err);
      setLoading(false);
      setLoadingStep("");
    }
  };

  // Fetch autocomplete suggestions for countries only
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (!region.trim() || region.length < 1) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }

      // Use local country list for autocomplete (countries only, no cities)
      const { filterCountries } = await import("@/utils/countries");
      const filteredCountries = filterCountries(region);

      // Convert country names to autocomplete format
      const countrySuggestions: AutocompleteSuggestion[] =
        filteredCountries.map((country) => ({
          place_name: country,
          text: country,
          center: [0, 0], // Coordinates will be fetched when country is selected
          context: [],
        }));

      setSuggestions(countrySuggestions);
      setShowSuggestions(countrySuggestions.length > 0);
      setSelectedIndex(-1);
    };

    // Debounce filtering
    const timeoutId = setTimeout(fetchSuggestions, 200);
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
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
      } else if (e.key === "Enter" && selectedIndex >= 0) {
        e.preventDefault();
        handleSelectSuggestion(suggestions[selectedIndex]);
      } else if (e.key === "Enter" && !loading && region.trim()) {
        setShowSuggestions(false);
        handleScan();
      } else if (e.key === "Escape") {
        setShowSuggestions(false);
      }
    } else if (e.key === "Enter" && !loading && region.trim()) {
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

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Default center for map when no data
  const mapCenter = center || { lat: 40.7128, lon: -74.006 };

  // Emotion colors matching the map
  const emotionColors: Record<Emotion, string> = {
    anger: "#FF4C4C",
    fear: "#8B00FF",
    sadness: "#4C79FF",
    joy: "#FFD93D",
    hope: "#4CFF4C",
    neutral: "#AAAAAA",
  };

  const emotions: Emotion[] = [
    "anger",
    "sadness",
    "fear",
    "joy",
    "hope",
    "neutral",
  ];

  // Emotion filter handler
  const toggleEmotionFilter = (emotion: Emotion) => {
    setSelectedEmotions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(emotion)) {
        newSet.delete(emotion);
      } else {
        newSet.add(emotion);
      }
      return newSet;
    });
  };

  // Filter geoJson by selected emotions
  useEffect(() => {
    if (!originalGeoJson) {
      setGeoJson(null);
      return;
    }

    // If no emotions selected, show all
    if (selectedEmotions.size === 0) {
      setGeoJson(originalGeoJson);
      return;
    }

    // Filter features by selected emotions
    const filtered = {
      ...originalGeoJson,
      features: originalGeoJson.features.filter((feature) => {
        const emotion = feature.properties?.emotion as Emotion;
        return emotion && selectedEmotions.has(emotion);
      }),
    };

    setGeoJson(filtered);
  }, [selectedEmotions, originalGeoJson]);

  return (
    <div className="flex w-full h-screen flex-col">
      {/* Top Bar */}
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black">
        {loading && (
          <div className="mb-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800 rounded-lg shadow-sm">
            <div className="flex items-center gap-3">
              {/* Animated spinner - just spins, no resizing */}
              <div className="shrink-0 w-8 h-8">
                <ClipLoader
                  color="#2563eb"
                  loading={loading}
                  size={32}
                  speedMultiplier={0.8}
                  aria-label="Loading"
                  cssOverride={{
                    display: 'block',
                    width: '32px',
                    height: '32px',
                    borderWidth: '3px',
                    animation: 'spin 1s linear infinite',
                  }}
                />
              </div>
              {/* Loading text with step */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1.5">
                  {loadingStep || "Getting everything ready for you..."}
                </p>
                {/* Animated progress bar with wave effect */}
                <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2.5 overflow-hidden relative">
                  <div 
                    className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-500 bg-[length:200%_100%] rounded-full transition-all duration-700 ease-out relative overflow-hidden"
                    style={{ 
                      width: loadingStep.includes('Finding') ? '10%' : 
                             loadingStep.includes('Gathering') ? '25%' : 
                             loadingStep.includes('Reading') ? '45%' : 
                             loadingStep.includes('Understanding') ? '60%' : 
                             loadingStep.includes('Detecting') ? '80%' : 
                             loadingStep.includes('Preparing') ? '90%' : 
                             loadingStep.includes('Almost') ? '98%' : '15%',
                      animation: 'gradient-shift 2s ease infinite'
                    }}
                  >
                    {/* Animated wave effect */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"></div>
                    {/* Pulsing dots on progress bar */}
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full shadow-lg animate-pulse"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="flex gap-2 items-start">
          <div className="flex-1 max-w-md relative">
            <input
              ref={inputRef}
              type="text"
              placeholder="Enter country (e.g. United States, France, Japan)..."
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
                        ? "bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-500"
                        : ""
                    } ${index === 0 ? "rounded-t-lg" : ""} ${
                      index === suggestions.length - 1 ? "rounded-b-lg" : ""
                    }`}
                  >
                    <div className="font-medium text-sm text-black dark:text-zinc-50">
                      {suggestion.text || suggestion.place_name}
                    </div>
                    <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                      Country
                    </div>
                  </button>
                ))}
              </div>
            )}

            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              {suggestions.length > 0
                ? "Select a suggestion or press Enter to search"
                : "Start typing to see location suggestions"}
            </p>
          </div>
          <button
            onClick={handleScan}
            disabled={loading || !region.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap mt-0"
          >
            {loading ? "Collecting posts…" : "Scan Emotions"}
          </button>
        </div>

        {/* Emotion Filter Pills */}
        {geoJson && geoJson.features.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 items-center">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mr-2">
              Filter by emotion:
            </span>
            {emotions.map((emotion) => {
              const isSelected = selectedEmotions.has(emotion);
              const count =
                originalGeoJson?.features.filter(
                  (f) => f.properties?.emotion === emotion
                ).length || 0;

              return (
                <button
                  key={emotion}
                  onClick={() => toggleEmotionFilter(emotion)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    isSelected
                      ? "ring-2 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900"
                      : "opacity-60 hover:opacity-100"
                  }`}
                  style={{
                    backgroundColor: isSelected
                      ? emotionColors[emotion]
                      : `${emotionColors[emotion]}40`,
                    color: isSelected ? "#ffffff" : emotionColors[emotion],
                    borderColor: emotionColors[emotion],
                    borderWidth: isSelected ? "2px" : "1px",
                    ringColor: emotionColors[emotion],
                  }}
                >
                  {emotion.charAt(0).toUpperCase() + emotion.slice(1)}
                  {count > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs bg-white/30 dark:bg-black/30">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
            {selectedEmotions.size > 0 && (
              <button
                onClick={() => setSelectedEmotions(new Set())}
                className="px-3 py-1.5 rounded-full text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 border border-zinc-300 dark:border-zinc-600 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
          <div className="flex items-start gap-2">
            <svg
              className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                {error}
              </p>
              <p className="text-xs text-red-700 dark:text-red-300 mt-1">
                Tip: Use formats like "City, State" or "City, Country". For
                cities with common names, include the state/country.
              </p>
            </div>
            <button
              onClick={() => setError(null)}
              className="flex-shrink-0 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200 transition-colors"
              aria-label="Close error message"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
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
            currentRegion={currentRegion}
            loading={loading}
          />
        )}
      </div>
    </div>
  );
}

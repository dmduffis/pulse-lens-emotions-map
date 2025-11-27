// =====================
// BLUESKY CLIENT
// =====================
// 
// REQUIRED ENVIRONMENT VARIABLES:
// - BLUESKY_SERVICE_IDENTIFIER (your Bluesky handle, e.g., "yourhandle.bsky.social")
// - BLUESKY_APP_PASSWORD (app password from Bluesky settings)
//
// Optional:
// - BLUESKY_SERVICE_URL (defaults to "https://bsky.social" if not set)

import { BskyAgent } from '@atproto/api';

export interface BlueskyPost {
  text: string;
  source: 'bluesky';
  createdAt: string;
  uri: string;
  cid: string;
}

// =====================
// RATE LIMIT TRACKING
// =====================
// Simple in-memory tracking to help prevent rate limit issues
const requestTimestamps: number[] = [];
const MAX_REQUESTS_PER_MINUTE = 30; // Conservative limit
const REQUEST_WINDOW_MS = 60 * 1000; // 1 minute

/**
 * Check if we should throttle requests to avoid rate limits
 */
function shouldThrottle(): boolean {
  const now = Date.now();
  
  // Remove timestamps older than 1 minute
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - REQUEST_WINDOW_MS) {
    requestTimestamps.shift();
  }
  
  // Check if we're approaching rate limit
  if (requestTimestamps.length >= MAX_REQUESTS_PER_MINUTE) {
    const oldestRequest = requestTimestamps[0];
    const waitTime = REQUEST_WINDOW_MS - (now - oldestRequest);
    console.warn(`Rate limit throttle: ${requestTimestamps.length} requests in last minute. Wait ${Math.ceil(waitTime / 1000)}s`);
    return true;
  }
  
  // Record this request
  requestTimestamps.push(now);
  return false;
}

export interface BlueskyRateLimitInfo {
  remaining?: number;
  limit?: number;
  reset?: string;
  rateLimited: boolean;
}

// =====================
// HELPER: GET AUTHENTICATED AGENT
// =====================
async function getAuthenticatedAgent(): Promise<BskyAgent> {
  const serviceId = process.env.BLUESKY_SERVICE_IDENTIFIER;
  const appPassword = process.env.BLUESKY_APP_PASSWORD;
  const serviceUrl = process.env.BLUESKY_SERVICE_URL || 'https://bsky.social';

  if (!serviceId || !appPassword) {
    throw new Error('Bluesky credentials not configured. Please set BLUESKY_SERVICE_IDENTIFIER and BLUESKY_APP_PASSWORD in your environment variables.');
  }

  try {
    const agent = new BskyAgent({ service: serviceUrl });
    await agent.login({
      identifier: serviceId,
      password: appPassword,
    });
    console.log('Successfully authenticated with Bluesky');
    return agent;
  } catch (error: any) {
    const errorMessage = error?.message || 'Unknown authentication error';
    const status = error?.status || error?.statusCode;
    
    // Provide more specific error messages
    if (status === 401 || errorMessage.includes('Invalid identifier') || errorMessage.includes('password') || errorMessage.includes('AuthenticationRequired')) {
      throw new Error('Bluesky authentication failed: Invalid identifier or password. Please check your BLUESKY_SERVICE_IDENTIFIER and BLUESKY_APP_PASSWORD. Make sure you\'re using an app password (not your account password) from Bluesky settings.');
    }
    
    console.error('Failed to authenticate with Bluesky:', error);
    throw new Error(`Bluesky authentication failed: ${errorMessage}`);
  }
}

/**
 * Check if error is a rate limit error
 */
function isRateLimitError(error: any): boolean {
  if (!error) return false;
  
  // Check for HTTP 429 status
  if (error.status === 429 || error.statusCode === 429) return true;
  
  // Check error message for rate limit indicators
  const errorMessage = error.message?.toLowerCase() || '';
  if (errorMessage.includes('rate limit') || 
      errorMessage.includes('too many requests') ||
      errorMessage.includes('429')) {
    return true;
  }
  
  return false;
}

/**
 * Extract rate limit info from error or response
 */
function extractRateLimitInfo(error: any): BlueskyRateLimitInfo {
  const info: BlueskyRateLimitInfo = {
    rateLimited: false,
  };

  if (isRateLimitError(error)) {
    info.rateLimited = true;
    
    // Try to extract rate limit headers if available
    if (error.headers) {
      const remaining = error.headers.get?.('x-ratelimit-remaining') || 
                       error.headers['x-ratelimit-remaining'];
      const limit = error.headers.get?.('x-ratelimit-limit') || 
                   error.headers['x-ratelimit-limit'];
      const reset = error.headers.get?.('x-ratelimit-reset') || 
                   error.headers['x-ratelimit-reset'];
      
      if (remaining !== undefined) info.remaining = parseInt(String(remaining));
      if (limit !== undefined) info.limit = parseInt(String(limit));
      if (reset) info.reset = reset;
    }
  }

  return info;
}

/**
 * Search for posts on Bluesky by region/keyword
 * @param query - Search query (region name or keyword)
 * @param limit - Maximum number of posts to return
 * @param useBuffer - Whether to use the post buffer (default: true)
 * @returns Array of Bluesky posts
 */
export async function searchPosts(query: string, limit: number = 50, useBuffer: boolean = true): Promise<BlueskyPost[]> {
  // Try to use post buffer first if available
  if (useBuffer) {
    try {
      const { postBuffer } = await import('./blueskyFirehose');
      if (postBuffer.isActive()) {
        const bufferedPosts = postBuffer.getPosts(query, limit);
        if (bufferedPosts.length > 0) {
          console.log(`[Search] Found ${bufferedPosts.length} posts from buffer for query: ${query}`);
          return bufferedPosts;
        }
      }
    } catch (err) {
      console.warn('[Search] Could not use post buffer, falling back to API:', err);
    }
  }

  // Fallback to API if buffer is empty or not available
  // Check rate limit throttle
  if (shouldThrottle()) {
    throw new Error('Request rate too high. Please wait a moment before trying again.');
  }

  const agent = await getAuthenticatedAgent();

  try {
    console.log(`Searching Bluesky API for: ${query} (limit: ${limit})`);
    
    // Bluesky doesn't have a direct searchPosts endpoint in @atproto/api
    // We'll use getTimeline and filter client-side, or use the searchActors method
    // For now, let's fetch timeline and filter by query text
    const response = await agent.getTimeline({
      limit: Math.min(limit * 3, 100), // Fetch more to filter down
    });

    // Log rate limit info if available in response
    if (response.headers) {
      const rateLimitRemaining = response.headers.get?.('x-ratelimit-remaining');
      const rateLimitLimit = response.headers.get?.('x-ratelimit-limit');
      const rateLimitReset = response.headers.get?.('x-ratelimit-reset');
      
      if (rateLimitRemaining !== null || rateLimitLimit !== null) {
        console.log(`Bluesky Rate Limits - Remaining: ${rateLimitRemaining || 'unknown'}/${rateLimitLimit || 'unknown'}, Reset: ${rateLimitReset || 'unknown'}`);
      }
    }

    // Filter posts that contain the query text
    const queryLower = query.toLowerCase();
    const posts: BlueskyPost[] = response.data.feed
      .map((feedItem: any) => {
        const post = feedItem.post;
        const text = post.record?.text || '';
        const createdAt = post.record?.createdAt || new Date().toISOString();
        const uri = post.uri || '';
        const cid = post.cid || '';

        return {
          text,
          source: 'bluesky' as const,
          createdAt,
          uri,
          cid,
        };
      })
      .filter((post: BlueskyPost) => {
        // Filter by query text (case-insensitive)
        return post.text.length > 0 && post.text.toLowerCase().includes(queryLower);
      })
      .slice(0, limit); // Limit results

    console.log(`Found ${posts.length} posts for query: ${query}`);
    return posts;
  } catch (error: any) {
    const rateLimitInfo = extractRateLimitInfo(error);
    
    if (rateLimitInfo.rateLimited) {
      console.error('Bluesky API rate limit exceeded:', rateLimitInfo);
      throw new Error(`Bluesky API rate limit exceeded. ${rateLimitInfo.reset ? `Resets at: ${rateLimitInfo.reset}` : 'Please try again later.'}`);
    }
    
    console.error('Error searching Bluesky posts:', error);
    throw error; // Re-throw to let caller handle
  }
}

/**
 * Fetch recent global posts from Bluesky
 * @param limit - Maximum number of posts to return
 * @param useBuffer - Whether to use the post buffer (default: true)
 * @returns Array of Bluesky posts
 */
export async function fetchRecentGlobalPosts(limit: number = 50, useBuffer: boolean = true): Promise<BlueskyPost[]> {
  // Try to use post buffer first if available
  if (useBuffer) {
    try {
      const { postBuffer } = await import('./blueskyFirehose');
      if (postBuffer.isActive()) {
        const bufferedPosts = postBuffer.getAllPosts(limit);
        if (bufferedPosts.length > 0) {
          console.log(`[Fetch] Retrieved ${bufferedPosts.length} posts from buffer`);
          return bufferedPosts;
        }
      }
    } catch (err) {
      console.warn('[Fetch] Could not use post buffer, falling back to API:', err);
    }
  }

  // Fallback to API if buffer is empty or not available
  // Check rate limit throttle
  if (shouldThrottle()) {
    throw new Error('Request rate too high. Please wait a moment before trying again.');
  }

  const agent = await getAuthenticatedAgent();

  try {
    console.log(`Fetching recent global posts from Bluesky API (limit: ${limit})`);
    
    // Try to get diverse posts by fetching from multiple popular feeds
    // First, try to get posts from "What's Hot" or popular feeds
    let posts: BlueskyPost[] = [];
    
    // Method 1: Try to get posts from popular accounts/feeds for diversity
    // We'll fetch from multiple sources and combine them
    try {
      // List of popular/active accounts to get diverse posts from
      const popularAccounts = [
        'bsky.app',
        'atproto.com', 
        'jay.bsky.social',
        'why.bsky.team',
        'pfrazee.com'
      ];
      
      // Shuffle and take a few accounts to get variety
      const shuffled = [...popularAccounts].sort(() => Math.random() - 0.5);
      const accountsToFetch = shuffled.slice(0, 3); // Fetch from 3 different accounts
      
      for (const handle of accountsToFetch) {
        try {
          const profile = await agent.getProfile({ actor: handle });
          if (profile.data?.did) {
            const authorFeed = await agent.getAuthorFeed({
              actor: profile.data.did,
              limit: Math.min(Math.ceil(limit / accountsToFetch.length), 30),
            });
            
            const feedPosts: BlueskyPost[] = authorFeed.data.feed
              .map((feedItem: any) => {
                const post = feedItem.post;
                const text = post.record?.text || '';
                const createdAt = post.record?.createdAt || new Date().toISOString();
                const uri = post.uri || '';
                const cid = post.cid || '';

                return {
                  text,
                  source: 'bluesky',
                  createdAt,
                  uri,
                  cid,
                };
              })
              .filter((post: BlueskyPost) => post.text.length > 0);
            
            posts.push(...feedPosts);
            if (posts.length >= limit * 2) break; // Get extra to shuffle later
          }
        } catch (err) {
          // Continue to next account if one fails
          console.warn(`[Fetch] Could not get posts from ${handle}:`, err instanceof Error ? err.message : String(err));
        }
      }
    } catch (err) {
      console.warn('[Fetch] Could not fetch from popular accounts, falling back to timeline');
    }
    
    // Method 2: Fallback to timeline if we don't have enough posts
    if (posts.length < limit) {
      const response = await agent.getTimeline({
        limit: Math.min(limit - posts.length, 100),
      });
      
      const timelinePosts: BlueskyPost[] = response.data.feed
        .map((feedItem: any) => {
          const post = feedItem.post;
          const text = post.record?.text || '';
          const createdAt = post.record?.createdAt || new Date().toISOString();
          const uri = post.uri || '';
          const cid = post.cid || '';

          return {
            text,
            source: 'bluesky',
            createdAt,
            uri,
            cid,
          };
        })
        .filter((post: BlueskyPost) => post.text.length > 0);
      
      // Combine and deduplicate by URI
      const existingUris = new Set(posts.map(p => p.uri));
      const newPosts = timelinePosts.filter(p => !existingUris.has(p.uri));
      posts.push(...newPosts);
      
      // Log rate limit info if available in response
      if (response.headers) {
        const rateLimitRemaining = response.headers.get?.('x-ratelimit-remaining');
        const rateLimitLimit = response.headers.get?.('x-ratelimit-limit');
        const rateLimitReset = response.headers.get?.('x-ratelimit-reset');
        
        if (rateLimitRemaining !== null || rateLimitLimit !== null) {
          console.log(`Bluesky Rate Limits - Remaining: ${rateLimitRemaining || 'unknown'}/${rateLimitLimit || 'unknown'}, Reset: ${rateLimitReset || 'unknown'}`);
        }
      }
    }

    // Shuffle and limit posts for diversity
    const shuffled = posts.sort(() => Math.random() - 0.5);
    const limited = shuffled.slice(0, limit);

    console.log(`Fetched ${limited.length} diverse posts (from ${posts.length} total)`);
    return limited;
  } catch (error: any) {
    const rateLimitInfo = extractRateLimitInfo(error);
    
    if (rateLimitInfo.rateLimited) {
      console.error('Bluesky API rate limit exceeded:', rateLimitInfo);
      throw new Error(`Bluesky API rate limit exceeded. ${rateLimitInfo.reset ? `Resets at: ${rateLimitInfo.reset}` : 'Please try again later.'}`);
    }
    
    console.error('Error fetching recent Bluesky posts:', error);
    throw error; // Re-throw to let caller handle
  }
}

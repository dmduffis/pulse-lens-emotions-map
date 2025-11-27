// =====================
// BLUESKY FIREHOSE
// =====================
// Real-time subscription to Bluesky's global feed via WebSocket
//
// This connects to the Bluesky Firehose which streams all posts in real-time.
// Useful for getting recent global posts without rate limits.

import WebSocket from 'ws';
import { readCar } from '@atproto/repo';
import { CID } from 'multiformats/cid';
import * as dagCbor from '@ipld/dag-cbor';
import { decode as cborDecode } from 'cbor';

import type { BlueskyPost } from './blueskyClient';

export interface FirehoseOptions {
  onPost?: (post: BlueskyPost) => void;
  filter?: (post: BlueskyPost) => boolean;
  maxPosts?: number;
  timeout?: number; // milliseconds
}

// =====================
// POST BUFFER
// =====================
interface BufferedPost extends BlueskyPost {
  timestamp: number; // When the post was added to buffer
}

class PostBuffer {
  private posts: BufferedPost[] = [];
  private maxSize: number = 1000; // Maximum number of posts to keep
  private maxAge: number = 60 * 60 * 1000; // 1 hour in milliseconds
  private ws: WebSocket | null = null;
  private isRunning: boolean = false;

  /**
   * Static method to get recent posts from the global buffer instance
   * @param limit - Maximum number of posts to return
   * @returns Array of recent Bluesky posts
   */
  static recent(limit: number = 50): BlueskyPost[] {
    return postBuffer.getAllPosts(limit);
  }

  /**
   * Add a post to the buffer
   */
  addPost(post: BlueskyPost): void {
    const bufferedPost: BufferedPost = {
      ...post,
      timestamp: Date.now(),
    };

    // Remove duplicates (by CID)
    this.posts = this.posts.filter(p => p.cid !== post.cid);
    
    // Add new post
    this.posts.push(bufferedPost);

    // Log buffer growth at key milestones
    if (this.posts.length === 1) {
      console.log(`[PostBuffer] ✅ First post added to buffer!`);
    } else if (this.posts.length === 10) {
      console.log(`[PostBuffer] ✅ Buffer now has 10 posts`);
    } else if (this.posts.length === 50) {
      console.log(`[PostBuffer] ✅ Buffer now has 50 posts`);
    } else if (this.posts.length === 100) {
      console.log(`[PostBuffer] ✅ Buffer now has 100 posts`);
    } else if (this.posts.length % 100 === 0) {
      console.log(`[PostBuffer] ✅ Buffer now has ${this.posts.length} posts`);
    }

    // Remove oldest posts if over limit
    if (this.posts.length > this.maxSize) {
      this.posts = this.posts.slice(-this.maxSize);
    }

    // Clean up old posts periodically
    this.cleanup();
  }

  /**
   * Remove expired posts from buffer
   */
  private cleanup(): void {
    const now = Date.now();
    this.posts = this.posts.filter(post => now - post.timestamp < this.maxAge);
  }

  /**
   * Get posts from buffer, optionally filtered by query
   */
  getPosts(query?: string, limit: number = 50): BlueskyPost[] {
    this.cleanup();
    
    let filtered = [...this.posts];

    // Filter by query if provided
    if (query) {
      const queryLower = query.toLowerCase();
      filtered = filtered.filter(post => 
        post.text.toLowerCase().includes(queryLower)
      );
    }

    // Sort by timestamp (newest first)
    filtered.sort((a, b) => b.timestamp - a.timestamp);

    // Return limited results
    return filtered.slice(0, limit).map(({ timestamp, ...post }) => post);
  }

  /**
   * Get all recent posts (no filter)
   */
  getAllPosts(limit: number = 50): BlueskyPost[] {
    this.cleanup();
    
    return this.posts
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
      .map(({ timestamp, ...post }) => post);
  }

  /**
   * Get buffer stats
   */
  getStats(): { size: number; maxSize: number; oldestPost: number | null } {
    this.cleanup();
    const oldest = this.posts.length > 0 
      ? Math.min(...this.posts.map(p => p.timestamp))
      : null;
    
    return {
      size: this.posts.length,
      maxSize: this.maxSize,
      oldestPost: oldest,
    };
  }

  /**
   * Start the firehose connection to populate the buffer
   */
  start(): void {
    if (this.isRunning) {
      console.log('[PostBuffer] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[PostBuffer] Starting firehose connection...');

    try {
      this.ws = startFirehose((post) => {
        this.addPost(post);
      });
    } catch (error) {
      console.warn('[PostBuffer] Failed to start firehose, will use API fallback:', error);
      this.isRunning = false;
      // Don't throw - API fallback will handle requests
    }
  }

  /**
   * Stop the firehose connection
   */
  stop(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isRunning = false;
    console.log('[PostBuffer] Stopped');
  }

  /**
   * Check if buffer is running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

// Global post buffer instance
const postBuffer = new PostBuffer();

// Note: Buffer is not auto-started. Use /api/start-firehose endpoint to start it.

export { postBuffer, PostBuffer };

/**
 * Parse a subscription message from the firehose
 * Bluesky firehose uses a frame protocol with CBOR-encoded messages
 * Frame format appears to have a header, then CBOR data
 */
/**
 * Parse a subscription message from the Bluesky Firehose
 * Messages are CBOR-encoded directly (no frame protocol)
 * Based on: https://davepeck.org/notes/bluesky/decoding-the-bluesky-firehose-with-zero-python-dependencies/
 */
async function parseSubscriptionMessage(data: WebSocket.Data): Promise<any> {
  const buffer = Buffer.from(data as ArrayBuffer);
  
  if (buffer.length === 0) {
    return null;
  }

  try {
    // The message is CBOR-encoded directly (0xa2 = CBOR map with 2 pairs)
    // No frame protocol - decode the entire buffer as CBOR
    // Try dagCbor first (for IPLD DAG-CBOR), fall back to standard CBOR
    let decoded: any;
    try {
      decoded = dagCbor.decode(buffer);
    } catch (dagCborError) {
      // If dagCbor fails, try standard CBOR decoder
      try {
        decoded = cborDecode(buffer);
      } catch (cborError) {
        // If both fail, try decoding as Uint8Array
        decoded = cborDecode(new Uint8Array(buffer));
      }
    }
    
    if (!decoded || typeof decoded !== 'object') {
      console.warn('[Firehose] Decoded message is not an object');
      return null;
    }
    
    // Auto-detect message type based on structure
    // Commit messages have: seq, ops, blocks, repo (or did)
    if (decoded.seq !== undefined && decoded.ops !== undefined && decoded.blocks !== undefined) {
      decoded.$type = 'com.atproto.sync.subscribeRepos#commit';
      // blocks is a Uint8Array (CAR file) - keep it for extraction
    } 
    // Info messages have: name, message
    else if (decoded.name !== undefined && decoded.message !== undefined) {
      decoded.$type = 'com.atproto.sync.subscribeRepos#info';
    } 
    // Identity messages have: did, handle
    else if (decoded.did !== undefined && decoded.handle !== undefined) {
      decoded.$type = 'com.atproto.sync.subscribeRepos#identity';
    } 
    // Account messages have: did, active
    else if (decoded.did !== undefined && decoded.active !== undefined) {
      decoded.$type = 'com.atproto.sync.subscribeRepos#account';
    }
    // Some messages might have a 'tg' (type) field indicating the message type
    else if (decoded.tg !== undefined) {
      // Map the type tag to our internal type
      if (decoded.tg === '#commit' || decoded.tg === 'commit') {
        decoded.$type = 'com.atproto.sync.subscribeRepos#commit';
      } else if (decoded.tg === '#info' || decoded.tg === 'info') {
        decoded.$type = 'com.atproto.sync.subscribeRepos#info';
      }
    }
    
    return decoded;
    
  } catch (parseError) {
    // Log detailed error information for debugging
    console.warn('[Firehose] Failed to parse message:', {
      bufferLength: buffer.length,
      firstByte: buffer[0],
      firstByteHex: `0x${buffer[0].toString(16)}`,
      firstBytes: buffer.slice(0, Math.min(50, buffer.length)).toString('hex'),
      error: parseError instanceof Error ? parseError.message : String(parseError)
    });
    return null;
  }
}

/**
 * Extract posts from Jetstream commit message (JSON format)
 * Jetstream format can be:
 * - { type: 'commit', commit: { ops: [...], blocks: {...} }, repo: '...', ... }
 * - { kind: 'commit', commit: { ops: [...], blocks: {...} }, did: '...', ... }
 * Based on: https://docs.bsky.app/docs/advanced-guides/firehose
 */
async function extractPostsFromJetstreamCommit(jetstreamMsg: any): Promise<BlueskyPost[]> {
  const posts: BlueskyPost[] = [];
  
  const commit = jetstreamMsg.commit;
  if (!commit || !commit.ops) {
    return posts;
  }

  try {
    // Jetstream provides records in different possible locations:
    // 1. commit.blocks (decoded records keyed by CID)
    // 2. blocks (top-level)
    // 3. commit.blocks might be a Map or object
    const blocks = commit.blocks || jetstreamMsg.blocks || {};
    
    // Handle both Map and plain object formats
    const getBlock = (cid: string) => {
      if (blocks instanceof Map) {
        return blocks.get(cid);
      }
      return blocks[cid];
    };
    
    for (const op of commit.ops) {
      // Only process "create" operations for posts
      if (op.action === 'create' && op.path?.startsWith('app.bsky.feed.post/') && op.cid) {
        try {
          const cidStr = typeof op.cid === 'string' ? op.cid : op.cid.toString();
          
          // Try to get the record from blocks
          let record = getBlock(cidStr);
          
          // If not found, try with different CID formats
          if (!record) {
            // Try without the leading '/'
            record = getBlock(cidStr.replace(/^\/+/, ''));
          }
          
          if (record && record.text) {
            const repo = jetstreamMsg.repo || jetstreamMsg.did || commit.repo || 'unknown';
            posts.push({
              text: record.text,
              source: 'bluesky',
              createdAt: record.createdAt || new Date().toISOString(),
              uri: `${repo}/${op.path}`,
              cid: cidStr,
            });
          }
        } catch (err) {
          // Skip posts that can't be parsed
          if (err instanceof Error && !err.message.includes('Cannot read')) {
            console.warn('[Firehose] Error parsing post from Jetstream:', err.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('[Firehose] Error extracting posts from Jetstream:', err);
    if (err instanceof Error) {
      console.error('[Firehose] Error details:', err.message);
      // Log the message structure for debugging
      console.error('[Firehose] Message structure:', {
        hasCommit: !!commit,
        hasOps: !!(commit?.ops),
        opsCount: commit?.ops?.length || 0,
        hasBlocks: !!(commit?.blocks || jetstreamMsg.blocks),
        blockKeys: commit?.blocks ? Object.keys(commit.blocks).slice(0, 3) : []
      });
    }
  }

  return posts;
}

/**
 * Extract post records from a commit message
 * Commit messages contain operations (ops) and blocks (CAR file with records)
 * Based on: https://kaskada.io/examples/bluesky.html
 */
async function extractPostsFromCommit(commit: any, blocks: Uint8Array | Buffer): Promise<BlueskyPost[]> {
  const posts: BlueskyPost[] = [];
  
  if (!commit.ops) {
    return posts; // No operations, no posts
  }

  if (!blocks) {
    // Some commits might not have blocks if they're deletes
    return posts;
  }

  try {
    // Convert blocks to Uint8Array if it's a Buffer
    const blocksArray = blocks instanceof Buffer ? new Uint8Array(blocks) : blocks;
    
    // Read the CAR (Content-Addressed Archive) file to get blocks
    const car = await readCar(blocksArray);
    const blockMap = new Map<string, Uint8Array>();
    
    // Store all blocks in a map (keyed by CID string)
    for await (const block of car.blocks()) {
      blockMap.set(block.cid.toString(), block.bytes);
    }

    // Process each operation to find post creates
    for (const op of commit.ops) {
      // Only process "create" operations for posts
      if (op.action === 'create' && op.path?.startsWith('app.bsky.feed.post/') && op.cid) {
        try {
          const cidStr = typeof op.cid === 'string' ? op.cid : op.cid.toString();
          const blockBytes = blockMap.get(cidStr);
          
          if (blockBytes) {
            // Decode the CBOR-encoded record (CAR blocks use IPLD DAG-CBOR)
            const record = dagCbor.decode(blockBytes);
            
            if (record && record.text) {
              posts.push({
                text: record.text,
                source: 'bluesky',
                createdAt: record.createdAt || new Date().toISOString(),
                uri: `${commit.repo || commit.did}/${op.path}`,
                cid: cidStr,
              });
            }
          }
        } catch (err) {
          // Skip posts that can't be parsed (common for non-post records)
          // Only log if it's unexpected
          if (err instanceof Error && !err.message.includes('decode')) {
            console.warn('[Firehose] Error parsing post record:', err.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('[Firehose] Error reading CAR file:', err);
    if (err instanceof Error) {
      console.error('[Firehose] CAR error details:', err.message);
    }
  }

  return posts;
}

/**
 * Start listening to the Bluesky Firehose and collect posts
 * @param options - Configuration options
 * @returns Promise that resolves with collected posts
 */
export function collectPostsFromFirehose(
  options: FirehoseOptions = {}
): Promise<BlueskyPost[]> {
  const { filter, maxPosts = 50, timeout = 10000 } = options;
  const posts: BlueskyPost[] = [];
  let ws: WebSocket | null = null;
  let timeoutId: NodeJS.Timeout | null = null;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      if (ws) {
        ws.removeAllListeners();
        ws.close();
        ws = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    // Set timeout to stop collecting after specified duration
    timeoutId = setTimeout(() => {
      cleanup();
      console.log(`[Firehose] Collected ${posts.length} posts (timeout reached)`);
      resolve(posts);
    }, timeout);

    // Use Jetstream instead of raw firehose - it outputs JSON, much easier to parse
    ws = new WebSocket('wss://jetstream1.us-east.bsky.network');

    ws.on('open', () => {
      console.log('[Firehose] Connected to Bluesky Firehose');
    });

    ws.on('message', async (data: WebSocket.Data) => {
      try {
        // Jetstream sends JSON messages
        const msg = JSON.parse(data.toString());
        
        // Jetstream format: { type: 'commit', commit: { ... }, repo: '...', ... }
        if (msg.type === 'commit' && msg.commit && msg.commit.ops) {
          const extractedPosts = await extractPostsFromJetstreamCommit(msg);
          
          for (const post of extractedPosts) {
            // Apply filter if provided
            if (!filter || filter(post)) {
              posts.push(post);
              
              // Call onPost callback if provided
              if (options.onPost) {
                options.onPost(post);
              }

              // Check if we've collected enough posts
              if (posts.length >= maxPosts) {
                cleanup();
                console.log(`[Firehose] Collected ${posts.length} posts (limit reached)`);
                resolve(posts);
                return;
              }
            }
          }
        }
      } catch (err) {
        console.error('[Firehose] Error parsing message:', err);
        // Don't reject on parse errors, just log them
      }
    });

    ws.on('error', (error) => {
      console.error('[Firehose] WebSocket error:', error);
      cleanup();
      reject(error);
    });

    ws.on('close', () => {
      console.log('[Firehose] Connection closed');
      cleanup();
      // Resolve with whatever posts we collected
      resolve(posts);
    });
  });
}

/**
 * Start a persistent Firehose connection (for long-running processes)
 * Uses Jetstream - Bluesky's simplified firehose that outputs JSON instead of CBOR
 * Official endpoint: https://docs.bsky.app/docs/advanced-guides/firehose
 * @param onPost - Callback for each new post
 */
// Track if we've logged commit structure (module-level, not instance)
let hasLoggedCommitStructure = false;

export function startFirehose(onPost: (post: BlueskyPost) => void): WebSocket {
  // Use Jetstream - outputs JSON, much simpler than parsing CBOR
  // Official endpoint from: https://docs.bsky.app/docs/advanced-guides/firehose
  // Try without wantedCollections filter - it might be preventing commits from coming through
  // We'll filter for posts client-side instead
  const ws = new WebSocket('wss://jetstream2.us-east.bsky.network/subscribe');

  ws.on('open', () => {
    console.log('[Firehose] ✅ Connected to Bluesky Jetstream (JSON format)');
    console.log('[Firehose] Waiting for posts to stream in...');
  });

  ws.on('message', async (data: WebSocket.Data) => {
    try {
      // Jetstream sends JSON messages directly (no CBOR parsing needed)
      const msg = JSON.parse(data.toString());
      
      // Jetstream format can be either:
      // 1. { type: 'commit', commit: {...}, ... }
      // 2. { kind: 'commit', commit: {...}, did: '...', time_us: ..., ... }
      const messageType = msg.type || msg.kind;
      const commit = msg.commit;
      
      // Debug: Log first commit message structure to understand format
      if (messageType === 'commit' && !hasLoggedCommitStructure) {
        console.log('[Firehose] 🔍 First commit message received! Structure:', {
          hasCommit: !!commit,
          hasOps: !!(commit?.ops),
          opsCount: commit?.ops?.length || 0,
          hasBlocks: !!(commit?.blocks || msg.blocks),
          commitKeys: commit ? Object.keys(commit).slice(0, 10) : [],
          msgKeys: Object.keys(msg).slice(0, 10),
          sampleOp: commit?.ops?.[0] || null
        });
        hasLoggedCommitStructure = true;
      }
      
      if (messageType === 'commit' && commit) {
        // Jetstream commit format has two possible structures:
        // 1. Old format: commit.ops (array of operations)
        // 2. New format: commit.operation (single operation) + commit.record (the record data)
        
        if (commit.ops && Array.isArray(commit.ops)) {
          // Old format with ops array
          const opsCount = commit.ops.length;
          const postOps = commit.ops.filter((op: any) => op.path?.startsWith('app.bsky.feed.post/'));
          
          if (postOps.length > 0) {
            console.log(`[Firehose] 📝 Commit with ${postOps.length} post operation(s) (total ops: ${opsCount})`);
          }
          
          // Extract posts from the commit
          const extractedPosts = await extractPostsFromJetstreamCommit({
            type: messageType,
            commit: commit,
            repo: msg.repo || msg.did,
            blocks: msg.blocks || commit.blocks
          });
          
          if (extractedPosts.length > 0) {
            console.log(`[Firehose] ✅ Extracted ${extractedPosts.length} post(s) from commit (repo: ${msg.repo || msg.did || 'unknown'})`);
          }
          
          for (const post of extractedPosts) {
            onPost(post);
          }
        } else if (commit.operation && commit.collection === 'app.bsky.feed.post' && commit.record) {
          // New format: single operation with record directly in commit
          if (commit.operation === 'create' && commit.record.text) {
            const post: BlueskyPost = {
              text: commit.record.text,
              source: 'bluesky',
              createdAt: commit.record.createdAt || new Date().toISOString(),
              uri: `at://${msg.did}/${commit.collection}/${commit.rkey}`,
              cid: commit.cid || '',
            };
            
            // Only log every 10th post to reduce spam (posts are coming in fast!)
            const shouldLog = Math.random() < 0.1; // 10% chance
            if (shouldLog) {
              console.log(`[Firehose] ✅ Extracted 1 post from commit (repo: ${msg.did || 'unknown'})`);
            }
            onPost(post);
          } else if (commit.operation === 'create' && !commit.record.text) {
            // Post without text (might be a reply or other type)
            // Skip silently
          }
        } else if (commit.collection === 'app.bsky.feed.post') {
          // Post collection but might be delete or other operation
          if (commit.operation !== 'create') {
            // Skip deletes and other operations silently
            return;
          }
        }
      } else if (messageType === 'info' || msg.message) {
        console.log(`[Firehose] ℹ️  Info message: ${msg.message || JSON.stringify(msg)}`);
      } else if (messageType) {
        // Log other message types less frequently (every 10th message)
        // This reduces spam from account/identity messages
        const shouldLog = Math.random() < 0.1; // 10% chance
        if (shouldLog && messageType !== 'commit') {
          console.log(`[Firehose] Received message kind/type: ${messageType} (showing 10% of non-commit messages)`);
        }
      } else {
        // Unknown message format - log first time for debugging
        console.warn('[Firehose] ⚠️  Received message with unknown format:', Object.keys(msg).slice(0, 5).join(', '));
      }
    } catch (err) {
      // Check if it's a JSON parse error (might be binary data)
      if (err instanceof SyntaxError) {
        console.warn('[Firehose] ⚠️  Received non-JSON message (might be binary):', data instanceof Buffer ? `${data.length} bytes` : typeof data);
      } else {
        console.error('[Firehose] ❌ Error parsing Jetstream message:', err);
        if (err instanceof Error) {
          console.error('[Firehose] Error details:', err.message);
        }
      }
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[Firehose] ⚠️  Connection closed (code: ${code}, reason: ${reason?.toString() || 'none'}). Reconnecting in 5 seconds...`);
    // Wait longer before reconnecting to avoid rapid reconnection loops
    setTimeout(() => {
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        console.log('[Firehose] 🔄 Attempting to reconnect...');
        startFirehose(onPost);
      }
    }, 5000);
  });

  ws.on('error', (error) => {
    console.error('[Firehose] ❌ WebSocket error:', error);
    // If connection fails, log but don't crash - API fallback will handle requests
    if (error instanceof Error) {
      if (error.message.includes('Unexpected server response')) {
        console.warn('[Firehose] ⚠️  Jetstream connection failed - check endpoint URL. API fallback will be used.');
      } else {
        console.error('[Firehose] Error message:', error.message);
      }
    }
  });

  return ws;
}

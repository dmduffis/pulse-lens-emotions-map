import { postBuffer } from "@/utils/blueskyFirehose";
import { NextResponse } from "next/server";

export async function GET() {
  const stats = postBuffer.getStats();
  const isActive = postBuffer.isActive();
  
  if (!isActive) {
    // Start the firehose connection (this will populate the buffer)
    console.log('[API] Starting Firehose connection...');
    postBuffer.start();
    
    // Give it a moment to connect
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const newStats = postBuffer.getStats();
    console.log('[API] Firehose started via /api/start-firehose endpoint');
    console.log(`[API] Buffer status: ${newStats.size} posts, active: ${postBuffer.isActive()}`);
    
    return NextResponse.json({ 
      ok: true, 
      started: true,
      message: 'Firehose connection started',
      bufferStats: newStats,
      wasAlreadyRunning: false
    });
  }
  
  console.log(`[API] Firehose status check: ${stats.size} posts, active: ${isActive}`);
  
  return NextResponse.json({ 
    ok: true, 
    started: true,
    message: 'Firehose already running',
    bufferStats: stats,
    wasAlreadyRunning: true
  });
}


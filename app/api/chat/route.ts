import { NextRequest, NextResponse } from 'next/server';

// =====================
// TYPES
// =====================
interface EmotionsSummary {
  anger: number;
  sadness: number;
  fear: number;
  joy: number;
  hope: number;
  neutral: number;
}

interface TopTweet {
  text: string;
  emotion: string;
}

interface ChatRequest {
  question: string;
  emotionsSummary: EmotionsSummary;
  topTweets: TopTweet[];
  region: string;
}

interface ChatResponse {
  answer: string;
}

interface ChatErrorResponse {
  error: string;
  details?: string;
}

// =====================
// MAIN POST HANDLER
// =====================
export async function POST(request: NextRequest) {
  try {
    // =====================
    // STEP 1 — INPUT VALIDATION
    // =====================
    const body: ChatRequest = await request.json();
    const { question, emotionsSummary, topTweets, region } = body;

    // Validate question exists
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return NextResponse.json(
        { error: 'Chat processing failed', details: 'Missing or invalid question' },
        { status: 400 }
      );
    }

    // Validate OPENAI_API_KEY
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: 'Chat processing failed', details: 'OPENAI_API_KEY is not configured' },
        { status: 500 }
      );
    }

    // Validate emotionsSummary
    if (!emotionsSummary || typeof emotionsSummary !== 'object') {
      return NextResponse.json(
        { error: 'Chat processing failed', details: 'Missing or invalid emotionsSummary' },
        { status: 400 }
      );
    }

    // Validate region
    if (!region || typeof region !== 'string') {
      return NextResponse.json(
        { error: 'Chat processing failed', details: 'Missing or invalid region' },
        { status: 400 }
      );
    }

    // Validate topTweets (optional but if provided should be array)
    const tweets = Array.isArray(topTweets) ? topTweets.slice(0, 10) : [];

    // =====================
    // STEP 2 — CONSTRUCT PROMPT
    // =====================
    const systemMessage = `You are PulseLens, an assistant that helps interpret emotional data from regions around the world. 

You are NOT opinionated. You do NOT speculate unless data suggests it.

Your job is to help users understand emotional trends, generate insights when asked, and brainstorm opportunities.

IMPORTANT: When answering questions, you MUST:
- Reference specific tweets by number (e.g., "Tweet #3 shows...")
- Include direct quotes from tweets to support your analysis
- Use concrete examples from the provided tweets
- Show the connection between the emotional summary and actual tweet content

Always stay neutral and do not invent facts.`;

    // Build user message with structured data
    const userMessage = `Question: ${question.trim()}

Region: ${region}

Emotional Summary:
${JSON.stringify(emotionsSummary, null, 2)}

Sample Tweets (${tweets.length} total):
${tweets.length > 0 
  ? tweets.map((tweet, idx) => {
      const tweetNum = idx + 1;
      const emotion = tweet.emotion;
      const text = tweet.text.replace(/"/g, '\\"').replace(/\n/g, ' ').substring(0, 250);
      return `Tweet #${tweetNum} [${emotion}]: "${text}"`;
    }).join('\n\n')
  : 'No sample tweets provided'
}

Instructions:
- ALWAYS reference specific tweets by number (e.g., "Tweet #5 demonstrates...", "As seen in Tweet #2...")
- INCLUDE direct quotes from tweets to support your points
- Use concrete examples: "For instance, Tweet #3 shows joy: 'This is amazing! I'm so happy...'"
- Connect the emotional summary numbers to actual tweet examples
- If asked about specific emotions, cite tweets that demonstrate those emotions
- Give clear, structured insights with evidence from the tweets
- If insufficient data, say so
- Never hallucinate events
- Never claim something "happened" unless it's in the tweet text
- Focus on emotional interpretation with supporting evidence`;

    // =====================
    // STEP 3 — CALL OPENAI API
    // =====================
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Using gpt-4o-mini for cost efficiency
        messages: [
          {
            role: 'system',
            content: systemMessage,
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
        temperature: 0.7, // Balanced creativity and consistency
        max_tokens: 1000, // Sufficient for detailed responses
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API Error:', errorText);
      return NextResponse.json(
        { 
          error: 'Chat processing failed',
          details: `OpenAI API error: ${response.status}` 
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content;

    if (!answer) {
      return NextResponse.json(
        { 
          error: 'Chat processing failed',
          details: 'No response from OpenAI' 
        },
        { status: 500 }
      );
    }

    // =====================
    // STEP 4 — RETURN RESPONSE
    // =====================
    const chatResponse: ChatResponse = {
      answer: answer.trim(),
    };

    return NextResponse.json(chatResponse);

  } catch (error) {
    console.error('Error in chat API route:', error);
    
    const errorResponse: ChatErrorResponse = {
      error: 'Chat processing failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    };

    return NextResponse.json(
      errorResponse,
      { status: 500 }
    );
  }
}


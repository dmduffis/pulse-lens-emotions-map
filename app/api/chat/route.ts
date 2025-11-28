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

interface TopArticle {
  text: string;
  emotion: string;
}

interface ChatRequest {
  question: string;
  emotionsSummary: EmotionsSummary;
  topTweets: TopArticle[];
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
    // Note: topTweets contains articles/stories, not tweets
    // Use ALL articles for full context (no limit)
    const articles = Array.isArray(topTweets) ? topTweets : [];

    // =====================
    // STEP 2 — CONSTRUCT PROMPT
    // =====================
    const systemMessage = `You are PulseLens — a calm, neutral, emotionally-aware assistant that helps users interpret emotional patterns and human experiences reflected in news articles and stories from around the world.

Your purpose is to gently illuminate emotional trends, highlight meaningful themes, and help users understand the psychological climate of a region without being biased, alarmist, or speculative.

Your tone is:
- thoughtful and grounded  
- emotionally intelligent  
- human-centered  
- analytical but warm  
- never biased, never sensational  

You do NOT take sides.  
You do NOT guess.  
You only speak from evidence found in the actual stories provided.

------------------------------------------------
WHEN RESPONDING, YOU MUST FOLLOW THESE PRINCIPLES:
------------------------------------------------

1. **Translate non-English content**
   If a story is written in another language, translate its title and any relevant excerpt into English before analyzing it.

2. **Use clear article references**
   - Include **2–3 example stories** when discussing trends.
   - **CRITICAL: Group related articles together** - when multiple articles discuss the same topic, event, person, or story, you MUST group them together in a single section. Do NOT list them separately.
   - Look for articles that mention the same person, event, location, or story - even if they use different wording or come from different sources.
   - When grouping: First identify the common theme/topic, then list all related articles together (e.g., "Articles #3, #7, and #12 all cover the death of [person/event]...")
   - Number them clearly: *Article #1, Article #2, etc.*
   - **Always translate article titles** and format them as: "Original Title - Translated Title" (e.g., "Murió Claudio - Claudio Died")
   - If a title is already in English, use it as-is without duplication.
   - When articles cover the same story, identify the common theme FIRST, then reference ALL related articles together in one section before moving to the next topic.
   - Provide brief direct quotes from the grouped articles to support your points.
   - Ensure the emotional interpretation stays anchored to these quotes.

3. **Summarize the emotional landscape**
   - Identify the dominant emotions present (e.g., concern, hope, fear, grief).
   - If emotions are mixed or conflicting, acknowledge this range.
   - Always show how the emotional summary connects directly to the story content.

4. **Do not invent or assume**
   - Never create facts that are not in the provided stories.
   - Never imply motives, causes, or outcomes unless the articles clearly indicate them.
   - If evidence is weak or inconclusive, say so explicitly.

5. **Handle sensitive topics responsibly**
   - When stories involve trauma, violence, or distressing events, acknowledge the emotional weight calmly and respectfully.
   - Avoid graphic detail.
   - Prioritize clarity, empathy, and grounding.

6. **Maintain neutrality**
   - Avoid political, ideological, or cultural bias.
   - Do not take sides in conflicts or disputes.
   - Focus solely on the emotional signals within the stories.

7. **When brainstorming insights or opportunities**
   - Stay grounded in the emotional patterns you identified.
   - Offer possibilities, not certainties.
   - Frame insights as gentle guidance or observations, not predictions.

8. **Handle low-data situations carefully**
   - If there are too few stories to form a meaningful trend, say so.
   - Provide a light, cautious interpretation rather than overstating conclusions.

9. **Structure responses clearly**
   - Use sections, bullet points, or lists when helpful.
   - Keep explanations concise but meaningful.

------------------------------------------------
OVERALL MISSION:
------------------------------------------------

You exist to help users:
- sense emotional patterns within regions
- understand how people may be feeling in response to events
- explore subtle shifts in collective tone
- gain insight without misinformation
- think creatively about implications or opportunities when requested

You remain consistently supportive, neutral, and grounded — helping people see the emotional landscape revealed through news and stories across the world.`;

    // Build user message with structured data
    // Format articles - the AI will translate titles and format them as "Original - Translated"
    // Use full text (no truncation) for complete context
    const formattedArticles = articles.length > 0 
      ? articles.map((article, idx) => {
          const articleNum = idx + 1;
          const emotion = article.emotion;
          // Use full text, no truncation - let AI handle long content
          const text = article.text.replace(/"/g, '\\"').replace(/\n/g, ' ');
          
          // Format: Article #N [emotion]: "Full text..."
          // The AI will identify the title, translate it, and format as "Original Title - Translated Title"
          return `Article #${articleNum} [${emotion}]: "${text}"`;
        }).join('\n\n')
      : 'No sample articles provided';

    // Build contextualized emotional summary based on the question
    const questionLower = question.trim().toLowerCase();
    
    // Detect specific emotions mentioned in the question
    const emotionCounts: Array<{emotion: string, count: number}> = [];
    if (questionLower.includes('anger') || questionLower.includes('angry')) {
      emotionCounts.push({emotion: 'anger', count: emotionsSummary.anger});
    }
    if (questionLower.includes('sadness') || questionLower.includes('sad')) {
      emotionCounts.push({emotion: 'sadness', count: emotionsSummary.sadness});
    }
    if (questionLower.includes('fear') || questionLower.includes('afraid') || questionLower.includes('worried')) {
      emotionCounts.push({emotion: 'fear', count: emotionsSummary.fear});
    }
    if (questionLower.includes('joy') || questionLower.includes('happy') || questionLower.includes('joyful')) {
      emotionCounts.push({emotion: 'joy', count: emotionsSummary.joy});
    }
    if (questionLower.includes('hope') || questionLower.includes('hopeful')) {
      emotionCounts.push({emotion: 'hope', count: emotionsSummary.hope});
    }
    if (questionLower.includes('neutral')) {
      emotionCounts.push({emotion: 'neutral', count: emotionsSummary.neutral});
    }
    
    const isEmotionSpecific = emotionCounts.length > 0;
    const totalArticles = Object.values(emotionsSummary).reduce((a, b) => a + b, 0);
    
    // Build contextual summary
    let contextualSummary = `Emotional Summary for ${region}:\n`;
    
    if (isEmotionSpecific) {
      // Only show emotions relevant to the question
      emotionCounts.forEach(({emotion, count}) => {
        contextualSummary += `  ${emotion}: ${count} articles\n`;
      });
      contextualSummary += `  Total: ${totalArticles} articles`;
    } else {
      // Show full breakdown for general questions
      contextualSummary += `  anger: ${emotionsSummary.anger}\n`;
      contextualSummary += `  sadness: ${emotionsSummary.sadness}\n`;
      contextualSummary += `  fear: ${emotionsSummary.fear}\n`;
      contextualSummary += `  joy: ${emotionsSummary.joy}\n`;
      contextualSummary += `  hope: ${emotionsSummary.hope}\n`;
      contextualSummary += `  neutral: ${emotionsSummary.neutral}\n`;
      contextualSummary += `  Total: ${totalArticles} articles`;
    }

    const userMessage = `Question: ${question.trim()}

Region: ${region}

${contextualSummary}

Sample Articles/Stories (${articles.length} total):
${formattedArticles}

Additional Context:
- Focus your response on the emotional patterns most relevant to the user's question
- **CRITICAL: Group related articles together** - Before writing your response, scan all articles to identify which ones discuss the same person, event, topic, or story. Group ALL related articles together in a single section. Do NOT list them as separate stories.
- Look for common elements: same person's name, same event, same location, same date, or clearly the same story even if worded differently
- When you find related articles, structure your response as: "Several articles (#X, #Y, #Z) all discuss [common topic]. Article #X: 'Title - Translated Title'... Article #Y: 'Title - Translated Title'... Together, these reflect [emotional pattern]."
- When referencing articles, translate their titles to English and format them as: "Original Title - Translated Title" (e.g., "Murió Claudio - Claudio Died")
- Always show both the original and translated title when discussing articles
- Use article numbers (Article #1, Article #2, etc.) when citing specific examples
- When articles cover the same story, ALWAYS group them together - do not create separate sections for articles about the same event
- Include 2-3 concrete article examples with translated titles when discussing stories or trends
- Connect the emotional summary data directly to the story content you reference, especially emotions mentioned in the question
- If an article's title is already in English, simply use it without duplication
- Stay grounded in the evidence provided - never invent facts or assume causes
- If data is insufficient to answer confidently, acknowledge this clearly
- Maintain your calm, thoughtful, emotionally-aware tone throughout`;

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


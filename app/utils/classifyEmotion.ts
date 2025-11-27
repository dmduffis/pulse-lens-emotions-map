// =====================
// EMOTION CLASSIFICATION UTILITY
// =====================

export type Emotion = 'anger' | 'sadness' | 'fear' | 'joy' | 'hope' | 'neutral';

export interface EmotionResult {
  emotion: Emotion;
  confidence: number;
}

/**
 * Classifies the emotion of a given text using OpenAI API
 * @param text - The text to classify
 * @returns Promise with emotion and confidence score
 */
export async function classifyEmotion(text: string): Promise<EmotionResult> {
  // Handle empty or very short text
  if (!text || text.trim().length < 3) {
    return {
      emotion: 'neutral',
      confidence: 1.0,
    };
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;

  if (!openaiApiKey) {
    console.warn('OPENAI_API_KEY not configured, returning neutral emotion');
    return {
      emotion: 'neutral',
      confidence: 0.5,
    };
  }

  try {
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
            content: `You are an emotion classification system. Analyze the given text and classify it into ONE of these emotions: anger, sadness, fear, joy, hope, or neutral.

Rules:
- Output ONLY valid JSON, no additional text or commentary
- The JSON must have this exact structure: {"emotion": "one_of_the_emotions", "confidence": 0.0_to_1.0}
- Confidence should be a number between 0 and 1
- Choose the emotion that best represents the overall sentiment
- If the text is ambiguous or lacks clear emotion, use "neutral"
- Valid emotions are: anger, sadness, fear, joy, hope, neutral`,
          },
          {
            role: 'user',
            content: `Classify this text: "${text}"`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3, // Lower temperature for more consistent classification
        max_tokens: 50, // Minimal tokens needed for JSON response
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API Error:', errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    // Parse the JSON response
    const result = JSON.parse(content) as { emotion?: string; confidence?: number };

    // Validate emotion is one of the allowed values
    const validEmotions: Emotion[] = ['anger', 'sadness', 'fear', 'joy', 'hope', 'neutral'];
    const emotion = validEmotions.includes(result.emotion as Emotion)
      ? (result.emotion as Emotion)
      : 'neutral';

    // Validate and clamp confidence to 0-1 range
    const confidence = Math.max(0, Math.min(1, result.confidence ?? 0.5));

    return {
      emotion,
      confidence,
    };
  } catch (error) {
    console.error('Error classifying emotion:', error);
    // Return neutral on error to not break the flow
    return {
      emotion: 'neutral',
      confidence: 0.5,
    };
  }
}

/**
 * Classifies emotions for multiple texts in parallel
 * @param texts - Array of texts to classify
 * @returns Promise with array of emotion results
 */
export async function classifyEmotionsBatch(
  texts: string[]
): Promise<EmotionResult[]> {
  // Use Promise.all for parallel processing
  return Promise.all(texts.map(text => classifyEmotion(text)));
}

/**
 * Generates an emotion summary from an array of emotion results
 * @param emotions - Array of emotion results
 * @returns Object with counts for each emotion
 */
export function generateEmotionsSummary(emotions: EmotionResult[]): Record<Emotion, number> {
  const summary: Record<Emotion, number> = {
    anger: 0,
    sadness: 0,
    fear: 0,
    joy: 0,
    hope: 0,
    neutral: 0,
  };

  emotions.forEach(({ emotion }) => {
    if (emotion in summary) {
      summary[emotion]++;
    }
  });

  return summary;
}


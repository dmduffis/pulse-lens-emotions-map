import type { TweetData } from './loadDataset';

// =====================
// MOCK DATA GENERATOR
// =====================
/**
 * Generates mock tweet data with diverse emotions for testing
 * This creates a balanced distribution of all emotions
 * Returns data in the same format as loadDataset
 */
export async function generateMockData(regionCenter: { lat: number; lon: number }, count: number = 100): Promise<TweetData[]> {
  const emotions: Array<'anger' | 'sadness' | 'fear' | 'joy' | 'hope' | 'neutral'> = [
    'anger', 'sadness', 'fear', 'joy', 'hope', 'neutral'
  ];

  // Create mock tweets with diverse emotions
  const mockTweets = [];
  const emotionsPerType = Math.ceil(count / emotions.length);

  for (let i = 0; i < count; i++) {
    const emotionIndex = Math.floor(i / emotionsPerType) % emotions.length;
    const emotion = emotions[emotionIndex];
    
    // Generate mock tweet text based on emotion
    const mockTexts = {
      anger: [
        "This is absolutely unacceptable! How can they do this?",
        "I'm so frustrated with this situation right now.",
        "This makes me really angry and upset.",
        "Why is this happening? This is terrible!",
        "I can't believe this is allowed to happen."
      ],
      sadness: [
        "This is really heartbreaking to see.",
        "I feel so sad about what happened here.",
        "This situation is really depressing.",
        "It's so sad to see things like this.",
        "This makes me feel really down."
      ],
      fear: [
        "I'm really worried about what might happen next.",
        "This situation is quite scary and concerning.",
        "I'm afraid of what could come from this.",
        "This is really frightening to think about.",
        "I'm concerned about the implications."
      ],
      joy: [
        "This is amazing! I'm so happy about this!",
        "What great news! This makes me smile.",
        "I'm thrilled to see this happening!",
        "This is wonderful and exciting!",
        "I'm so glad this is working out!"
      ],
      hope: [
        "I'm hopeful that things will get better soon.",
        "This gives me hope for the future.",
        "I believe we can overcome this together.",
        "There's a light at the end of the tunnel.",
        "I'm optimistic about what's coming next."
      ],
      neutral: [
        "This is an interesting development.",
        "I see what's happening here.",
        "This is a factual observation about the situation.",
        "Here's some information about this topic.",
        "This is worth noting."
      ]
    };

    const texts = mockTexts[emotion];
    const text = texts[i % texts.length];

    // Add random jitter to coordinates
    const lat = regionCenter.lat + (Math.random() - 0.5) * 0.02;
    const lon = regionCenter.lon + (Math.random() - 0.5) * 0.02;

    mockTweets.push({
      text,
      lat,
      lon,
      source: 'mock',
      source_file: 'mock_data.csv',
    });
  }

  return mockTweets;
}



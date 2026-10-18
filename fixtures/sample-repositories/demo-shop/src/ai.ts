import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function summarize(text: string) {
  // Modern SDK usage: not affected by the seeded OpenAI events.
  return client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: `Summarize: ${text}` }],
  });
}

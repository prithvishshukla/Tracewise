import type { AffectedItem } from '@tracewise/shared';
import { AffectedItemSchema } from '@tracewise/shared';
import { z } from 'zod';

/** Optional AI-assisted extraction of affected symbols from public changelog text. Never receives repository code. */
export interface ExtractionProvider {
  readonly name: string;
  extractAffected(input: { title: string; text: string; providerRoots: string[] }): Promise<AffectedItem[]>;
}

export class NoopExtractionProvider implements ExtractionProvider {
  readonly name = 'none';
  async extractAffected(): Promise<AffectedItem[]> {
    return [];
  }
}

export interface OpenAICompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const ResponseShape = z.object({ affected: z.array(AffectedItemSchema) });

/** Works with any OpenAI-compatible chat-completions endpoint. Output is validated with zod; failures return []. */
export class OpenAICompatibleExtractionProvider implements ExtractionProvider {
  readonly name = 'openai_compatible';
  constructor(private opts: OpenAICompatibleOptions) {}

  async extractAffected(input: { title: string; text: string; providerRoots: string[] }): Promise<AffectedItem[]> {
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f(`${this.opts.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000),
      body: JSON.stringify({
        model: this.opts.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Extract SDK symbols and HTTP endpoints affected by a deprecation or breaking change. Reply with JSON: {"affected":[{"kind":"sdk_symbol","symbol":"root.a.b"} | {"kind":"endpoint","method":"POST","path":"/v1/x"}]}. Use only information present in the text. Known SDK roots: ' +
              input.providerRoots.join(', '),
          },
          { role: 'user', content: `${input.title}\n\n${input.text}`.slice(0, 6000) },
        ],
      }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    try {
      return ResponseShape.parse(JSON.parse(json.choices?.[0]?.message?.content ?? '{}')).affected;
    } catch {
      return [];
    }
  }
}

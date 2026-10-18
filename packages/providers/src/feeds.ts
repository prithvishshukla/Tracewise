import { XMLParser } from 'fast-xml-parser';
import { classifyText, extractAffected, extractDate } from './classify';
import { fingerprintOf } from './hash';
import type { ExtractionProvider } from './extraction';
import type { NormalizedChange, SourceInfo } from './types';

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  summary: string;
  publishedAt: Date | null;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', processEntities: true });

const text = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object') return text((v as Record<string, unknown>)['#text']);
  return '';
};
const stripHtml = (s: string) =>
  s
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const arr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Parses RSS 2.0 or Atom into items. Throws on documents that are neither. */
export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as Record<string, any>;
  if (doc.rss?.channel) {
    return arr<any>(doc.rss.channel.item).map((it) => ({
      id: text(it.guid) || text(it.link) || text(it.title),
      title: stripHtml(text(it.title)),
      link: text(it.link),
      summary: stripHtml(text(it.description) || text(it['content:encoded'])),
      publishedAt: toDate(text(it.pubDate)),
    }));
  }
  if (doc.feed) {
    return arr<any>(doc.feed.entry).map((e) => {
      const links = arr<any>(e.link);
      const href = (links.find((l) => l['@_rel'] === 'alternate') ?? links[0])?.['@_href'] ?? '';
      return {
        id: text(e.id) || href || text(e.title),
        title: stripHtml(text(e.title)),
        link: href,
        summary: stripHtml(text(e.content) || text(e.summary)),
        publishedAt: toDate(text(e.updated) || text(e.published)),
      };
    });
  }
  throw new Error('Document is not a recognizable RSS or Atom feed');
}

function toDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface FeedContext {
  source: SourceInfo;
  providerRoots: string[];
  extractor?: ExtractionProvider;
}

/**
 * Converts feed items into change events. Only items whose text indicates a deprecation, removal or
 * breaking change are kept; routine releases are ignored. Confidence is deliberately modest because the
 * classification is keyword-based; `affected` is only filled when code spans or endpoints are present.
 */
export async function feedItemsToChanges(items: FeedItem[], ctx: FeedContext): Promise<NormalizedChange[]> {
  const out: NormalizedChange[] = [];
  for (const it of items) {
    const blob = `${it.title}. ${it.summary}`.slice(0, 4000);
    const cls = classifyText(blob);
    if (!cls) continue;
    let affected = extractAffected(`${it.title} ${it.summary}`, ctx.providerRoots);
    let method: NormalizedChange['detectionMethod'] = 'feed_keyword';
    let confidence = cls.confidence;
    if (ctx.extractor && affected.length === 0) {
      const extra = await ctx.extractor
        .extractAffected({ title: it.title, text: it.summary, providerRoots: ctx.providerRoots })
        .catch(() => []);
      if (extra.length) {
        affected = extra;
        method = 'llm_assisted';
        confidence = Math.min(confidence, 0.6);
      }
    }
    out.push({
      fingerprint: fingerprintOf('feed', ctx.source.providerSlug, ctx.source.url, it.id),
      title: it.title.slice(0, 300),
      summary: (it.summary || it.title).slice(0, 1500),
      changeType: cls.changeType,
      severity: cls.severity,
      affected,
      effectiveAt: extractDate(blob),
      publishedAt: it.publishedAt,
      sourceUrl: it.link || ctx.source.url,
      detectionMethod: method,
      confidence,
      evidence: [{ type: 'source_quote', label: 'Matched feed entry', detail: it.title.slice(0, 200), url: it.link || undefined }],
      origin: ctx.source.origin,
      remediation: null,
    });
  }
  return out;
}

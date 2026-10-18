import type { ExtractionProvider } from './extraction';
import { feedItemsToChanges, parseFeed } from './feeds';
import { parseFixtureEvents } from './fixtures';
import { deserializeSpec, diffSpecs, normalizeOpenApi, serializeSpec, specChangesToEvents } from './openapi';
import type { NormalizedChange, SourceInfo } from './types';

/** What gets stored as the snapshot content for a source: OpenAPI specs are stored normalized, others raw. */
export function snapshotContent(kind: SourceInfo['kind'], raw: string): string {
  return kind === 'openapi' ? serializeSpec(normalizeOpenApi(raw)) : raw;
}

export interface ProcessOptions {
  providerRoots: string[];
  extractor?: ExtractionProvider;
}

/**
 * Interprets stored snapshot content as zero or more normalized changes.
 * For OpenAPI sources a previous snapshot is required to produce a diff; without one the snapshot is a baseline.
 */
export async function interpretSnapshot(
  source: SourceInfo,
  content: string,
  previousContent: string | null,
  opts: ProcessOptions,
): Promise<NormalizedChange[]> {
  switch (source.kind) {
    case 'fixture_events':
      return parseFixtureEvents(content, source);
    case 'rss':
    case 'atom':
      return feedItemsToChanges(parseFeed(content), { source, providerRoots: opts.providerRoots, extractor: opts.extractor });
    case 'openapi':
      if (!previousContent) return [];
      return specChangesToEvents(diffSpecs(deserializeSpec(previousContent), deserializeSpec(content)), source);
  }
}

import { parse as parseYaml } from 'yaml';
import type { AffectedItem } from '@tracewise/shared';
import { fingerprintOf, stableStringify } from './hash';
import type { NormalizedChange, SourceInfo } from './types';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

export interface NormalizedParam {
  in: string;
  name: string;
  required: boolean;
  enum: string[];
}
export interface NormalizedOperation {
  deprecated: boolean;
  params: NormalizedParam[];
  responses: string[];
}
export interface NormalizedSpec {
  title: string;
  operations: Record<string, NormalizedOperation>;
}

/**
 * Reduces an OpenAPI 3.x document (JSON or YAML) to the subset Tracewise compares:
 * operations, deprecation flags, parameters (location, name, required, enum) and response codes.
 * Unsupported: $ref resolution, request-body schemas, schema property diffs, Swagger 2.0 `definitions`.
 */
export function normalizeOpenApi(raw: string): NormalizedSpec {
  let doc: any;
  try {
    doc = JSON.parse(raw);
  } catch {
    doc = parseYaml(raw);
  }
  if (!doc || typeof doc !== 'object' || typeof doc.paths !== 'object') throw new Error('Not an OpenAPI document (missing "paths")');
  const operations: Record<string, NormalizedOperation> = {};
  for (const [path, item] of Object.entries<any>(doc.paths)) {
    if (!item || typeof item !== 'object') continue;
    const shared: any[] = Array.isArray(item.parameters) ? item.parameters : [];
    for (const m of METHODS) {
      const op = item[m];
      if (!op || typeof op !== 'object') continue;
      const params = [...shared, ...(Array.isArray(op.parameters) ? op.parameters : [])]
        .filter((p) => p && typeof p === 'object' && typeof p.name === 'string')
        .map((p): NormalizedParam => ({
          in: String(p.in ?? 'query'),
          name: p.name,
          required: p.required === true || p.in === 'path',
          enum: Array.isArray(p.schema?.enum) ? p.schema.enum.map(String).sort() : [],
        }))
        .sort((a, b) => `${a.in}:${a.name}`.localeCompare(`${b.in}:${b.name}`));
      operations[`${m.toUpperCase()} ${path}`] = {
        deprecated: op.deprecated === true,
        params,
        responses: Object.keys(op.responses ?? {}).sort(),
      };
    }
  }
  return { title: String(doc.info?.title ?? ''), operations };
}

export const serializeSpec = (s: NormalizedSpec) => stableStringify(s);
export const deserializeSpec = (s: string): NormalizedSpec => JSON.parse(s) as NormalizedSpec;

export interface SpecChange {
  opKey: string;
  kind:
    | 'operation_removed'
    | 'operation_deprecated'
    | 'required_param_added'
    | 'param_became_required'
    | 'enum_value_removed'
    | 'param_removed';
  detail: string;
  changeType: NormalizedChange['changeType'];
  severity: NormalizedChange['severity'];
  confidence: number;
}

export function diffSpecs(prev: NormalizedSpec, next: NormalizedSpec): SpecChange[] {
  const out: SpecChange[] = [];
  for (const [key, before] of Object.entries(prev.operations)) {
    const after = next.operations[key];
    if (!after) {
      out.push({
        opKey: key,
        kind: 'operation_removed',
        detail: 'removed from the spec',
        changeType: 'breaking',
        severity: 'high',
        confidence: 0.9,
      });
      continue;
    }
    if (!before.deprecated && after.deprecated) {
      out.push({
        opKey: key,
        kind: 'operation_deprecated',
        detail: 'now marked deprecated',
        changeType: 'deprecation',
        severity: 'medium',
        confidence: 0.9,
      });
    }
    const pk = (p: NormalizedParam) => `${p.in}:${p.name}`;
    const beforeMap = new Map(before.params.map((p) => [pk(p), p]));
    for (const p of after.params) {
      const old = beforeMap.get(pk(p));
      if (!old && p.required)
        out.push({
          opKey: key,
          kind: 'required_param_added',
          detail: `new required ${p.in} parameter "${p.name}"`,
          changeType: 'breaking',
          severity: 'high',
          confidence: 0.9,
        });
      else if (old && !old.required && p.required)
        out.push({
          opKey: key,
          kind: 'param_became_required',
          detail: `${p.in} parameter "${p.name}" is now required`,
          changeType: 'breaking',
          severity: 'high',
          confidence: 0.9,
        });
      if (old) {
        const removed = old.enum.filter((v) => !p.enum.includes(v));
        if (removed.length && p.enum.length)
          out.push({
            opKey: key,
            kind: 'enum_value_removed',
            detail: `parameter "${p.name}" no longer accepts: ${removed.join(', ')}`,
            changeType: 'breaking',
            severity: 'medium',
            confidence: 0.85,
          });
      }
    }
    const afterKeys = new Set(after.params.map(pk));
    for (const p of before.params)
      if (!afterKeys.has(pk(p)))
        out.push({
          opKey: key,
          kind: 'param_removed',
          detail: `${p.in} parameter "${p.name}" removed`,
          changeType: 'warning',
          severity: 'low',
          confidence: 0.8,
        });
  }
  return out;
}

export function specChangesToEvents(changes: SpecChange[], source: SourceInfo): NormalizedChange[] {
  return changes.map((c) => {
    const [method, ...rest] = c.opKey.split(' ');
    const path = rest.join(' ');
    const affected: AffectedItem[] = [{ kind: 'endpoint', method, path }];
    return {
      fingerprint: fingerprintOf('openapi', source.providerSlug, source.url, c.opKey, c.kind, c.detail),
      title: `${c.opKey}: ${c.detail}`,
      summary: `OpenAPI comparison detected that operation ${c.opKey} ${c.detail}.`,
      changeType: c.changeType,
      severity: c.severity,
      affected,
      effectiveAt: null,
      publishedAt: null,
      sourceUrl: source.url,
      detectionMethod: 'openapi_diff' as const,
      confidence: c.confidence,
      evidence: [{ type: 'openapi_diff' as const, label: 'Structural diff between snapshots', detail: `${c.opKey} ${c.detail}` }],
      origin: source.origin,
      remediation: null,
    };
  });
}

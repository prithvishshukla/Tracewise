import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Language, Parser, type Node } from 'web-tree-sitter';
import type { DetectedCallSite } from '../types';
import { type BoundSdk, type ProviderIndex } from '../provider-index';
import { findHostInString, SiteCollector } from './common';

const require = createRequire(import.meta.url);

interface PyImport {
  line: number;
  module: string;
  names: { name: string; alias?: string }[] | null;
  alias?: string;
}
interface PyAssign {
  line: number;
  target: string;
  root: string;
  segs: (string | null)[];
}
interface PyCall {
  line: number;
  root: string;
  segs: (string | null)[];
}
interface PyParam {
  name: string;
  typeName: string;
}
interface Extracted {
  imports: PyImport[];
  assigns: PyAssign[];
  calls: PyCall[];
  params: PyParam[];
}

let parserPromise: Promise<Parser | null> | null = null;
async function getParser(): Promise<Parser | null> {
  parserPromise ??= (async () => {
    try {
      await Parser.init();
      const wasm = require.resolve('tree-sitter-wasms/out/tree-sitter-python.wasm');
      const lang = await Language.load(fs.readFileSync(wasm));
      const p = new Parser();
      p.setLanguage(lang);
      return p;
    } catch {
      return null;
    }
  })();
  return parserPromise;
}

export async function pythonParserAvailable(): Promise<boolean> {
  return (await getParser()) !== null;
}

type Chain = { root: string; segs: (string | null)[] };

const kids = (n: Node): Node[] => n.namedChildren.filter((c): c is Node => c !== null);

function chainPy(node: Node | null): Chain | null {
  const segs: (string | null)[] = [];
  let cur: Node | null = node;
  while (cur) {
    if (cur.type === 'attribute') {
      segs.unshift(cur.childForFieldName('attribute')?.text ?? null);
      cur = cur.childForFieldName('object');
    } else if (cur.type === 'subscript') {
      const sub = cur.childForFieldName('subscript');
      segs.unshift(sub?.type === 'string' ? sub.text.replace(/^[rbuf]*["']+|["']+$/gi, '') : null);
      cur = cur.childForFieldName('value');
    } else if (cur.type === 'parenthesized_expression') cur = cur.namedChild(0);
    else break;
  }
  if (cur?.type !== 'identifier') return null;
  if (cur.text === 'self' && typeof segs[0] === 'string') return { root: 'self.' + (segs.shift() as string), segs };
  return { root: cur.text, segs };
}

function extractTreeSitter(parser: Parser, text: string): Extracted | null {
  const tree = parser.parse(text);
  if (!tree) return null;
  const ex: Extracted = { imports: [], assigns: [], calls: [], params: [] };
  const walk = (n: Node) => {
    const line = n.startPosition.row + 1;
    switch (n.type) {
      case 'import_statement':
        for (const c of kids(n)) {
          if (c.type === 'dotted_name') ex.imports.push({ line, module: c.text, names: null });
          else if (c.type === 'aliased_import')
            ex.imports.push({
              line,
              module: c.childForFieldName('name')?.text ?? '',
              names: null,
              alias: c.childForFieldName('alias')?.text,
            });
        }
        break;
      case 'import_from_statement': {
        const mod = n.childForFieldName('module_name')?.text ?? '';
        const names = n
          .childrenForFieldName('name')
          .filter((c): c is Node => c !== null)
          .map((c) =>
            c.type === 'aliased_import'
              ? { name: c.childForFieldName('name')?.text ?? '', alias: c.childForFieldName('alias')?.text }
              : { name: c.text },
          );
        ex.imports.push({ line, module: mod, names });
        break;
      }
      case 'assignment': {
        const left = n.childForFieldName('left');
        const right = n.childForFieldName('right');
        const target = left ? chainPy(left) : null;
        if (right?.type === 'call' && target && target.segs.length === 0) {
          const fn = chainPy(right.childForFieldName('function'));
          if (fn) ex.assigns.push({ line, target: target.root, root: fn.root, segs: fn.segs });
        }
        break;
      }
      case 'typed_parameter':
      case 'typed_default_parameter': {
        const nameNode = n.childForFieldName('name') ?? n.namedChild(0);
        const typeNode = n.childForFieldName('type');
        if (nameNode?.type === 'identifier' && typeNode)
          ex.params.push({ name: nameNode.text, typeName: typeNode.text.split('.')[0] ?? '' });
        break;
      }
      case 'call': {
        const c = chainPy(n.childForFieldName('function'));
        if (c) ex.calls.push({ line, ...c });
        break;
      }
    }
    for (const c of kids(n)) walk(c);
  };
  walk(tree.rootNode);
  tree.delete();
  return ex;
}

function extractRegex(text: string): Extracted {
  const ex: Extracted = { imports: [], assigns: [], calls: [], params: [] };
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const l = raw.replace(/#.*$/, '');
    let m: RegExpExecArray | null;
    if ((m = /^\s*import\s+([\w.]+)(?:\s+as\s+(\w+))?\s*$/.exec(l)))
      ex.imports.push({ line, module: m[1] ?? '', names: null, alias: m[2] });
    else if ((m = /^\s*from\s+([\w.]+)\s+import\s+\(?([^)]+)\)?\s*$/.exec(l))) {
      const names = (m[2] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const [name, alias] = s.split(/\s+as\s+/);
          return { name: name ?? s, alias };
        });
      ex.imports.push({ line, module: m[1] ?? '', names });
    }
    if ((m = /^\s*(self\.\w+|\w+)\s*(?::[^=]+)?=\s*([A-Za-z_][\w.]*)\s*\(/.exec(l))) {
      const parts = (m[2] ?? '').split('.');
      ex.assigns.push({ line, target: m[1] ?? '', root: parts[0] ?? '', segs: parts.slice(1) });
    }
    for (const p of l.matchAll(/(\w+)\s*:\s*([A-Za-z_][\w.]*)\s*[,)=]/g))
      if (/def\s/.test(l)) ex.params.push({ name: p[1] ?? '', typeName: (p[2] ?? '').split('.')[0] ?? '' });
    for (const c of l.matchAll(/(?<![\w.])((?:self\.)?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)\s*\(/g)) {
      const parts = (c[1] ?? '').split('.');
      if (parts[0] === 'self') ex.calls.push({ line, root: `self.${parts[1]}`, segs: parts.slice(2) });
      else ex.calls.push({ line, root: parts[0] ?? '', segs: parts.slice(1) });
    }
  });
  return ex;
}

const IGNORED_ROOTS = new Set([
  'print',
  'os',
  'sys',
  'json',
  're',
  'logging',
  'logger',
  'time',
  'datetime',
  'asyncio',
  'math',
  'random',
  'pytest',
  'unittest',
  'str',
  'dict',
  'list',
]);
const HTTP_LIB = /\b(requests|httpx|aiohttp|session|client|urlopen|urllib3?|http)\b/;

type Binding = { kind: 'module' | 'factory' | 'client' | 'member'; sdk: BoundSdk; prefix?: string[] };

export async function analyzePython(
  text: string,
  filePath: string,
  fileHash: string,
  idx: ProviderIndex,
  opts: { forceRegex?: boolean } = {},
): Promise<{ callSites: DetectedCallSite[]; providers: Set<string>; method: 'tree_sitter' | 'regex_fallback' }> {
  const parser = opts.forceRegex ? null : await getParser();
  let ex = parser ? extractTreeSitter(parser, text) : null;
  const method = ex ? 'tree_sitter' : 'regex_fallback';
  ex ??= extractRegex(text);
  const lines = text.split(/\r?\n/);
  const out = new SiteCollector({ filePath, fileHash }, lines);
  const providers = new Set<string>();
  const bindings = new Map<string, Binding>();
  const matchModule = (m: string) => idx.pyModules.find((b) => b.modules.some((x) => m === x || m.startsWith(x + '.')));

  for (const imp of ex.imports) {
    const sdk = matchModule(imp.module);
    if (!sdk) continue;
    providers.add(sdk.providerSlug);
    out.add({
      providerSlug: sdk.providerSlug,
      line: imp.line,
      symbol: sdk.root,
      kind: 'sdk_import',
      detectionMethod: method,
      confidence: 0.99,
      resolved: true,
      metadata: { module: imp.module, ecosystem: 'pypi' },
    });
    if (imp.names === null) bindings.set(imp.alias ?? imp.module.split('.')[0] ?? imp.module, { kind: 'module', sdk });
    else
      for (const n of imp.names)
        bindings.set(
          n.alias ?? n.name,
          sdk.factories.includes(n.name) ? { kind: 'factory', sdk } : { kind: 'member', sdk, prefix: [n.name] },
        );
  }
  const initSdk = (root: string, segs: (string | null)[]): BoundSdk | undefined => {
    const b = bindings.get(root);
    if (!b) return undefined;
    if (segs.length === 0 && (b.kind === 'factory' || b.kind === 'module')) return b.sdk;
    if (segs.length === 1 && b.kind === 'module' && b.sdk.factories.includes(segs[0] ?? '')) return b.sdk;
    return undefined;
  };
  for (const a of ex.assigns) {
    const sdk = initSdk(a.root, a.segs);
    if (sdk) bindings.set(a.target, { kind: 'client', sdk });
  }
  for (const p of ex.params) {
    const b = bindings.get(p.typeName);
    if (b && b.kind !== 'client') bindings.set(p.name, { kind: 'client', sdk: b.sdk });
  }

  for (const c of ex.calls) {
    const b = bindings.get(c.root);
    const dyn = c.segs.findIndex((s) => s === null);
    if (b && b.kind !== 'factory') {
      const prefix = b.prefix ?? [];
      if (b.kind === 'member' || c.segs.length > 0) {
        if (dyn === -1) {
          out.add({
            providerSlug: b.sdk.providerSlug,
            line: c.line,
            symbol: [b.sdk.root, ...prefix, ...(c.segs as string[])].join('.'),
            kind: 'sdk_call',
            detectionMethod: method,
            confidence: 0.95,
            resolved: true,
            metadata: { receiver: c.root, ecosystem: 'pypi' },
          });
        } else {
          const pre = [b.sdk.root, ...prefix, ...(c.segs.slice(0, dyn) as string[])].join('.');
          out.add({
            providerSlug: b.sdk.providerSlug,
            line: c.line,
            symbol: `${pre}.<dynamic>`,
            kind: 'dynamic_call',
            detectionMethod: method,
            confidence: 0.3,
            resolved: false,
            metadata: { dynamicPrefix: pre, receiver: c.root, ecosystem: 'pypi' },
          });
        }
      }
    } else if (!b && c.segs.length >= 2 && dyn === -1 && !IGNORED_ROOTS.has(c.root)) {
      for (const slug of providers) {
        const root = idx.rootsByProvider.get(slug);
        if (root)
          out.add({
            providerSlug: slug,
            line: c.line,
            symbol: `${root}.${(c.segs as string[]).join('.')}`,
            kind: 'sdk_call',
            detectionMethod: method,
            confidence: 0.4,
            resolved: false,
            metadata: { receiver: c.root, unresolvedReceiver: true, ecosystem: 'pypi' },
          });
      }
    }
  }

  // Raw HTTP to provider hosts (line-based; documented limitation: no data-flow through variables).
  lines.forEach((raw, i) => {
    const l = raw.trim();
    if (l.startsWith('#')) return;
    const normalized = raw.replace(/\{[^{}]*\}/g, '{}');
    const hit = findHostInString(normalized, idx.hosts);
    if (!hit) return;
    providers.add(hit.providerSlug);
    const verb = /\.(get|post|put|patch|delete|head)\s*\(/i.exec(raw)?.[1] ?? /\.request\(\s*["'](\w+)["']/i.exec(raw)?.[1];
    const isCall = HTTP_LIB.test(raw) && Boolean(verb);
    out.add(
      {
        providerSlug: hit.providerSlug,
        line: i + 1,
        symbol: `${verb ? verb.toUpperCase() + ' ' : ''}${hit.host}${hit.path}`,
        kind: isCall ? 'http_call' : 'endpoint_literal',
        detectionMethod: method,
        confidence: isCall ? 0.9 : 0.7,
        resolved: true,
        metadata: {
          method: verb?.toUpperCase(),
          methodKnown: Boolean(verb),
          host: hit.host,
          pathTemplate: hit.path,
          urlTemplate: `https://${hit.host}${hit.path}`,
        },
      },
      normalized,
    );
  });

  return { callSites: out.sites, providers, method };
}

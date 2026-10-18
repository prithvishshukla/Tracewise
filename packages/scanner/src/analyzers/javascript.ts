import ts from 'typescript';
import type { DetectedCallSite } from '../types';
import { npmPackageName, providerForHost, type BoundSdk, type ProviderIndex } from '../provider-index';
import { findHostInString, parseUrlParts, SiteCollector } from './common';

type Binding = { kind: 'module' | 'factory' | 'client'; sdk: BoundSdk };

const HTTP_ROOTS = new Set(['axios', 'got', 'ky', 'request', 'superagent', 'needle', 'undici', 'http', 'https']);
const HTTP_FUNCS = new Set(['fetch', 'axios', 'got', 'ky', 'request']);
const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request']);
const ROUTE_RE = /^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\/\S*)/;
const IGNORED_ROOTS = new Set([
  'console',
  'JSON',
  'Math',
  'Object',
  'Array',
  'Promise',
  'process',
  'window',
  'document',
  'res',
  'req',
  'app',
  'router',
  'fs',
  'path',
  'Buffer',
  'String',
  'Number',
  'Date',
  'Reflect',
  'Symbol',
  'expect',
  'it',
  'describe',
  'jest',
  'vi',
]);

function scriptKind(path: string): ts.ScriptKind {
  if (/\.tsx$/i.test(path)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(path)) return ts.ScriptKind.JSX;
  if (/\.(ts|mts|cts)$/i.test(path)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

export function analyzeJavaScript(
  text: string,
  filePath: string,
  fileHash: string,
  idx: ProviderIndex,
): { callSites: DetectedCallSite[]; providers: Set<string> } {
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind(filePath));
  const lines = text.split(/\r?\n/);
  const out = new SiteCollector({ filePath, fileHash }, lines);
  const bindings = new Map<string, Binding>();
  const consts = new Map<string, string>();
  const constNodes = new Map<string, ts.Node[]>();
  let touched: ts.Node[] = [];
  const providers = new Set<string>();
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const visit = (node: ts.Node, fn: (n: ts.Node) => boolean | void) => {
    if (fn(node) === false) return;
    ts.forEachChild(node, (c) => visit(c, fn));
  };
  const unwrap = (e: ts.Node): ts.Node => {
    let cur = e;
    while (
      ts.isParenthesizedExpression(cur) ||
      ts.isNonNullExpression(cur) ||
      ts.isAsExpression(cur) ||
      ts.isAwaitExpression(cur) ||
      ts.isSatisfiesExpression(cur)
    )
      cur = cur.expression;
    return cur;
  };

  // ---- pass 1: imports, requires, string constants -------------------------------------------
  const importSite = (sdk: BoundSdk, node: ts.Node, mod: string) => {
    providers.add(sdk.providerSlug);
    out.add({
      providerSlug: sdk.providerSlug,
      line: lineOf(node),
      symbol: sdk.root,
      kind: 'sdk_import',
      detectionMethod: 'typescript_ast',
      confidence: 0.99,
      resolved: true,
      metadata: { module: mod, ecosystem: 'npm' },
    });
  };
  const bindNamed = (sdk: BoundSdk, imported: string, local: string) => {
    if (sdk.factories.includes(imported)) bindings.set(local, { kind: 'factory', sdk });
  };

  visit(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const mod = n.moduleSpecifier.text;
      const sdk = idx.jsModules.get(npmPackageName(mod));
      if (!sdk) return;
      importSite(sdk, n, mod);
      const clause = n.importClause;
      if (clause?.name) bindings.set(clause.name.text, { kind: 'module', sdk });
      const nb = clause?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) bindings.set(nb.name.text, { kind: 'module', sdk });
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) bindNamed(sdk, (el.propertyName ?? el.name).text, el.name.text);
      return;
    }
    if (
      ts.isImportEqualsDeclaration(n) &&
      ts.isExternalModuleReference(n.moduleReference) &&
      ts.isStringLiteral(n.moduleReference.expression)
    ) {
      const mod = n.moduleReference.expression.text;
      const sdk = idx.jsModules.get(npmPackageName(mod));
      if (sdk) {
        importSite(sdk, n, mod);
        bindings.set(n.name.text, { kind: 'module', sdk });
      }
      return;
    }
    if (ts.isVariableDeclaration(n) && n.initializer) {
      const init = unwrap(n.initializer);
      // require('pkg') / require('pkg').Name
      let req: ts.CallExpression | undefined;
      let member: string | undefined;
      if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'require') req = init;
      else if (
        ts.isPropertyAccessExpression(init) &&
        ts.isCallExpression(init.expression) &&
        ts.isIdentifier(init.expression.expression) &&
        init.expression.expression.text === 'require'
      ) {
        req = init.expression;
        member = init.name.text;
      }
      const arg = req?.arguments[0];
      if (req && arg && ts.isStringLiteralLike(arg)) {
        const sdk = idx.jsModules.get(npmPackageName(arg.text));
        if (sdk) {
          importSite(sdk, n, arg.text);
          if (ts.isIdentifier(n.name)) {
            if (member && sdk.factories.includes(member)) bindings.set(n.name.text, { kind: 'factory', sdk });
            else bindings.set(n.name.text, { kind: 'module', sdk });
          } else if (ts.isObjectBindingPattern(n.name)) {
            for (const el of n.name.elements)
              if (ts.isIdentifier(el.name))
                bindNamed(sdk, (el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName : el.name).text, el.name.text);
          }
        }
      }
      if (ts.isIdentifier(n.name) && n.parent.flags & ts.NodeFlags.Const && ts.isVariableDeclarationList(n.parent)) {
        touched = [];
        const v = evalString(n.initializer);
        if (v !== undefined) {
          consts.set(n.name.text, v);
          constNodes.set(n.name.text, [n.initializer, ...touched]);
        }
      }
    }
  });

  function evalString(node: ts.Node): string | undefined {
    const n = unwrap(node);
    if (ts.isStringLiteralLike(n)) return n.text;
    if (ts.isTemplateExpression(n)) {
      let s = n.head.text;
      for (const span of n.templateSpans) s += (evalString(span.expression) ?? '{}') + span.literal.text;
      return s;
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const l = evalString(n.left);
      const r = evalString(n.right);
      if (l === undefined && r === undefined) return undefined;
      return (l ?? '{}') + (r ?? '{}');
    }
    if (ts.isIdentifier(n)) {
      const v = consts.get(n.text);
      const node = constNodes.get(n.text);
      if (v !== undefined && node) touched.push(...node);
      return v;
    }
    return undefined;
  }

  // ---- pass 2: client bindings -----------------------------------------------------------------
  const sdkOfInit = (init: ts.Node): BoundSdk | undefined => {
    const e = unwrap(init);
    if ((ts.isNewExpression(e) || ts.isCallExpression(e)) && ts.isIdentifier(e.expression)) {
      const b = bindings.get(e.expression.text);
      if (b && (b.kind === 'module' || b.kind === 'factory')) return b.sdk;
    }
    // new Ns.default(...) / new Ns.Stripe(...): constructor reached through a namespace or module member.
    if (
      (ts.isNewExpression(e) || ts.isCallExpression(e)) &&
      ts.isPropertyAccessExpression(e.expression) &&
      ts.isIdentifier(e.expression.expression)
    ) {
      const b = bindings.get(e.expression.expression.text);
      const member = e.expression.name.text;
      if (b && b.kind === 'module' && (member === 'default' || b.sdk.factories.includes(member))) return b.sdk;
    }
    return undefined;
  };
  const sdkOfType = (t: ts.TypeNode | undefined): BoundSdk | undefined => {
    if (!t || !ts.isTypeReferenceNode(t)) return undefined;
    const name = ts.isIdentifier(t.typeName)
      ? t.typeName
      : ts.isQualifiedName(t.typeName) && ts.isIdentifier(t.typeName.left)
        ? t.typeName.left
        : undefined;
    const b = name ? bindings.get(name.text) : undefined;
    return b && b.kind !== 'client' ? b.sdk : undefined;
  };
  const targetKey = (t: ts.Node): string | undefined => {
    if (ts.isIdentifier(t)) return t.text;
    if (ts.isPropertyAccessExpression(t) && t.expression.kind === ts.SyntaxKind.ThisKeyword) return 'this.' + t.name.text;
    return undefined;
  };
  visit(sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      const sdk = (n.initializer && sdkOfInit(n.initializer)) ?? sdkOfType(n.type);
      if (sdk) bindings.set(n.name.text, { kind: 'client', sdk });
    } else if (ts.isPropertyDeclaration(n) && ts.isIdentifier(n.name)) {
      const sdk = (n.initializer && sdkOfInit(n.initializer)) ?? sdkOfType(n.type);
      if (sdk) bindings.set('this.' + n.name.text, { kind: 'client', sdk });
    } else if (ts.isParameter(n) && ts.isIdentifier(n.name)) {
      const sdk = sdkOfType(n.type);
      if (sdk) {
        bindings.set(n.name.text, { kind: 'client', sdk });
        if (ts.getModifiers(n)?.length) bindings.set('this.' + n.name.text, { kind: 'client', sdk });
      }
    } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const key = targetKey(n.left);
      const sdk = key ? sdkOfInit(n.right) : undefined;
      if (key && sdk) bindings.set(key, { kind: 'client', sdk });
    }
  });

  // ---- pass 3: call sites ------------------------------------------------------------------------
  type Chain = { root: string; segs: (string | null)[] };
  const chainOf = (expr: ts.Node): Chain | null => {
    const segs: (string | null)[] = [];
    let cur: ts.Node = expr;
    for (;;) {
      if (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur) || ts.isAsExpression(cur)) cur = cur.expression;
      else if (ts.isPropertyAccessExpression(cur)) {
        segs.unshift(cur.name.text);
        cur = cur.expression;
      } else if (ts.isElementAccessExpression(cur)) {
        const a = cur.argumentExpression;
        segs.unshift(a && ts.isStringLiteralLike(a) ? a.text : null);
        cur = cur.expression;
      } else break;
    }
    if (ts.isIdentifier(cur)) return { root: cur.text, segs };
    if (cur.kind === ts.SyntaxKind.ThisKeyword && typeof segs[0] === 'string') {
      const first = segs.shift() as string;
      return { root: 'this.' + first, segs };
    }
    return null;
  };

  const hostHits = new Set<string>();
  const consumed = new WeakSet<ts.Node>();
  const consume = (n: ts.Node) =>
    visit(n, (c) => {
      consumed.add(c);
    });
  let pathLiteralCount = 0;
  const pending: { node: ts.Node; line: number }[] = [];

  const recordUrl = (
    urlNode: ts.Node,
    method: string | undefined,
    methodKnown: boolean,
    kind: 'http_call' | 'endpoint_literal',
    line: number,
    confidence: number,
  ) => {
    touched = [];
    const value = evalString(urlNode);
    if (!value) return false;
    const hit = findHostInString(value, idx.hosts);
    if (!hit) return false;
    for (const t of touched) consume(t);
    providers.add(hit.providerSlug);
    hostHits.add(hit.providerSlug);
    out.add(
      {
        providerSlug: hit.providerSlug,
        line,
        symbol: `${method ? method.toUpperCase() + ' ' : ''}${hit.host}${hit.path}`,
        kind,
        detectionMethod: 'typescript_ast',
        confidence,
        resolved: true,
        metadata: { method: method?.toUpperCase(), methodKnown, host: hit.host, pathTemplate: hit.path, urlTemplate: value },
      },
      value,
    );
    consume(urlNode);
    return true;
  };
  const stringProp = (obj: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined => {
    for (const p of obj.properties)
      if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === key)
        return p.initializer;
    return undefined;
  };

  visit(sf, (n) => {
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const callee = n.expression;
      const args = n.arguments ? Array.from(n.arguments) : [];
      const line = lineOf(n);
      const chain = chainOf(callee);

      // 1. SDK calls
      if (chain) {
        const b = bindings.get(chain.root);
        const isCtorViaMember =
          ts.isNewExpression(n) &&
          b?.kind === 'module' &&
          chain.segs.length === 1 &&
          (chain.segs[0] === 'default' || b.sdk.factories.includes(chain.segs[0] as string));
        if (b && b.kind !== 'factory' && chain.segs.length > 0 && !isCtorViaMember) {
          const firstDyn = chain.segs.findIndex((s) => s === null);
          if (firstDyn === -1) {
            const symbol = `${b.sdk.root}.${chain.segs.join('.')}`;
            out.add({
              providerSlug: b.sdk.providerSlug,
              line,
              symbol,
              kind: 'sdk_call',
              detectionMethod: 'typescript_ast',
              confidence: 0.95,
              resolved: true,
              metadata: { receiver: chain.root, ecosystem: 'npm' },
            });
            const first = args[0];
            if (first && ts.isStringLiteralLike(first) && chain.segs[chain.segs.length - 1] === 'request') {
              const m = ROUTE_RE.exec(first.text);
              if (m)
                out.add({
                  providerSlug: b.sdk.providerSlug,
                  line,
                  symbol: `${m[1]} ${m[2]}`,
                  kind: 'http_call',
                  detectionMethod: 'typescript_ast',
                  confidence: 0.9,
                  resolved: true,
                  metadata: { method: m[1], methodKnown: true, pathTemplate: m[2], viaSdkRequest: true },
                });
            }
          } else {
            const prefix = [b.sdk.root, ...(chain.segs.slice(0, firstDyn) as string[])].join('.');
            out.add({
              providerSlug: b.sdk.providerSlug,
              line,
              symbol: `${prefix}.<dynamic>`,
              kind: 'dynamic_call',
              detectionMethod: 'typescript_ast',
              confidence: 0.3,
              resolved: false,
              metadata: { dynamicPrefix: prefix, receiver: chain.root, ecosystem: 'npm' },
            });
          }
        } else if (!b && chain.segs.length >= 2 && !IGNORED_ROOTS.has(chain.root) && !chain.segs.includes(null)) {
          // Unresolved receiver in a file that imports a provider SDK: keep as low-confidence candidate.
          for (const slug of providers) {
            const root = idx.rootsByProvider.get(slug);
            if (root)
              out.add({
                providerSlug: slug,
                line,
                symbol: `${root}.${chain.segs.join('.')}`,
                kind: 'sdk_call',
                detectionMethod: 'typescript_ast',
                confidence: 0.4,
                resolved: false,
                metadata: { receiver: chain.root, unresolvedReceiver: true, ecosystem: 'npm' },
              });
          }
        }
      }

      // 2. raw HTTP calls
      const rootName = chain?.root;
      const verb = chain && chain.segs.length === 1 && typeof chain.segs[0] === 'string' ? chain.segs[0] : undefined;
      const isHttpFunc = ts.isCallExpression(n) && ts.isIdentifier(callee) && HTTP_FUNCS.has(callee.text);
      const isHttpMember = ts.isCallExpression(n) && rootName && HTTP_ROOTS.has(rootName) && verb && VERBS.has(verb);
      if (isHttpFunc || isHttpMember) {
        const first = args[0];
        const second = args[1];
        let urlNode: ts.Node | undefined = first;
        let method: string | undefined = isHttpMember && verb !== 'request' ? verb : undefined;
        let known = Boolean(method);
        const optsNode =
          first && ts.isObjectLiteralExpression(first) ? first : second && ts.isObjectLiteralExpression(second) ? second : undefined;
        if (first && ts.isObjectLiteralExpression(first)) urlNode = stringProp(first, 'url');
        if (optsNode) {
          const m = stringProp(optsNode, 'method');
          if (m && ts.isStringLiteralLike(m)) {
            method = m.text;
            known = true;
          } else if (m) known = false;
          else if (!method && ts.isIdentifier(callee) && callee.text === 'fetch') {
            method = 'GET';
            known = true;
          }
        } else if (!method && ts.isIdentifier(callee) && callee.text === 'fetch') {
          method = 'GET';
          known = true;
        }
        if (urlNode && recordUrl(urlNode, method, known, 'http_call', line, 0.9)) return;
        // path-only literal on a non-resolved HTTP-like receiver, e.g. api.get('/v1/charges')
      }
      if (
        ts.isCallExpression(n) &&
        chain &&
        verb &&
        ['get', 'post', 'put', 'patch', 'delete'].includes(verb) &&
        !bindings.has(chain.root)
      ) {
        const first = args[0];
        const v = first ? evalString(first) : undefined;
        if (v && v.startsWith('/') && v.length > 3 && pathLiteralCount < 50 && !v.includes(' ')) {
          pathLiteralCount++;
          for (const slug of providers)
            out.add(
              {
                providerSlug: slug,
                line,
                symbol: `${verb.toUpperCase()} ${v}`,
                kind: 'endpoint_literal',
                detectionMethod: 'typescript_ast',
                confidence: 0.6,
                resolved: false,
                metadata: { method: verb.toUpperCase(), methodKnown: true, pathTemplate: v, receiver: chain.root },
              },
              v,
            );
        }
      }
      return;
    }

    // 3. provider-host string literals outside recognised HTTP calls
    const isStr =
      ts.isStringLiteralLike(n) ||
      ts.isTemplateExpression(n) ||
      (ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.PlusToken &&
        !(n.parent && ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken));
    if (isStr && !consumed.has(n) && !ts.isImportDeclaration(n.parent) && !ts.isLiteralTypeNode(n.parent)) {
      const v = evalString(n);
      if (v && findHostInString(v, idx.hosts)) {
        pending.push({ node: n, line: lineOf(n) });
        return false;
      }
    }
  });
  // Literals are recorded after the walk so a later HTTP call that uses them (via a const) can claim them first.
  for (const p of pending) if (!consumed.has(p.node)) recordUrl(p.node, undefined, false, 'endpoint_literal', p.line, 0.7);

  return { callSites: out.sites, providers };
}

export { parseUrlParts, providerForHost };

import { describe, expect, it } from 'vitest';
import { analyzePython, pythonParserAvailable } from '../src';
import { idx } from './helpers';

const code = `import os
import openai
from openai import OpenAI
import requests
import stripe as st
from twilio.rest import Client

openai.api_key = os.environ["K"]
client = OpenAI()

class Svc:
    def __init__(self):
        self.tw = Client("a", "b")

    def go(self, prompt):
        a = openai.ChatCompletion.create(model="x")
        b = client.chat.completions.create(model="y")
        c = self.tw.messages.create(to="1")
        d = st.Charge.create(amount=1)
        return requests.post("https://api.stripe.com/v1/charges", data={})

def dyn(name):
    return getattr(client, name)()
    return client.images[name]()
`;

describe.each([
  ['tree_sitter', false],
  ['regex_fallback', true],
] as const)('Python analysis (%s)', (method, force) => {
  it('is available', async () => {
    if (method === 'tree_sitter') expect(await pythonParserAvailable()).toBe(true);
  });

  it('resolves module aliases, clients and attribute clients with line numbers', async () => {
    const r = await analyzePython(code, 'svc.py', 'h', idx, { forceRegex: force });
    expect(r.method).toBe(method);
    const calls = r.callSites.filter((c) => c.kind === 'sdk_call' && c.resolved);
    const byLine = Object.fromEntries(calls.map((c) => [c.line, c.symbol]));
    expect(byLine[16]).toBe('openai.ChatCompletion.create');
    expect(byLine[17]).toBe('openai.chat.completions.create');
    expect(byLine[18]).toBe('twilio.messages.create');
    expect(byLine[19]).toBe('stripe.Charge.create');
    expect(
      r.callSites
        .filter((c) => c.kind === 'sdk_import')
        .map((c) => c.providerSlug)
        .sort(),
    ).toEqual(['openai', 'openai', 'stripe', 'twilio']);
  });

  it('detects raw HTTP to provider hosts with the verb', async () => {
    const r = await analyzePython(code, 'svc.py', 'h', idx, { forceRegex: force });
    const http = r.callSites.find((c) => c.kind === 'http_call');
    expect(http).toMatchObject({ providerSlug: 'stripe', line: 20, metadata: { method: 'POST', pathTemplate: '/v1/charges' } });
  });

  it('does not flag provider-free code and ignores commented URLs', async () => {
    const r = await analyzePython('import os\n# https://api.stripe.com/v1/charges\nprint(os.getcwd())\nobj.a.b()\n', 'x.py', 'h', idx, {
      forceRegex: force,
    });
    expect(r.callSites).toEqual([]);
  });
});

describe('Python dynamic access (tree-sitter)', () => {
  it('records subscript calls as dynamic', async () => {
    const r = await analyzePython(code, 'svc.py', 'h', idx);
    expect(r.callSites.find((c) => c.kind === 'dynamic_call')).toMatchObject({
      metadata: { dynamicPrefix: 'openai.images' },
      resolved: false,
    });
  });
});

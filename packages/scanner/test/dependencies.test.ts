import { describe, expect, it } from 'vitest';
import { detectDependencies, minVersionOf } from '../src';
import { idx } from './helpers';

const run = (name: string, text: string) => {
  const warnings: string[] = [];
  const deps = detectDependencies(name, name, text, idx, (w) => warnings.push(w.message));
  return { deps, warnings };
};

describe('dependency detection', () => {
  it('package.json: only known provider SDKs, with versions and line numbers', () => {
    const { deps } = run(
      'package.json',
      `{\n  "dependencies": {\n    "stripe": "^14.5.0",\n    "left-pad": "1.0.0",\n    "@octokit/rest": "20.0.0"\n  },\n  "devDependencies": { "openai": "4.1.0" }\n}`,
    );
    expect(deps.map((d) => d.packageName).sort()).toEqual(['@octokit/rest', 'openai', 'stripe']);
    const stripe = deps.find((d) => d.packageName === 'stripe')!;
    expect(stripe).toMatchObject({ providerSlug: 'stripe', versionSpec: '^14.5.0', source: 'manifest', ecosystem: 'npm', manifestLine: 3 });
    expect(deps.find((d) => d.packageName === 'openai')!.resolvedVersion).toBe('4.1.0');
  });

  it('package-lock.json v3 and v1', () => {
    const v3 = run(
      'package-lock.json',
      JSON.stringify({
        lockfileVersion: 3,
        packages: { '': {}, 'node_modules/stripe': { version: '14.5.0' }, 'node_modules/a/node_modules/stripe': { version: '1.0.0' } },
      }),
    );
    expect(v3.deps).toHaveLength(1);
    expect(v3.deps[0]).toMatchObject({ packageName: 'stripe', resolvedVersion: '14.5.0', source: 'lockfile' });
    const v1 = run('package-lock.json', JSON.stringify({ lockfileVersion: 1, dependencies: { twilio: { version: '4.0.0' } } }));
    expect(v1.deps[0]).toMatchObject({ packageName: 'twilio', resolvedVersion: '4.0.0' });
  });

  it('pnpm-lock.yaml (importers format)', () => {
    const { deps } = run(
      'pnpm-lock.yaml',
      `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      stripe:\n        specifier: ^14.0.0\n        version: 14.2.0(typescript@5.4.0)\n`,
    );
    expect(deps[0]).toMatchObject({ packageName: 'stripe', resolvedVersion: '14.2.0', versionSpec: '^14.0.0', source: 'lockfile' });
  });

  it('yarn.lock v1 with multiple specifiers', () => {
    const { deps } = run(
      'yarn.lock',
      `# yarn lockfile v1\n\n"stripe@^14.0.0", stripe@^14.1.0:\n  version "14.3.0"\n  resolved "https://example"\n`,
    );
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({ packageName: 'stripe', resolvedVersion: '14.3.0' });
  });

  it('requirements.txt handles pins, ranges, extras, comments and options', () => {
    const { deps } = run(
      'requirements.txt',
      `# comment\n-r base.txt\nopenai==0.28.1\nStripe>=7.0,<8\ntwilio[async]~=8.1  # inline\nrequests==2.31.0\nhttps://example.com/x.whl\n`,
    );
    expect(deps.map((d) => [d.packageName, d.resolvedVersion, d.versionSpec])).toEqual([
      ['openai', '0.28.1', '==0.28.1'],
      ['Stripe', null, '>=7.0,<8'],
      ['twilio', null, '~=8.1'],
    ]);
  });

  it('pyproject.toml: PEP 621 and poetry', () => {
    const { deps } = run(
      'pyproject.toml',
      `[project]\nname="x"\ndependencies = ["openai==1.2.0", "requests>=2"]\n\n[tool.poetry.dependencies]\nPyGithub = "^2.1"\npython = "^3.11"\n`,
    );
    expect(deps.map((d) => d.packageName).sort()).toEqual(['PyGithub', 'openai']);
    expect(deps.find((d) => d.packageName === 'openai')!.resolvedVersion).toBe('1.2.0');
  });

  it('malformed manifests produce a warning instead of throwing', () => {
    for (const name of ['package.json', 'package-lock.json', 'pyproject.toml']) {
      const { deps, warnings } = run(name, name === 'pyproject.toml' ? '[project\nbroken' : '{ "dependencies": { "stripe": ');
      expect(deps).toEqual([]);
      expect(warnings[0]).toMatch(/Malformed/);
    }
  });

  it('minVersionOf resolves ranges and rejects garbage', () => {
    expect(minVersionOf('^14.5.0')).toBe('14.5.0');
    expect(minVersionOf('>=1.2 <2')).toBe('1.2.0');
    expect(minVersionOf('not a range')).toBeNull();
    expect(minVersionOf(null)).toBeNull();
  });
});

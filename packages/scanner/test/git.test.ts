import { describe, expect, it } from 'vitest';
import { isPrivateAddress } from '@tracewise/config';
import { parseGitUrl, UnsafeGitUrlError } from '../src';

const hosts = ['github.com', 'gitlab.com'];

describe('parseGitUrl', () => {
  it('accepts plain https URLs on allowed hosts', () => {
    expect(parseGitUrl('https://github.com/acme/widgets', hosts).pathname).toBe('/acme/widgets');
    expect(parseGitUrl('https://github.com/acme/widgets.git', hosts).hostname).toBe('github.com');
  });
  it.each([
    ['http://github.com/a/b', /https/],
    ['ssh://git@github.com/a/b', /https/],
    ['file:///etc/passwd', /https/],
    ['https://user:pw@github.com/a/b', /credentials/],
    ['https://github.com:8443/a/b', /ports/],
    ['https://127.0.0.1/a/b', /IP address/],
    ['https://[::1]/a/b', /IP address|Invalid/],
    ['https://169.254.169.254/latest', /IP address/],
    ['https://evil.example.com/a/b', /not in GIT_ALLOWED_HOSTS/],
    ['https://github.com.evil.com/a/b', /not in GIT_ALLOWED_HOSTS/],
    ['https://github.com/a', /owner\/repository/],
    ['https://github.com/a/b/c/d', /owner\/repository/],
    ['https://github.com/a/b?x=1', /Query/],
    ['not a url', /Invalid URL/],
  ])('rejects %s', (url, msg) => {
    expect(() => parseGitUrl(url, hosts)).toThrow(UnsafeGitUrlError);
    expect(() => parseGitUrl(url, hosts)).toThrow(msg);
  });
});

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '224.0.0.1',
  ])('%s is private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '140.82.112.3', '2606:4700::1111'])('%s is public', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

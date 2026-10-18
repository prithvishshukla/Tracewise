import dns from 'node:dns/promises';
import net from 'node:net';

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses (IPv4 and IPv6). */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7)); // IPv4-mapped
    return (
      v.startsWith('fc') ||
      v.startsWith('fd') ||
      v.startsWith('fe8') ||
      v.startsWith('fe9') ||
      v.startsWith('fea') ||
      v.startsWith('feb') ||
      v.startsWith('ff')
    );
  }
  return true; // not an IP: treat as unsafe when called with garbage
}

export class UnsafeHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeHostError';
  }
}

/**
 * Resolves a hostname and rejects it if any resolved address is non-public.
 * Note: this reduces SSRF risk but cannot fully prevent DNS rebinding between check and connect.
 */
export async function assertPublicHostname(hostname: string): Promise<void> {
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new UnsafeHostError(`Address ${hostname} is not a public address`);
    return;
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
    throw new UnsafeHostError(`Hostname ${hostname} is not allowed`);
  }
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(hostname, { all: true });
  } catch {
    throw new UnsafeHostError(`Could not resolve hostname ${hostname}`);
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new UnsafeHostError(`Hostname ${hostname} resolves to a non-public address`);
  }
}

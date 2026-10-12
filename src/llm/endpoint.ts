// Where a provider endpoint may use plain HTTP. The manifest offers `http://*/*` so LAN gateways
// and local servers can be granted access one origin at a time; the store requires user data to
// travel over HTTPS, so the code accepts `http:` only for this computer and the local network and
// asks for HTTPS for everything else (docs/store/permission-justifications.md).

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4(hostname: string): [number, number, number, number] | undefined {
  const m = IPV4.exec(hostname);
  if (!m) return undefined;
  const parts = m.slice(1).map(Number) as [number, number, number, number];
  return parts.every((n) => n <= 255) ? parts : undefined;
}

/** This computer: `localhost`, `127.0.0.0/8` or `[::1]`. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '[::1]') return true;
  return ipv4(host)?.[0] === 127;
}

/** The local network: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` or a `*.local` name. */
export function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  const ip = ipv4(host);
  if (ip) return ip[0] === 10 || (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) || (ip[0] === 192 && ip[1] === 168);
  return /^[^.]+(\.[^.]+)*\.local\.?$/.test(host);
}

/** True when `base` is an `http:` URL that is neither this computer nor the local network. (A URL that does not parse is not this rule's to refuse.) */
export function isPlainHttpRefused(base: string): boolean {
  try {
    const url = new URL(base);
    return url.protocol === 'http:' && !isLoopbackHost(url.hostname) && !isPrivateNetworkHost(url.hostname);
  } catch {
    return false;
  }
}

/** An `http:` endpoint on the local network (not this computer): the Providers screen says it is unencrypted. */
export function isUnencryptedPrivate(base: string): boolean {
  try {
    const url = new URL(base);
    return url.protocol === 'http:' && !isLoopbackHost(url.hostname) && isPrivateNetworkHost(url.hostname);
  } catch {
    return false;
  }
}

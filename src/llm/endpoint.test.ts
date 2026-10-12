import { describe, expect, it } from 'vitest';
import { HTTPS_REQUIRED, checkBaseUrl } from './errors.ts';
import { isLoopbackHost, isPlainHttpRefused, isPrivateNetworkHost, isUnencryptedPrivate } from './endpoint.ts';

describe('plain-HTTP endpoints', () => {
  it('allows loopback: localhost, 127.0.0.0/8, [::1]', () => {
    for (const base of ['http://localhost:11434/v1', 'http://LOCALHOST/v1', 'http://127.0.0.1:1234/v1', 'http://127.8.9.10/v1', 'http://[::1]:8080/v1']) {
      expect(isPlainHttpRefused(base), base).toBe(false);
      expect(isLoopbackHost(new URL(base).hostname), base).toBe(true);
    }
  });

  it('allows the private ranges 10/8, 172.16/12 and 192.168/16 at their edges', () => {
    for (const host of ['10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255']) {
      expect(isPlainHttpRefused(`http://${host}:8000/v1`), host).toBe(false);
      expect(isPrivateNetworkHost(host), host).toBe(true);
    }
  });

  it('allows *.local names', () => {
    for (const base of ['http://gateway.local/v1', 'http://my-mac.local:11434/v1', 'http://a.b.local./v1']) expect(isPlainHttpRefused(base), base).toBe(false);
  });

  it('refuses public addresses, just outside the private ranges, other IPv6 and look-alike names', () => {
    for (const base of [
      'http://example.com/v1',
      'http://8.8.8.8/v1',
      'http://11.0.0.1/v1',
      'http://172.15.255.255/v1',
      'http://172.32.0.1/v1',
      'http://192.167.1.1/v1',
      'http://192.169.1.1/v1',
      'http://128.0.0.1/v1',
      'http://[2001:db8::1]/v1',
      'http://[fe80::1]/v1',
      'http://localhost.example.com/v1',
      'http://local/v1',
      'http://evil.local.example.com/v1',
      'http://10.0.0.1.example.com/v1',
    ]) {
      expect(isPlainHttpRefused(base), base).toBe(true);
    }
  });

  it('never refuses https, and leaves an unparseable URL to the invalid-URL check', () => {
    expect(isPlainHttpRefused('https://example.com/v1')).toBe(false);
    expect(isPlainHttpRefused('not a url')).toBe(false);
    expect(isPlainHttpRefused('')).toBe(false);
  });

  it('marks only a private-network http endpoint as unencrypted-on-a-network', () => {
    expect(isUnencryptedPrivate('http://192.168.1.20:8000/v1')).toBe(true);
    expect(isUnencryptedPrivate('http://gateway.local/v1')).toBe(true);
    expect(isUnencryptedPrivate('http://localhost:11434/v1')).toBe(false);
    expect(isUnencryptedPrivate('https://192.168.1.20/v1')).toBe(false);
    expect(isUnencryptedPrivate('http://example.com/v1')).toBe(false);
  });

  it('checkBaseUrl refuses public HTTP with the HTTPS message and accepts the allowed hosts', () => {
    expect(checkBaseUrl('http://example.com/v1')).toEqual({ kind: 'bad_request', message: HTTPS_REQUIRED });
    expect(checkBaseUrl('http://192.168.1.20:8000/v1')).toBeNull();
    expect(checkBaseUrl('http://gateway.local/v1')).toBeNull();
  });
});

/**
 * Normalize a browser Origin / Referer / stored domain to a comparable hostname.
 * Examples: "https://WWW.Example.com:443/path" → "example.com"
 */
export function normalizeWidgetDomain(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;

  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withScheme);
    let host = url.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    if (!host || host === 'localhost' || host.endsWith('.localhost')) {
      return host || null;
    }
    return host;
  } catch {
    // Bare hostname without URL parser success
    let host = raw.split('/')[0]?.split(':')[0] ?? '';
    if (host.startsWith('www.')) host = host.slice(4);
    return host || null;
  }
}

/** Extract Origin hostname; fall back to Referer. */
export function extractRequestOriginHost(headers: {
  origin?: string;
  referer?: string;
}): string | null {
  const origin = typeof headers.origin === 'string' ? headers.origin : '';
  if (origin) return normalizeWidgetDomain(origin);

  const referer = typeof headers.referer === 'string' ? headers.referer : '';
  if (referer) return normalizeWidgetDomain(referer);

  return null;
}

export function domainsMatch(allowed: string, requestHost: string): boolean {
  const a = normalizeWidgetDomain(allowed);
  const b = normalizeWidgetDomain(requestHost);
  if (!a || !b) return false;
  return a === b;
}

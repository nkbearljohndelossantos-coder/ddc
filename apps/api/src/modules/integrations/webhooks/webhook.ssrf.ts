import { URL } from 'url';

/**
 * Validates destination webhook URL against SSRF threats:
 * - Rejects non-HTTP/HTTPS protocols
 * - Rejects localhost (127.0.0.1, ::1, localhost)
 * - Rejects private RFC1918 networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 * - Rejects link-local and cloud metadata (169.254.169.254, 169.254.0.0/16)
 */
export function validateWebhookUrl(rawUrl: string): { isValid: boolean; reason?: string } {
  try {
    const parsed = new URL(rawUrl);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { isValid: false, reason: 'Invalid protocol: Only HTTP and HTTPS are permitted' };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Localhost & Loopback
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      hostname === '0.0.0.0'
    ) {
      return { isValid: false, reason: 'SSRF Protection: Localhost destinations are blocked' };
    }

    // Cloud Metadata & Link-Local (169.254.0.0/16)
    if (hostname.startsWith('169.254.')) {
      return { isValid: false, reason: 'SSRF Protection: Cloud metadata and link-local destinations are blocked' };
    }

    // Private IPv4 Ranges (RFC 1918)
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = hostname.match(ipv4Regex);

    if (match) {
      const [_, o1, o2] = match.map(Number);

      // 10.0.0.0/8
      if (o1 === 10) {
        return { isValid: false, reason: 'SSRF Protection: Private 10.0.0.0/8 network blocked' };
      }
      // 172.16.0.0/12 (172.16.0.0 – 172.31.255.255)
      if (o1 === 172 && o2 >= 16 && o2 <= 31) {
        return { isValid: false, reason: 'SSRF Protection: Private 172.16.0.0/12 network blocked' };
      }
      // 192.168.0.0/16
      if (o1 === 192 && o2 === 168) {
        return { isValid: false, reason: 'SSRF Protection: Private 192.168.0.0/16 network blocked' };
      }
    }

    return { isValid: true };
  } catch (err: any) {
    return { isValid: false, reason: `Malformed URL format: ${err.message}` };
  }
}

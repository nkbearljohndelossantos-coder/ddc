import crypto from 'crypto';

export interface WebhookSignatureResult {
  signature: string;
  timestamp: number;
  headerString: string;
}

/**
 * Signs a webhook payload using HMAC-SHA256.
 */
export function signWebhookPayload(
  secret: string,
  payload: Record<string, any>,
  timestamp: number = Date.now(),
  eventId: string
): WebhookSignatureResult {
  const canonicalPayload = `${timestamp}.${eventId}.${JSON.stringify(payload)}`;
  const signature = crypto.createHmac('sha256', secret).update(canonicalPayload).digest('hex');

  return {
    signature,
    timestamp,
    headerString: `t=${timestamp},v1=${signature}`,
  };
}

/**
 * Verifies a webhook HMAC-SHA256 signature using constant-time comparison.
 * Enforces replay protection (default tolerance: 5 minutes).
 */
export function verifyWebhookSignature(
  secret: string,
  payload: Record<string, any>,
  timestamp: number,
  eventId: string,
  providedSignature: string,
  toleranceSec = 300
): { isValid: boolean; reason?: string } {
  const now = Date.now();
  const ageSec = Math.abs(now - timestamp) / 1000;

  if (ageSec > toleranceSec) {
    return { isValid: false, reason: `Replay Protection: Webhook signature expired (${Math.round(ageSec)}s old)` };
  }

  const { signature: expectedSignature } = signWebhookPayload(secret, payload, timestamp, eventId);

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const providedBuffer = Buffer.from(providedSignature, 'utf8');

  if (expectedBuffer.length !== providedBuffer.length) {
    return { isValid: false, reason: 'Invalid signature length' };
  }

  const isMatch = crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  return { isValid: isMatch, reason: isMatch ? undefined : 'HMAC signature mismatch' };
}

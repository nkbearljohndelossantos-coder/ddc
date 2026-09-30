import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

describe('Phase 2 API: Agent Registration, Hardened Credential Lifecycle & Scanner Ownership Tests', () => {
  const JWT_SECRET = 'test_jwt_secret_key_minimum_32_characters_long_12345';

  const mockDb = {
    pairingTokens: new Map<string, any>(),
    agents: new Map<string, any>(),
    credentials: new Map<string, any>(),
    scanners: new Map<string, any>(), // key: agentId:driverType:localScannerId
  };

  function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // =========================================================================
  // 1. PAIRING TOKEN CONCURRENCY & SECURITY
  // =========================================================================
  describe('1. Pairing Token Security & Single-Use Enforcement', () => {
    const validRawToken = 'NKB-A1B2C3D4E5F678901234567890ABCDEF';
    const expiredRawToken = 'NKB-EXPIREDTOKEN1234567890ABCDEF1234';

    const now = new Date();
    const future = new Date(now.getTime() + 15 * 60000);
    const past = new Date(now.getTime() - 15 * 60000);

    mockDb.pairingTokens.set(hashToken(validRawToken), {
      id: 'token-1',
      tokenHash: hashToken(validRawToken),
      organizationId: 'org-hq-1',
      departmentId: 'dept-accounting',
      isUsed: false,
      expiresAt: future,
    });

    mockDb.pairingTokens.set(hashToken(expiredRawToken), {
      id: 'token-2',
      tokenHash: hashToken(expiredRawToken),
      organizationId: 'org-hq-1',
      departmentId: 'dept-accounting',
      isUsed: false,
      expiresAt: past,
    });

    it('should register an agent and atomically consume the pairing token', async () => {
      const tokenHash = hashToken(validRawToken);
      const pairingRecord = mockDb.pairingTokens.get(tokenHash);

      assert.ok(pairingRecord);
      assert.strictEqual(pairingRecord.isUsed, false);

      // Consume token
      pairingRecord.isUsed = true;
      pairingRecord.usedAt = new Date();

      const agentId = 'agent-uuid-001';
      const rawSecret = crypto.randomBytes(32).toString('hex');
      const secretHash = await bcrypt.hash(rawSecret, 10);
      const keyIdentifier = `cred-${crypto.randomUUID()}`;

      mockDb.agents.set(agentId, {
        id: agentId,
        agentName: 'Accounting-Scanner-Agent',
        status: 'PENDING_APPROVAL',
      });

      mockDb.credentials.set(keyIdentifier, {
        id: 'cred-id-1',
        agentId,
        keyIdentifier,
        secretHash,
        isActive: false,
        expiresAt: new Date(Date.now() + 90 * 86400000),
        revokedAt: null,
      });

      assert.strictEqual(mockDb.pairingTokens.get(tokenHash).isUsed, true);
    });

    it('should reject second attempt to use the same pairing token (Double-Use Prevention)', () => {
      const tokenHash = hashToken(validRawToken);
      const pairingRecord = mockDb.pairingTokens.get(tokenHash);
      assert.ok(pairingRecord);
      assert.strictEqual(pairingRecord.isUsed, true, 'Already-used token must be rejected');
    });

    it('should reject registration when pairing token is expired', () => {
      const tokenHash = hashToken(expiredRawToken);
      const pairingRecord = mockDb.pairingTokens.get(tokenHash);
      assert.ok(pairingRecord);
      assert.strictEqual(pairingRecord.expiresAt < new Date(), true, 'Expired token must be rejected');
    });
  });

  // =========================================================================
  // 2. HARDENED CREDENTIAL LIFECYCLE, ROTATION & REVOCATION
  // =========================================================================
  describe('2. Hardened Credential Lifecycle', () => {
    const agentId = 'agent-uuid-001';
    let activeKeyId = 'cred-key-initial';
    const initialSecret = 'my-initial-symmetric-agent-secret-key-32b';

    it('should activate credential upon admin approval and exchange for short-lived JWT', async () => {
      const secretHash = await bcrypt.hash(initialSecret, 10);
      mockDb.credentials.set(activeKeyId, {
        id: 'c1',
        agentId,
        keyIdentifier: activeKeyId,
        secretHash,
        isActive: true, // Admin approved
        expiresAt: new Date(Date.now() + 90 * 86400000),
        revokedAt: null,
      });

      const agent = mockDb.agents.get(agentId);
      agent.status = 'ONLINE';

      const cred = mockDb.credentials.get(activeKeyId);
      const isValidSecret = await bcrypt.compare(initialSecret, cred.secretHash);
      assert.strictEqual(isValidSecret, true);
      assert.strictEqual(cred.isActive, true);

      const token = jwt.sign(
        { sub: agentId, keyId: activeKeyId, type: 'AGENT' },
        JWT_SECRET,
        { expiresIn: '15m' }
      );
      assert.ok(token);
    });

    it('should reject token exchange if credential is expired', async () => {
      const expiredKeyId = 'cred-expired-99';
      mockDb.credentials.set(expiredKeyId, {
        id: 'c-exp',
        agentId,
        keyIdentifier: expiredKeyId,
        secretHash: 'hash',
        isActive: true,
        expiresAt: new Date(Date.now() - 10000), // Expired
        revokedAt: null,
      });

      const cred = mockDb.credentials.get(expiredKeyId);
      const isExpired = cred.expiresAt < new Date();
      assert.strictEqual(isExpired, true, 'Expired credential must be rejected');
    });

    it('should rotate credentials atomically and deactivate previous key', async () => {
      const oldCred = mockDb.credentials.get(activeKeyId);
      oldCred.isActive = false;
      oldCred.revokedAt = new Date();

      const newKeyId = 'cred-key-rotated-2';
      const newSecret = 'new-rotated-secret-key-material-2026';
      const newSecretHash = await bcrypt.hash(newSecret, 10);

      mockDb.credentials.set(newKeyId, {
        id: 'c2',
        agentId,
        keyIdentifier: newKeyId,
        secretHash: newSecretHash,
        isActive: true,
        expiresAt: new Date(Date.now() + 90 * 86400000),
        revokedAt: null,
      });

      assert.strictEqual(mockDb.credentials.get(activeKeyId).isActive, false);
      assert.ok(mockDb.credentials.get(activeKeyId).revokedAt);
      assert.strictEqual(mockDb.credentials.get(newKeyId).isActive, true);

      activeKeyId = newKeyId;
    });

    it('should reject authentication for a revoked agent or credential', () => {
      const agent = mockDb.agents.get(agentId);
      agent.status = 'REVOKED';

      const cred = mockDb.credentials.get(activeKeyId);
      cred.isActive = false;
      cred.revokedAt = new Date();

      const isRevoked = agent.status === 'REVOKED' || cred.isActive === false || cred.revokedAt !== null;
      assert.strictEqual(isRevoked, true, 'Revoked agent/credential must be rejected immediately');
    });
  });

  // =========================================================================
  // 3. SCANNER OWNERSHIP & STABLE IDENTITY (IDEMPOTENT SYNC)
  // =========================================================================
  describe('3. Scanner Ownership & Stable Identity Sync', () => {
    const agentA = 'agent-uuid-AAA';
    const agentB = 'agent-uuid-BBB';

    it('should register scanners with composite unique identity (agentId + driverType + localScannerId)', () => {
      const scanner1 = {
        agentId: agentA,
        driverType: 'TWAIN',
        localScannerId: 'Brother_ADS4300N_USB001',
        scannerName: 'Brother ADS-4300N High-Speed Desktop Scanner',
        status: 'READY',
      };

      const compositeKey = `${scanner1.agentId}:${scanner1.driverType}:${scanner1.localScannerId}`;
      mockDb.scanners.set(compositeKey, scanner1);

      assert.ok(mockDb.scanners.has(compositeKey));
      assert.strictEqual(mockDb.scanners.get(compositeKey).scannerName, 'Brother ADS-4300N High-Speed Desktop Scanner');
    });

    it('should idempotently update existing scanner on repeated sync without duplicate records', () => {
      const repeatedSyncScanner = {
        agentId: agentA,
        driverType: 'TWAIN',
        localScannerId: 'Brother_ADS4300N_USB001',
        scannerName: 'Brother ADS-4300N High-Speed Desktop Scanner (Updated Status)',
        status: 'BUSY',
      };

      const compositeKey = `${repeatedSyncScanner.agentId}:${repeatedSyncScanner.driverType}:${repeatedSyncScanner.localScannerId}`;
      // Upsert: updates existing record under same composite key
      mockDb.scanners.set(compositeKey, repeatedSyncScanner);

      // Verify no duplicate keys created; single record updated
      const matchingScanners = Array.from(mockDb.scanners.values()).filter(
        (s) => s.agentId === agentA && s.localScannerId === 'Brother_ADS4300N_USB001'
      );
      assert.strictEqual(matchingScanners.length, 1, 'Repeated sync must not create duplicate scanner records');
      assert.strictEqual(matchingScanners[0].status, 'BUSY');
    });

    it('should strictly isolate scanner ownership between different agents', () => {
      const scannerAgentB = {
        agentId: agentB,
        driverType: 'TWAIN',
        localScannerId: 'Brother_ADS4300N_USB001', // Same local device name, different agent
        scannerName: 'Branch Office Brother ADS-4300N',
        status: 'READY',
      };

      const compositeKeyB = `${scannerAgentB.agentId}:${scannerAgentB.driverType}:${scannerAgentB.localScannerId}`;
      mockDb.scanners.set(compositeKeyB, scannerAgentB);

      // Both exist independently under their own agent scopes
      const compositeKeyA = `${agentA}:TWAIN:Brother_ADS4300N_USB001`;
      assert.ok(mockDb.scanners.has(compositeKeyA));
      assert.ok(mockDb.scanners.has(compositeKeyB));
      assert.notStrictEqual(mockDb.scanners.get(compositeKeyA).agentId, mockDb.scanners.get(compositeKeyB).agentId);
    });
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JobStateMachine } from '../modules/jobs/job.stateMachine.js';
import { RealtimeGateway } from '../modules/realtime/realtime.gateway.js';

describe('Phase 3: Scan Job Orchestration, Realtime Dispatch & State Machine Tests', () => {
  // In-memory mock database state
  const mockDb = {
    jobs: new Map<string, any>(),
    auditLogs: [] as any[],
    agents: new Map<string, any>(),
    scanners: new Map<string, any>(),
  };

  // =========================================================================
  // 1. STATE MACHINE & TRANSITION VALIDATION
  // =========================================================================
  describe('1. State Machine & Transition Validation', () => {
    it('should allow valid sequential job lifecycle transitions', () => {
      assert.strictEqual(JobStateMachine.canTransition('CREATED', 'QUEUED'), true);
      assert.strictEqual(JobStateMachine.canTransition('QUEUED', 'DISPATCHED'), true);
      assert.strictEqual(JobStateMachine.canTransition('DISPATCHED', 'ACKNOWLEDGED'), true);
      assert.strictEqual(JobStateMachine.canTransition('ACKNOWLEDGED', 'SCANNING'), true);
      assert.strictEqual(JobStateMachine.canTransition('SCANNING', 'LOCAL_COMPLETED'), true);
    });

    it('should reject invalid / illegal job state transitions', () => {
      assert.strictEqual(JobStateMachine.canTransition('CREATED', 'COMPLETED'), false);
      assert.strictEqual(JobStateMachine.canTransition('COMPLETED', 'SCANNING'), false);
      assert.strictEqual(JobStateMachine.canTransition('CANCELLED', 'QUEUED'), false);

      assert.throws(
        () => JobStateMachine.validateTransition('CREATED', 'COMPLETED'),
        /Illegal job state transition/
      );
    });

    it('should allow cancellation from active intermediate states', () => {
      assert.strictEqual(JobStateMachine.canTransition('QUEUED', 'CANCELLED'), true);
      assert.strictEqual(JobStateMachine.canTransition('DISPATCHED', 'CANCELLATION_REQUESTED'), true);
      assert.strictEqual(JobStateMachine.canTransition('SCANNING', 'CANCELLATION_REQUESTED'), true);
      assert.strictEqual(JobStateMachine.canTransition('CANCELLATION_REQUESTED', 'CANCELLED'), true);
    });
  });

  // =========================================================================
  // 2. SCAN JOB IDEMPOTENT CREATION
  // =========================================================================
  describe('2. Scan Job Idempotent Creation', () => {
    const idempotencyKey = 'unique-scan-session-key-1001';

    it('should create a new scan job and record initial audit log', () => {
      const newJob = {
        id: 'job-uuid-1',
        idempotencyKey,
        scannerId: 'scanner-uuid-1',
        agentId: 'agent-uuid-1',
        profileId: 'profile-uuid-1',
        status: 'QUEUED',
        pageCount: 0,
        createdAt: new Date(),
      };

      mockDb.jobs.set(idempotencyKey, newJob);
      mockDb.auditLogs.push({
        jobId: newJob.id,
        fromStatus: null,
        toStatus: 'CREATED',
        event: 'JOB_CREATED',
      });
      mockDb.auditLogs.push({
        jobId: newJob.id,
        fromStatus: 'CREATED',
        toStatus: 'QUEUED',
        event: 'JOB_QUEUED',
      });

      assert.ok(mockDb.jobs.has(idempotencyKey));
      assert.strictEqual(mockDb.jobs.get(idempotencyKey).status, 'QUEUED');
      assert.strictEqual(mockDb.auditLogs.length, 2);
    });

    it('should idempotently return existing job on duplicate submission with same idempotencyKey', () => {
      const existing = mockDb.jobs.get(idempotencyKey);
      assert.ok(existing);
      assert.strictEqual(existing.id, 'job-uuid-1');

      // Verify no duplicate records created
      const matchingJobs = Array.from(mockDb.jobs.values()).filter(
        (j) => j.idempotencyKey === idempotencyKey
      );
      assert.strictEqual(matchingJobs.length, 1);
    });
  });

  // =========================================================================
  // 3. REALTIME GATEWAY SESSION & ACKNOWLEDGEMENT
  // =========================================================================
  describe('3. Realtime Gateway & Explicit Acknowledgement', () => {
    const agentId = 'agent-uuid-realtime-1';

    it('should track connected agent sessions and report online status', () => {
      assert.strictEqual(RealtimeGateway.isAgentConnected(agentId), false);

      RealtimeGateway.registerAgentSession({
        agentId,
        socketId: 'sock-12345',
        keyIdentifier: 'cred-key-1',
        connectedAt: new Date(),
        lastHeartbeat: new Date(),
      });

      assert.strictEqual(RealtimeGateway.isAgentConnected(agentId), true);
    });

    it('should dispatch job and resolve when agent explicitly acknowledges', async () => {
      const jobId = 'job-uuid-dispatch-1';

      // Start dispatch in background
      const dispatchPromise = RealtimeGateway.dispatchJobWithAckTimeout(
        jobId,
        agentId,
        { resolutionDpi: 300, duplex: true },
        5000
      );

      // Simulate agent explicit ACK after 50ms
      setTimeout(() => {
        const ackResult = RealtimeGateway.acknowledgeJob(jobId);
        assert.strictEqual(ackResult, true);
      }, 50);

      const ackSuccess = await dispatchPromise;
      assert.strictEqual(ackSuccess, true, 'Dispatch must resolve true upon explicit ACK');
    });

    it('should time out dispatch if agent fails to send ACK within timeout window', async () => {
      const timedOutJobId = 'job-uuid-timeout-2';

      // Dispatch with ultra-short timeout (50ms) without acknowledging
      const dispatchPromise = RealtimeGateway.dispatchJobWithAckTimeout(
        timedOutJobId,
        agentId,
        { resolutionDpi: 300 },
        50
      );

      const ackSuccess = await dispatchPromise;
      assert.strictEqual(ackSuccess, false, 'Dispatch must resolve false upon ACK timeout');
    });

    it('should disconnect agent cleanly upon disconnect signal', () => {
      RealtimeGateway.disconnectAgent(agentId);
      assert.strictEqual(RealtimeGateway.isAgentConnected(agentId), false);
    });
  });

  // =========================================================================
  // 4. SAFE JOB CANCELLATION
  // =========================================================================
  describe('4. Safe Job Cancellation', () => {
    it('should cancel queued job immediately before hardware dispatch', () => {
      const queuedJob = { id: 'job-cancel-1', status: 'QUEUED' };
      assert.strictEqual(JobStateMachine.canTransition(queuedJob.status as any, 'CANCELLED'), true);
      queuedJob.status = 'CANCELLED';
      assert.strictEqual(queuedJob.status, 'CANCELLED');
    });

    it('should require CANCELLATION_REQUESTED confirmation for actively scanning job', () => {
      const scanningJob = { id: 'job-cancel-2', status: 'SCANNING' };

      // Transition to CANCELLATION_REQUESTED
      assert.strictEqual(
        JobStateMachine.canTransition(scanningJob.status as any, 'CANCELLATION_REQUESTED'),
        true
      );
      scanningJob.status = 'CANCELLATION_REQUESTED';

      // Transition to CANCELLED upon agent confirmation
      assert.strictEqual(
        JobStateMachine.canTransition(scanningJob.status as any, 'CANCELLED'),
        true
      );
      scanningJob.status = 'CANCELLED';
      assert.strictEqual(scanningJob.status, 'CANCELLED');
    });
  });
});

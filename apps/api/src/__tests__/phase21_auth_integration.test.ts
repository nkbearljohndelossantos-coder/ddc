import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authController } from '../modules/auth/auth.controller.js';
import { healthRouter } from '../modules/health/health.routes.js';
import { Request, Response, NextFunction } from 'express';

describe('Phase 21: Production Authentication & Web UI Delivery Integration Tests', () => {
  describe('1. Static SPA Delivery & Security Handler Routing', () => {
    it('should route / to /app/ redirect when Accept header includes text/html', async () => {
      let redirectUrl = '';
      const req: any = {
        accepts: (type: string) => type === 'html',
        xhr: false,
        path: '/',
      };
      const res: any = {
        redirect: (url: string) => {
          redirectUrl = url;
          return res;
        },
        json: (data: any) => data,
      };

      // Extract GET / handler
      const rootLayer = (healthRouter.stack as any[]).find(
        (l) => l.route && l.route.path === '/' && l.route.methods.get
      );
      assert.ok(rootLayer, 'GET / handler must exist in healthRouter');
      rootLayer.route.stack[0].handle(req, res);

      assert.equal(redirectUrl, '/app/');
    });

    it('should return service metadata JSON when Accept header does not prefer html', async () => {
      let jsonPayload: any = null;
      const req: any = {
        accepts: (type: string) => false,
        xhr: false,
        path: '/',
      };
      const res: any = {
        redirect: (url: string) => res,
        json: (data: any) => {
          jsonPayload = data;
          return res;
        },
      };

      const rootLayer = (healthRouter.stack as any[]).find(
        (l) => l.route && l.route.path === '/' && l.route.methods.get
      );
      rootLayer.route.stack[0].handle(req, res);

      assert.ok(jsonPayload);
      assert.equal(jsonPayload.status, 'ONLINE');
      assert.equal(jsonPayload.version, '1.0.0');
      assert.equal(jsonPayload.frontend, '/app/');
    });
  });

  describe('2. Authentication Controller Invariants', () => {
    it('should pass error to next() when invalid credentials provided to authController.login', async () => {
      let capturedError: any = null;
      const req: any = {
        body: {
          email: 'nonexistent@nkbmanufacturing.com',
          password: 'WrongPassword123!',
        },
      };
      const res: any = {
        json: () => res,
      };
      const next: NextFunction = (err?: any) => {
        capturedError = err;
      };

      await authController.login(req, res, next);
      assert.ok(capturedError, 'Invalid login must invoke next with an error');
      assert.match(capturedError.message || capturedError.toString(), /Invalid email or password/i);
    });

    it('should handle logout cleanly when refreshToken is provided', async () => {
      let jsonResponse: any = null;
      const req: any = {
        body: { refreshToken: 'test-refresh-token' },
      };
      const res: any = {
        json: (data: any) => {
          jsonResponse = data;
          return res;
        },
      };
      const next: NextFunction = () => {};

      await authController.logout(req, res, next);
      assert.ok(jsonResponse);
      assert.match(jsonResponse.message, /Logged out successfully/i);
    });

    it('should return authenticated user profile on authController.me', async () => {
      let jsonResponse: any = null;
      const mockUser = {
        id: 'usr-admin-1',
        email: 'admin@nkb-scanning.local',
        fullName: 'Super Admin',
        roles: ['SUPER_ADMIN'],
      };
      const req: any = {
        user: mockUser,
      };
      const res: any = {
        json: (data: any) => {
          jsonResponse = data;
          return res;
        },
      };
      const next: NextFunction = () => {};

      await authController.me(req, res, next);
      assert.ok(jsonResponse);
      assert.deepEqual(jsonResponse.user, mockUser);
    });
  });
});

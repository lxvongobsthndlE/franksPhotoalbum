import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockPrismaClient,
  createMockReply,
  createMockRequest,
  createMockRouteFastify,
} from './mocks/index.js';

vi.mock('../utils/storage.js', () => ({
  createUserExportZip: vi.fn(),
  getUserExportStat: vi.fn(),
  getUserExportStream: vi.fn(),
  deleteUserExportObject: vi.fn(),
}));

describe('exports routes', () => {
  let exportsRoutes;
  let recoverPendingUserExports;
  let storage;
  let prisma;
  let fastify;

  async function callRoute(method, path, requestOverrides = {}) {
    const handler = fastify.routes[method].get(path);
    const request = createMockRequest(requestOverrides);
    const reply = createMockReply();
    const result = await handler(request, reply);
    return { request, reply, result };
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const exportsModule = await import('../routes/exports.js');
    exportsRoutes = exportsModule.default;
    recoverPendingUserExports = exportsModule.recoverPendingUserExports;
    storage = await import('../utils/storage.js');
    prisma = createMockPrismaClient();
    fastify = createMockRouteFastify({ prisma });
    await exportsRoutes(fastify);
  });

  it('returns 401 for export request without auth', async () => {
    const { reply } = await callRoute('POST', '/request', {
      jwtVerify: vi.fn().mockRejectedValue(new Error('Unauthorized')),
    });

    expect(reply.statusCode).toBe(401);
    expect(reply.payload).toEqual({ error: 'Unauthorized' });
  });

  it('returns 429 if last export is younger than 24h', async () => {
    prisma.userExport.findFirst.mockResolvedValueOnce({
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    const { reply } = await callRoute('POST', '/request', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
    });

    expect(reply.statusCode).toBe(429);
    expect(reply.payload).toEqual({
      error: 'Du kannst nur einmal pro 24 Stunden einen Export anfordern.',
    });
  });

  it('creates queued export and starts async generation', async () => {
    const createdExport = {
      id: 'exp-1',
      userId: 'user-1',
      zipKey: 'export_user_user-1_123.zip',
      downloadToken: 'token-1',
      status: 'queued',
      photoCount: 0,
      sizeBytes: null,
      errorMessage: null,
      createdAt: new Date('2026-05-06T10:00:00.000Z'),
      readyAt: null,
      linkExpiry: new Date('2026-06-05T10:00:00.000Z'),
    };

    prisma.userExport.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    prisma.userExport.create.mockResolvedValue(createdExport);
    prisma.userExport.findUnique.mockResolvedValue({
      id: 'exp-1',
      userId: 'user-1',
      zipKey: 'export_user_user-1_123.zip',
      status: 'queued',
    });
    prisma.photo.findMany.mockResolvedValue([]);
    prisma.userExport.update.mockResolvedValue({ id: 'exp-1' });
    storage.createUserExportZip.mockResolvedValue('export_user_user-1_123.zip');
    storage.getUserExportStat.mockResolvedValue({ size: 456 });

    const { reply } = await callRoute('POST', '/request', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
    });

    expect(reply.statusCode).toBe(202);
    expect(reply.payload.export).toEqual(
      expect.objectContaining({
        id: 'exp-1',
        status: 'queued',
        downloadUrl: null,
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(prisma.userExport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'exp-1' },
        data: expect.objectContaining({ status: 'running' }),
      })
    );
    expect(storage.createUserExportZip).toHaveBeenCalled();
    expect(prisma.userExport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'exp-1' },
        data: expect.objectContaining({ status: 'ready', photoCount: 0 }),
      })
    );
  });

  it('lists only caller exports on GET /mine', async () => {
    prisma.userExport.findMany.mockResolvedValue([
      {
        id: 'exp-ready',
        userId: 'user-1',
        zipKey: 'ready.zip',
        downloadToken: 'tok-ready',
        status: 'ready',
        photoCount: 10,
        sizeBytes: BigInt(1024),
        errorMessage: null,
        createdAt: new Date('2026-05-05T10:00:00.000Z'),
        readyAt: new Date('2026-05-05T10:01:00.000Z'),
        linkExpiry: new Date(Date.now() + 60_000),
      },
      {
        id: 'exp-failed',
        userId: 'user-1',
        zipKey: 'failed.zip',
        downloadToken: 'tok-failed',
        status: 'failed',
        photoCount: 0,
        sizeBytes: null,
        errorMessage: 'Boom',
        createdAt: new Date('2026-05-04T10:00:00.000Z'),
        readyAt: null,
        linkExpiry: new Date(Date.now() + 60_000),
      },
    ]);

    const { result } = await callRoute('GET', '/mine', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
    });

    expect(prisma.userExport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } })
    );
    expect(result.exports).toHaveLength(2);
    expect(result.exports[0].downloadUrl).toContain('/api/exports/exp-ready/download');
    expect(result.exports[1].downloadUrl).toBeNull();
  });

  it('blocks unauthenticated download access', async () => {
    const { reply } = await callRoute('GET', '/:id/download', {
      jwtVerify: vi.fn().mockRejectedValue(new Error('Unauthorized')),
      params: { id: 'exp-unauth' },
    });

    expect(reply.statusCode).toBe(401);
    expect(reply.payload).toEqual({ error: 'Unauthorized' });
  });

  it('returns 403 when non-owner tries to download export', async () => {
    prisma.userExport.findUnique.mockResolvedValue({
      id: 'exp-foreign',
      userId: 'user-owner',
      zipKey: 'foreign.zip',
      status: 'ready',
      linkExpiry: new Date(Date.now() + 60_000),
    });
    prisma.user.findUnique.mockResolvedValue({ role: 'user' });

    const { reply } = await callRoute('GET', '/:id/download', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-other' },
      params: { id: 'exp-foreign' },
    });

    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toEqual({ error: 'Forbidden' });
  });

  it('returns 410 when authenticated download link is expired', async () => {
    prisma.userExport.findUnique.mockResolvedValue({
      id: 'exp-1',
      userId: 'user-1',
      zipKey: 'expired.zip',
      status: 'ready',
      linkExpiry: new Date(Date.now() - 1000),
    });

    const { reply } = await callRoute('GET', '/:id/download', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { id: 'exp-1' },
    });

    expect(reply.statusCode).toBe(410);
    expect(reply.payload).toEqual({ error: 'Dieser Download-Link ist abgelaufen.' });
  });

  it('streams ready export for authenticated owner', async () => {
    prisma.userExport.findUnique.mockResolvedValue({
      id: 'exp-2',
      userId: 'user-1',
      zipKey: 'ready.zip',
      status: 'ready',
      linkExpiry: new Date(Date.now() + 30_000),
    });
    storage.getUserExportStat.mockResolvedValue({ size: 123 });
    storage.getUserExportStream.mockResolvedValue('STREAM');

    const { reply } = await callRoute('GET', '/:id/download', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { id: 'exp-2' },
    });

    expect(storage.getUserExportStat).toHaveBeenCalledWith('ready.zip');
    expect(storage.getUserExportStream).toHaveBeenCalledWith('ready.zip');
    expect(reply.headers['Content-Type']).toBe('application/zip');
    expect(reply.payload).toBe('STREAM');
  });

  it('blocks non-admin access to admin exports list', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'user' });

    const { reply } = await callRoute('GET', '/admin/exports', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
    });

    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toEqual({ error: 'Forbidden' });
  });

  it('returns admin exports with user label', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.userExport.findMany.mockResolvedValue([
      {
        id: 'exp-admin',
        userId: 'user-2',
        zipKey: 'admin.zip',
        downloadToken: 'tok-admin',
        status: 'ready',
        photoCount: 4,
        sizeBytes: BigInt(2048),
        errorMessage: null,
        createdAt: new Date('2026-05-01T10:00:00.000Z'),
        readyAt: new Date('2026-05-01T10:02:00.000Z'),
        linkExpiry: new Date(Date.now() + 60_000),
        user: { name: 'Max Mustermann', username: 'max' },
      },
    ]);

    const { result } = await callRoute('GET', '/admin/exports', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' },
    });

    expect(result.exports[0]).toEqual(
      expect.objectContaining({
        id: 'exp-admin',
        userLabel: 'Max Mustermann',
        downloadUrl: expect.stringContaining('/api/exports/exp-admin/download'),
      })
    );
  });

  it('allows admin to download a foreign export', async () => {
    prisma.userExport.findUnique.mockResolvedValue({
      id: 'exp-admin-download',
      userId: 'user-owner',
      zipKey: 'owner.zip',
      status: 'ready',
      linkExpiry: new Date(Date.now() + 60_000),
    });
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    storage.getUserExportStat.mockResolvedValue({ size: 88 });
    storage.getUserExportStream.mockResolvedValue('ADMIN_STREAM');

    const { reply } = await callRoute('GET', '/:id/download', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' },
      params: { id: 'exp-admin-download' },
    });

    expect(reply.payload).toBe('ADMIN_STREAM');
    expect(storage.getUserExportStream).toHaveBeenCalledWith('owner.zip');
  });

  it('requeues queued and running exports during startup recovery', async () => {
    prisma.userExport.findMany.mockResolvedValue([
      { id: 'exp-queued', status: 'queued' },
      { id: 'exp-running', status: 'running' },
    ]);
    prisma.userExport.updateMany.mockResolvedValue({ count: 1 });

    prisma.userExport.findUnique
      .mockResolvedValueOnce({
        id: 'exp-queued',
        userId: 'user-1',
        zipKey: 'q.zip',
        status: 'queued',
      })
      .mockResolvedValueOnce({
        id: 'exp-running',
        userId: 'user-1',
        zipKey: 'r.zip',
        status: 'queued',
      });
    prisma.photo.findMany.mockResolvedValue([]);
    prisma.userExport.update.mockResolvedValue({ id: 'ok' });
    storage.createUserExportZip.mockResolvedValue('ok.zip');
    storage.getUserExportStat.mockResolvedValue({ size: 12 });

    const result = await recoverPendingUserExports(fastify);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result).toEqual({ found: 2, normalizedRunning: 1, requeued: 2 });
    expect(prisma.userExport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['exp-running'] } },
      })
    );
    expect(storage.createUserExportZip).toHaveBeenCalledTimes(2);
  });

  it('blocks non-admin from deleting an export', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'user' });

    const { reply } = await callRoute('DELETE', '/admin/exports/:id', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { id: 'exp-1' },
    });

    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toEqual({ error: 'Forbidden' });
  });

  it('returns 404 when deleting a non-existent export', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.userExport.findUnique.mockResolvedValue(null);

    const { reply } = await callRoute('DELETE', '/admin/exports/:id', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' },
      params: { id: 'missing-id' },
    });

    expect(reply.statusCode).toBe(404);
    expect(reply.payload).toEqual({ error: 'Export nicht gefunden' });
  });

  it('deletes an export from MinIO and DB for admins', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.userExport.findUnique.mockResolvedValue({ id: 'exp-del', zipKey: 'del.zip' });
    storage.deleteUserExportObject.mockResolvedValue(undefined);
    prisma.userExport.delete.mockResolvedValue({ id: 'exp-del' });

    const { result } = await callRoute('DELETE', '/admin/exports/:id', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' },
      params: { id: 'exp-del' },
    });

    expect(storage.deleteUserExportObject).toHaveBeenCalledWith('del.zip');
    expect(prisma.userExport.delete).toHaveBeenCalledWith({ where: { id: 'exp-del' } });
    expect(result).toEqual({ status: 'deleted' });
  });

  it('refreshes an export link for admins', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.userExport.update.mockResolvedValue({
      id: 'exp-refresh',
      linkExpiry: new Date('2026-06-10T10:00:00.000Z'),
    });

    const { result } = await callRoute('POST', '/admin/exports/:id/refresh', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' },
      params: { id: 'exp-refresh' },
    });

    expect(prisma.userExport.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'exp-refresh' } })
    );
    expect(result).toEqual(
      expect.objectContaining({ linkExpiry: new Date('2026-06-10T10:00:00.000Z') })
    );
  });

  it('deletes expired exports via admin cleanup endpoint', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.userExport.findMany.mockResolvedValue([
      { id: 'exp-old-1', zipKey: 'old-1.zip' },
      { id: 'exp-old-2', zipKey: 'old-2.zip' },
    ]);
    storage.deleteUserExportObject.mockResolvedValue(undefined);
    prisma.userExport.delete.mockResolvedValue({ id: 'deleted' });

    const { result } = await callRoute('POST', '/admin/exports/cleanup', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' },
    });

    expect(storage.deleteUserExportObject).toHaveBeenCalledWith('old-1.zip');
    expect(storage.deleteUserExportObject).toHaveBeenCalledWith('old-2.zip');
    expect(prisma.userExport.delete).toHaveBeenCalledWith({ where: { id: 'exp-old-1' } });
    expect(prisma.userExport.delete).toHaveBeenCalledWith({ where: { id: 'exp-old-2' } });
    expect(result).toEqual({ scanned: 2, removed: 2, errors: 0 });
  });
});

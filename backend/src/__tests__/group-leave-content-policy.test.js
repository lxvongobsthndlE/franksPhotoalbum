import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockPrismaClient,
  createMockReply,
  createMockRequest,
  createMockRouteFastify,
} from './mocks/index.js';

const deleteGroupPhotoObjects = vi.fn();
const createNotification = vi.fn(() => Promise.resolve());

vi.mock('../utils/storage.js', () => ({
  createGroupBackupZip: vi.fn(),
  deleteGroupPhotoObjects,
  deleteBackupObject: vi.fn(),
  getBackupStream: vi.fn(),
  getBackupStat: vi.fn(),
}));

vi.mock('../utils/notifications.js', () => ({
  createNotification,
}));

describe('group leave content policy', () => {
  let groupsRoutes;
  let fastify;
  let prisma;

  async function callGroupRoute(method, path, requestOverrides = {}) {
    const handler = fastify.routes[method].get(path);
    const request = createMockRequest({
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      ...requestOverrides,
    });
    const reply = createMockReply();
    const result = await handler(request, reply);
    return { request, reply, result };
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    groupsRoutes = (await import('../routes/groups.js')).default;
    prisma = createMockPrismaClient();
    fastify = createMockRouteFastify({ prisma });
    await groupsRoutes(fastify);
  });

  it('deletes own content in group when deleteOwnContent is true', async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ userId: 'member-1', groupId: 'group-1' });
    prisma.groupMember.count.mockResolvedValue(2);
    prisma.group.findUnique.mockResolvedValue({
      id: 'group-1',
      name: 'Team',
      createdBy: 'owner-1',
    });

    prisma.photo.findMany.mockResolvedValue([
      { id: 'photo-1', path: 'photos/p1.jpg' },
      { id: 'photo-2', path: 'photos/p2.jpg' },
    ]);
    prisma.like.deleteMany.mockResolvedValue({ count: 4 });
    prisma.comment.deleteMany.mockResolvedValue({ count: 3 });
    prisma.photoAlbum.deleteMany.mockResolvedValue({ count: 2 });
    prisma.photo.deleteMany.mockResolvedValue({ count: 2 });
    prisma.albumContributor.deleteMany.mockResolvedValue({ count: 1 });
    prisma.groupMember.delete.mockResolvedValue({});
    prisma.groupDeputy.deleteMany.mockResolvedValue({ count: 0 });
    prisma.user.findUnique.mockResolvedValue({ name: 'Member One', username: 'member1' });

    const { result } = await callGroupRoute('DELETE', '/:id/leave', {
      user: { id: 'member-1' },
      params: { id: 'group-1' },
      body: { deleteOwnContent: true },
    });

    expect(result).toEqual({
      ok: true,
      deletedOwnContent: true,
      deletedPhotos: 2,
      deletedComments: 3,
      deletedLikes: 4,
      deletedOwnedAlbums: 0,
      transferredOwnedAlbums: 0,
      removedAlbumContributorLinks: 1,
    });
    expect(prisma.albumContributor.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'member-1', album: { groupId: 'group-1' } },
    });
    expect(deleteGroupPhotoObjects).toHaveBeenCalledWith(['photos/p1.jpg', 'photos/p2.jpg']);
  });

  it('handles owner successor handover and notifies successor on leave', async () => {
    prisma.groupMember.findUnique
      .mockResolvedValueOnce({ userId: 'owner-1', groupId: 'group-1' })
      .mockResolvedValueOnce({ userId: 'member-2', groupId: 'group-1' });
    prisma.groupMember.count.mockResolvedValue(2);
    prisma.group.findUnique.mockResolvedValue({
      id: 'group-1',
      name: 'Team',
      createdBy: 'owner-1',
    });

    prisma.photo.findMany.mockResolvedValue([]);
    prisma.like.deleteMany.mockResolvedValue({ count: 0 });
    prisma.comment.deleteMany.mockResolvedValue({ count: 0 });
    prisma.albumContributor.deleteMany.mockResolvedValue({ count: 0 });
    prisma.group.update.mockResolvedValue({ id: 'group-1', createdBy: 'member-2' });
    prisma.groupDeputy.deleteMany.mockResolvedValue({ count: 0 });
    prisma.groupMember.delete.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({ name: 'Owner One', username: 'owner1' });

    const { result } = await callGroupRoute('DELETE', '/:id/leave', {
      user: { id: 'owner-1' },
      params: { id: 'group-1' },
      body: { successorId: 'member-2', deleteOwnContent: true },
    });

    expect(prisma.group.update).toHaveBeenCalledWith({
      where: { id: 'group-1' },
      data: { createdBy: 'member-2' },
    });
    expect(result.ok).toBe(true);
    expect(createNotification).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: 'member-2',
        type: 'groupMemberLeft',
        entityId: 'group-1',
      })
    );
  });

  it('deletes owned albums on leave with deleteOwnContent=true and removes contributor rights', async () => {
    prisma.groupMember.findUnique.mockResolvedValue({ userId: 'member-1', groupId: 'group-1' });
    prisma.groupMember.count.mockResolvedValue(2);
    prisma.group.findUnique.mockResolvedValue({
      id: 'group-1',
      name: 'Team',
      createdBy: 'owner-1',
    });

    prisma.album.findMany.mockResolvedValue([{ id: 'album-a' }, { id: 'album-b' }]);
    prisma.album.deleteMany.mockResolvedValue({ count: 2 });
    prisma.photo.findMany.mockResolvedValue([]);
    prisma.like.deleteMany.mockResolvedValue({ count: 0 });
    prisma.comment.deleteMany.mockResolvedValue({ count: 0 });
    prisma.groupMember.delete.mockResolvedValue({});
    prisma.groupDeputy.deleteMany.mockResolvedValue({ count: 0 });
    prisma.albumContributor.deleteMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({ name: 'Member One', username: 'member1' });

    const { result } = await callGroupRoute('DELETE', '/:id/leave', {
      user: { id: 'member-1' },
      params: { id: 'group-1' },
      body: { deleteOwnContent: true },
    });

    expect(result.ok).toBe(true);
    expect(prisma.album.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['album-a', 'album-b'] } },
    });
    expect(prisma.albumContributor.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'member-1', album: { groupId: 'group-1' } },
    });
  });

  it('transfers or deletes owned albums on leave without deleteOwnContent and removes contributor rights', async () => {
    prisma.groupMember.findUnique
      .mockResolvedValueOnce({ userId: 'member-1', groupId: 'group-1' })
      .mockResolvedValueOnce({ userId: 'member-2', groupId: 'group-1' });
    prisma.groupMember.count.mockResolvedValue(2);
    prisma.group.findUnique.mockResolvedValue({
      id: 'group-1',
      name: 'Team',
      createdBy: 'member-1',
    });

    prisma.album.findMany.mockResolvedValue([{ id: 'album-with-contrib' }, { id: 'album-empty' }]);
    prisma.albumContributor.findMany
      .mockResolvedValueOnce([{ userId: 'contrib-1' }])
      .mockResolvedValueOnce([]);
    prisma.album.update.mockResolvedValue({ id: 'album-with-contrib', createdBy: 'contrib-1' });
    prisma.album.delete.mockResolvedValue({ id: 'album-empty' });
    prisma.photo.findMany.mockResolvedValue([]);
    prisma.group.update.mockResolvedValue({ id: 'group-1', createdBy: 'member-2' });
    prisma.groupDeputy.deleteMany.mockResolvedValue({ count: 0 });
    prisma.groupMember.delete.mockResolvedValue({});
    prisma.albumContributor.deleteMany.mockResolvedValue({ count: 2 });
    prisma.user.findUnique.mockResolvedValue({ name: 'Member One', username: 'member1' });

    const { result } = await callGroupRoute('DELETE', '/:id/leave', {
      user: { id: 'member-1' },
      params: { id: 'group-1' },
      body: { successorId: 'member-2', deleteOwnContent: false },
    });

    expect(result).toEqual({
      ok: true,
      deletedOwnContent: false,
      deletedPhotos: 0,
      deletedComments: 0,
      deletedLikes: 0,
      deletedOwnedAlbums: 1,
      transferredOwnedAlbums: 1,
      removedAlbumContributorLinks: 2,
    });
    expect(prisma.album.update).toHaveBeenCalledWith({
      where: { id: 'album-with-contrib' },
      data: { createdBy: 'contrib-1' },
    });
    expect(prisma.album.delete).toHaveBeenCalledWith({ where: { id: 'album-empty' } });
    expect(prisma.albumContributor.deleteMany).toHaveBeenCalledWith({
      where: { albumId: 'album-with-contrib', userId: 'contrib-1' },
    });
    expect(prisma.albumContributor.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'member-1', album: { groupId: 'group-1' } },
    });
  });

  it('rejects deputy when trying to remove the group owner', async () => {
    prisma.group.findUnique.mockResolvedValue({
      id: 'group-1',
      name: 'Team',
      createdBy: 'owner-1',
    });
    prisma.groupDeputy.findUnique.mockResolvedValue({ groupId: 'group-1', userId: 'deputy-1' });
    prisma.groupMember.findUnique.mockResolvedValue({ userId: 'owner-1', groupId: 'group-1' });
    prisma.user.findUnique.mockResolvedValue({ role: 'user', name: 'Owner', username: 'owner' });

    const { reply } = await callGroupRoute('POST', '/:id/members/:memberId/remove', {
      user: { id: 'deputy-1' },
      params: { id: 'group-1', memberId: 'owner-1' },
      body: { blockUser: false },
    });

    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toEqual({ error: 'Vertreter dürfen den Owner nicht entfernen' });
  });

  it('returns admin_removal_requested when target is admin', async () => {
    prisma.group.findUnique.mockResolvedValue({
      id: 'group-1',
      name: 'Team',
      createdBy: 'owner-1',
    });
    prisma.groupMember.findUnique.mockResolvedValue({ userId: 'admin-2', groupId: 'group-1' });
    prisma.user.findUnique.mockImplementation(async ({ where }) => {
      if (where?.id === 'admin-2') return { role: 'admin', name: 'Admin', username: 'admin' };
      if (where?.id === 'owner-1') return { role: 'user', name: 'Owner', username: 'owner' };
      return null;
    });

    const { reply, result } = await callGroupRoute('POST', '/:id/members/:memberId/remove', {
      user: { id: 'owner-1' },
      params: { id: 'group-1', memberId: 'admin-2' },
      body: { blockUser: true },
    });

    expect(reply.statusCode).toBe(202);
    expect(reply.payload).toEqual({ status: 'admin_removal_requested' });
    expect(createNotification).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: 'admin-2',
        type: 'system',
        entityId: 'group-1',
      })
    );
  });

  it('removes member content and creates group block when requested', async () => {
    prisma.group.findUnique.mockResolvedValue({
      id: 'group-1',
      name: 'Team',
      createdBy: 'owner-1',
    });
    prisma.groupMember.findUnique.mockResolvedValue({ userId: 'member-2', groupId: 'group-1' });
    prisma.user.findUnique.mockResolvedValue({
      role: 'user',
      name: 'Member Two',
      username: 'member2',
    });
    prisma.groupMember.count.mockResolvedValue(2);

    prisma.album.findMany.mockResolvedValue([{ id: 'album-1' }]);
    prisma.album.deleteMany.mockResolvedValue({ count: 1 });
    prisma.photo.findMany.mockResolvedValue([{ id: 'photo-1', path: 'photos/p1.jpg' }]);
    prisma.like.deleteMany.mockResolvedValue({ count: 3 });
    prisma.comment.deleteMany.mockResolvedValue({ count: 2 });
    prisma.photoAlbum.deleteMany.mockResolvedValue({ count: 1 });
    prisma.photo.deleteMany.mockResolvedValue({ count: 1 });
    prisma.groupMember.delete.mockResolvedValue({});
    prisma.groupDeputy.deleteMany.mockResolvedValue({ count: 0 });
    prisma.albumContributor.deleteMany.mockResolvedValue({ count: 2 });
    prisma.groupBlock.upsert.mockResolvedValue({ groupId: 'group-1', userId: 'member-2' });

    const { result } = await callGroupRoute('POST', '/:id/members/:memberId/remove', {
      user: { id: 'owner-1' },
      params: { id: 'group-1', memberId: 'member-2' },
      body: { blockUser: true },
    });

    expect(result).toEqual({
      status: 'removed',
      blocked: true,
      deletedPhotos: 1,
      deletedComments: 2,
      deletedLikes: 3,
      deletedOwnedAlbums: 1,
      removedAlbumContributorLinks: 2,
    });
    expect(prisma.groupBlock.upsert).toHaveBeenCalledWith({
      where: { groupId_userId: { groupId: 'group-1', userId: 'member-2' } },
      create: { groupId: 'group-1', userId: 'member-2', blockedBy: 'owner-1' },
      update: { blockedBy: 'owner-1' },
    });
    expect(deleteGroupPhotoObjects).toHaveBeenCalledWith(['photos/p1.jpg']);
  });
});

/**
 * Integration-nahe Permission-Tests gegen echte Album- und Photo-Route-Handler.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockPrismaClient,
  createMockReply,
  createMockRequest,
  createMockRouteFastify,
} from './mocks/index.js';
import {
  createMockAlbum,
  createMockGroup,
  createMockPhoto,
  createMockUser,
} from './fixtures/index.js';

vi.mock('../utils/notifications.js', () => ({
  createNotification: vi.fn(() => Promise.resolve()),
}));

vi.mock('../utils/storage.js', () => ({
  uploadPhoto: vi.fn(),
  deletePhoto: vi.fn(),
  getPhotoStream: vi.fn(),
  getPhotoStat: vi.fn(),
}));

describe('route permissions', () => {
  let albumsRoutes;
  let photosRoutes;
  let commentsRoutes;
  let likesRoutes;
  let albumsFastify;
  let photosFastify;
  let commentsFastify;
  let likesFastify;
  let prisma;

  async function callAlbumRoute(method, path, requestOverrides = {}) {
    const handler = albumsFastify.routes[method].get(path);
    const request = createMockRequest({
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      ...requestOverrides,
    });
    const reply = createMockReply();
    const result = await handler(request, reply);
    return { request, reply, result };
  }

  async function callPhotoRoute(method, path, requestOverrides = {}) {
    const handler = photosFastify.routes[method].get(path);
    const request = createMockRequest({
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      ...requestOverrides,
    });
    const reply = createMockReply();
    const result = await handler(request, reply);
    return { request, reply, result };
  }

  async function callCommentRoute(method, path, requestOverrides = {}) {
    const handler = commentsFastify.routes[method].get(path);
    const request = createMockRequest({
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      ...requestOverrides,
    });
    const reply = createMockReply();
    const result = await handler(request, reply);
    return { request, reply, result };
  }

  async function callLikeRoute(method, path, requestOverrides = {}) {
    const handler = likesFastify.routes[method].get(path);
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
    albumsRoutes = (await import('../routes/albums.js')).default;
    photosRoutes = (await import('../routes/photos.js')).default;
    commentsRoutes = (await import('../routes/comments.js')).default;
    likesRoutes = (await import('../routes/likes.js')).default;
    prisma = createMockPrismaClient();
    albumsFastify = createMockRouteFastify({ prisma });
    photosFastify = createMockRouteFastify({ prisma });
    commentsFastify = createMockRouteFastify({ prisma });
    likesFastify = createMockRouteFastify({ prisma });
    await albumsRoutes(albumsFastify);
    await photosRoutes(photosFastify);
    await commentsRoutes(commentsFastify);
    await likesRoutes(likesFastify);
  });

  describe('albums routes', () => {
    it('allows a group member to create an album', async () => {
      prisma.groupMember.findUnique.mockResolvedValue({ userId: 'member-1', groupId: 'group-1' });
      prisma.album.create.mockResolvedValue({
        ...createMockAlbum({
          id: 'album-1',
          name: 'Roadtrip',
          groupId: 'group-1',
          createdBy: 'member-1',
        }),
        _count: { photos: 0 },
        contributors: [],
      });
      prisma.groupMember.findMany.mockResolvedValue([
        { userId: 'member-1' },
        { userId: 'member-2' },
      ]);
      prisma.group.findUnique.mockResolvedValue({ name: 'Team Group' });
      prisma.user.findUnique.mockResolvedValue({ name: 'Member One', username: 'member1' });

      const { result } = await callAlbumRoute('POST', '/', {
        user: { id: 'member-1' },
        body: { name: 'Roadtrip', groupId: 'group-1' },
      });

      expect(prisma.album.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: 'Roadtrip', groupId: 'group-1', createdBy: 'member-1' },
        })
      );
      expect(result.name).toBe('Roadtrip');
    });

    it('rejects album creation for non-members who are not admins', async () => {
      prisma.groupMember.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ role: 'user' });

      const { reply } = await callAlbumRoute('POST', '/', {
        user: { id: 'outsider' },
        body: { name: 'Roadtrip', groupId: 'group-1' },
      });

      expect(reply.statusCode).toBe(403);
      expect(reply.payload).toEqual({ error: 'Nur Gruppenmitglieder können Alben erstellen' });
    });

    it('allows app admins to create an album without group membership', async () => {
      prisma.groupMember.findUnique.mockResolvedValue(null);
      prisma.user.findUnique
        .mockResolvedValueOnce({ role: 'admin' })
        .mockResolvedValueOnce({ name: 'Admin', username: 'admin' });
      prisma.album.create.mockResolvedValue({
        ...createMockAlbum({
          id: 'album-2',
          name: 'Admin Album',
          groupId: 'group-1',
          createdBy: 'admin-1',
        }),
        _count: { photos: 0 },
        contributors: [],
      });
      prisma.groupMember.findMany.mockResolvedValue([{ userId: 'admin-1' }]);
      prisma.group.findUnique.mockResolvedValue({ name: 'Team Group' });

      const { result } = await callAlbumRoute('POST', '/', {
        user: { id: 'admin-1' },
        body: { name: 'Admin Album', groupId: 'group-1' },
      });

      expect(result.name).toBe('Admin Album');
    });

    it('rejects album creation for normal members when album lock is enabled', async () => {
      prisma.groupMember.findUnique.mockResolvedValue({ userId: 'member-1', groupId: 'group-1' });
      prisma.user.findUnique.mockResolvedValue({ role: 'user' });
      prisma.group.findUnique.mockResolvedValue({
        name: 'Team Group',
        createdBy: 'owner-1',
        albumsRestrictedToModerators: true,
      });
      prisma.groupDeputy.findUnique.mockResolvedValue(null);

      const { reply } = await callAlbumRoute('POST', '/', {
        user: { id: 'member-1' },
        body: { name: 'Blocked Album', groupId: 'group-1' },
      });

      expect(reply.statusCode).toBe(403);
      expect(reply.payload).toEqual({
        error: 'Alben erstellen ist in dieser Gruppe für Mitglieder gesperrt',
        code: 'albums_locked_for_members',
      });
    });

    it('allows group owner to create albums when album lock is enabled', async () => {
      prisma.groupMember.findUnique.mockResolvedValue({ userId: 'owner-1', groupId: 'group-1' });
      prisma.user.findUnique.mockResolvedValue({ name: 'Owner', username: 'owner1' });
      prisma.group.findUnique.mockResolvedValue({
        name: 'Team Group',
        createdBy: 'owner-1',
        albumsRestrictedToModerators: true,
      });
      prisma.album.create.mockResolvedValue({
        ...createMockAlbum({
          id: 'album-locked-1',
          name: 'Owner Album',
          groupId: 'group-1',
          createdBy: 'owner-1',
        }),
        _count: { photos: 0 },
        contributors: [],
      });
      prisma.groupMember.findMany.mockResolvedValue([{ userId: 'owner-1' }]);

      const { result } = await callAlbumRoute('POST', '/', {
        user: { id: 'owner-1' },
        body: { name: 'Owner Album', groupId: 'group-1' },
      });

      expect(result.name).toBe('Owner Album');
    });

    it('allows the album owner to rename an album', async () => {
      prisma.album.findUnique.mockResolvedValue(
        createMockAlbum({ id: 'album-1', groupId: 'group-1', createdBy: 'owner-1' })
      );
      prisma.groupMember.findUnique.mockResolvedValue({ userId: 'owner-1', groupId: 'group-1' });
      prisma.album.update.mockResolvedValue({ id: 'album-1', name: 'Renamed Album' });

      const { result } = await callAlbumRoute('PATCH', '/:id', {
        user: { id: 'owner-1' },
        params: { id: 'album-1' },
        body: { name: 'Renamed Album' },
      });

      expect(result).toEqual({ id: 'album-1', name: 'Renamed Album' });
    });

    it('allows a group owner to rename an album they did not create', async () => {
      prisma.album.findUnique.mockResolvedValue(
        createMockAlbum({ id: 'album-1', groupId: 'group-1', createdBy: 'album-owner' })
      );
      prisma.user.findUnique.mockResolvedValue({ role: 'user' });
      prisma.groupMember.findUnique.mockResolvedValue({
        userId: 'group-owner',
        groupId: 'group-1',
      });
      prisma.group.findUnique.mockResolvedValue({ createdBy: 'group-owner' });
      prisma.album.update.mockResolvedValue({ id: 'album-1', name: 'Group Owner Rename' });

      const { result } = await callAlbumRoute('PATCH', '/:id', {
        user: { id: 'group-owner' },
        params: { id: 'album-1' },
        body: { name: 'Group Owner Rename' },
      });

      expect(result.name).toBe('Group Owner Rename');
    });

    it('allows a group deputy to rename an album', async () => {
      prisma.album.findUnique.mockResolvedValue(
        createMockAlbum({ id: 'album-1', groupId: 'group-1', createdBy: 'album-owner' })
      );
      prisma.user.findUnique.mockResolvedValue({ role: 'user' });
      prisma.groupMember.findUnique.mockResolvedValue({ userId: 'deputy-1', groupId: 'group-1' });
      prisma.group.findUnique.mockResolvedValue({ createdBy: 'someone-else' });
      prisma.groupDeputy.findUnique.mockResolvedValue({ groupId: 'group-1', userId: 'deputy-1' });
      prisma.album.update.mockResolvedValue({ id: 'album-1', name: 'Deputy Rename' });

      const { result } = await callAlbumRoute('PATCH', '/:id', {
        user: { id: 'deputy-1' },
        params: { id: 'album-1' },
        body: { name: 'Deputy Rename' },
      });

      expect(result.name).toBe('Deputy Rename');
    });

    it('allows an admin to rename an album', async () => {
      prisma.album.findUnique.mockResolvedValue(
        createMockAlbum({ id: 'album-1', groupId: 'group-1', createdBy: 'album-owner' })
      );
      prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
      prisma.album.update.mockResolvedValue({ id: 'album-1', name: 'Admin Rename' });

      const { result } = await callAlbumRoute('PATCH', '/:id', {
        user: { id: 'admin-1' },
        params: { id: 'album-1' },
        body: { name: 'Admin Rename' },
      });

      expect(result.name).toBe('Admin Rename');
    });

    it('rejects a plain member when renaming someone else’s album', async () => {
      prisma.album.findUnique.mockResolvedValue(
        createMockAlbum({ id: 'album-1', groupId: 'group-1', createdBy: 'album-owner' })
      );
      prisma.user.findUnique.mockResolvedValue({ role: 'user' });
      prisma.groupMember.findUnique.mockResolvedValue({ userId: 'member-1', groupId: 'group-1' });
      prisma.group.findUnique.mockResolvedValue({ createdBy: 'group-owner' });
      prisma.groupDeputy.findUnique.mockResolvedValue(null);

      const { reply } = await callAlbumRoute('PATCH', '/:id', {
        user: { id: 'member-1' },
        params: { id: 'album-1' },
        body: { name: 'Blocked Rename' },
      });

      expect(reply.statusCode).toBe(403);
      expect(reply.payload).toEqual({ error: 'Nur der Ersteller kann das Album umbenennen' });
    });

    it('allows a deputy to add an album contributor but rejects non-members as targets', async () => {
      prisma.album.findUnique.mockResolvedValue(
        createMockAlbum({
          id: 'album-1',
          name: 'Shared Album',
          groupId: 'group-1',
          createdBy: 'album-owner',
        })
      );
      prisma.user.findUnique.mockImplementation(async ({ where }) => {
        if (where?.id === 'target-user') {
          return {
            id: 'target-user',
            username: 'target',
            name: 'Target User',
            color: '#fff',
            avatar: null,
          };
        }
        return { role: 'user' };
      });
      prisma.group.findUnique.mockResolvedValue({ createdBy: 'group-owner' });
      prisma.groupDeputy.findUnique.mockResolvedValue({ groupId: 'group-1', userId: 'deputy-1' });
      prisma.groupMember.findUnique.mockImplementation(async ({ where }) => {
        const pair = where?.userId_groupId;
        if (!pair) return null;
        if (pair.userId === 'deputy-1' && pair.groupId === 'group-1') {
          return { userId: 'deputy-1', groupId: 'group-1' };
        }
        if (pair.userId === 'target-user' && pair.groupId === 'group-1') {
          return { userId: 'target-user', groupId: 'group-1' };
        }
        return null;
      });
      prisma.albumContributor.upsert.mockResolvedValue({});

      const success = await callAlbumRoute('POST', '/:id/contributors', {
        user: { id: 'deputy-1' },
        params: { id: 'album-1' },
        body: { userId: 'target-user' },
      });
      expect(success.result.id).toBe('target-user');

      const failure = await callAlbumRoute('POST', '/:id/contributors', {
        user: { id: 'deputy-1' },
        params: { id: 'album-1' },
        body: { userId: 'outsider' },
      });
      expect(failure.reply.statusCode).toBe(400);
      expect(failure.reply.payload).toEqual({ error: 'User ist kein Mitglied dieser Gruppe' });
    });

    it('returns 500 when album rename hits a database error', async () => {
      prisma.album.findUnique.mockRejectedValue(new Error('db down'));

      const { reply } = await callAlbumRoute('PATCH', '/:id', {
        user: { id: 'owner-1' },
        params: { id: 'album-1' },
        body: { name: 'Renamed Album' },
      });

      expect(reply.statusCode).toBe(500);
      expect(reply.payload).toEqual({ error: 'Umbenennung fehlgeschlagen' });
    });

    it('rejects album listing for non-members', async () => {
      prisma.user.findUnique.mockResolvedValue({ role: 'user' });
      prisma.groupMember.findUnique.mockResolvedValue(null);

      const { reply } = await callAlbumRoute('GET', '/', {
        user: { id: 'outsider' },
        query: { groupId: 'group-1' },
      });

      expect(reply.statusCode).toBe(403);
      expect(reply.payload).toEqual({
        error: 'Du bist nicht Mitglied dieser Gruppe',
        code: 'not_group_member',
      });
    });

    it('rejects album rename for former creators who are no longer group members', async () => {
      prisma.album.findUnique.mockResolvedValue(
        createMockAlbum({ id: 'album-1', groupId: 'group-1', createdBy: 'former-creator' })
      );
      prisma.user.findUnique.mockResolvedValue({ role: 'user' });
      prisma.groupMember.findUnique.mockResolvedValue(null);

      const { reply } = await callAlbumRoute('PATCH', '/:id', {
        user: { id: 'former-creator' },
        params: { id: 'album-1' },
        body: { name: 'Blocked' },
      });

      expect(reply.statusCode).toBe(403);
      expect(reply.payload).toEqual({
        error: 'Du bist nicht Mitglied dieser Gruppe',
        code: 'not_group_member',
      });
    });
  });

  describe('photos routes', () => {
    it('allows an album contributor to batch-assign photos', async () => {
      prisma.album.findUnique.mockResolvedValue(
        createMockAlbum({ id: 'album-1', groupId: 'group-1', createdBy: 'album-owner' })
      );
      prisma.user.findUnique.mockResolvedValue({ role: 'user' });
      prisma.group.findUnique.mockResolvedValue({ createdBy: 'group-owner' });
      prisma.groupDeputy.findUnique.mockResolvedValue(null);
      prisma.groupMember.findUnique.mockResolvedValue({ userId: 'contrib-1', groupId: 'group-1' });
      prisma.albumContributor.findUnique.mockResolvedValue({
        albumId: 'album-1',
        userId: 'contrib-1',
      });
      prisma.photoAlbum.createMany.mockResolvedValue({ count: 2 });

      const { result } = await callPhotoRoute('PATCH', '/batch-album', {
        user: { id: 'contrib-1' },
        body: { albumId: 'album-1', photoIds: ['photo-1', 'photo-2'] },
      });

      expect(result).toEqual({ status: 'updated', count: 2 });
    });

    it('allows a group deputy to batch-assign photos', async () => {
      prisma.album.findUnique.mockResolvedValue(
        createMockAlbum({ id: 'album-1', groupId: 'group-1', createdBy: 'album-owner' })
      );
      prisma.user.findUnique.mockResolvedValue({ role: 'user' });
      prisma.groupMember.findUnique.mockResolvedValue({ userId: 'deputy-1', groupId: 'group-1' });
      prisma.group.findUnique.mockResolvedValue({ createdBy: 'group-owner' });
      prisma.groupDeputy.findUnique.mockResolvedValue({ groupId: 'group-1', userId: 'deputy-1' });
      prisma.photoAlbum.createMany.mockResolvedValue({ count: 1 });

      const { result } = await callPhotoRoute('PATCH', '/batch-album', {
        user: { id: 'deputy-1' },
        body: { albumId: 'album-1', photoIds: ['photo-1'] },
      });

      expect(result).toEqual({ status: 'updated', count: 1 });
    });

    it('rejects a plain member without contributor rights for batch updates', async () => {
      prisma.album.findUnique.mockResolvedValue(
        createMockAlbum({ id: 'album-1', groupId: 'group-1', createdBy: 'album-owner' })
      );
      prisma.user.findUnique.mockResolvedValue({ role: 'user' });
      prisma.groupMember.findUnique.mockResolvedValue({ userId: 'member-1', groupId: 'group-1' });
      prisma.group.findUnique.mockResolvedValue({ createdBy: 'group-owner' });
      prisma.groupDeputy.findUnique.mockResolvedValue(null);
      prisma.albumContributor.findUnique.mockResolvedValue(null);

      const { reply } = await callPhotoRoute('PATCH', '/batch-album', {
        user: { id: 'member-1' },
        body: { albumId: 'album-1', photoIds: ['photo-1'] },
      });

      expect(reply.statusCode).toBe(403);
      expect(reply.payload).toEqual({ error: 'Keine Berechtigung für dieses Album' });
    });

    it('returns 400 for invalid batch payloads', async () => {
      const { reply } = await callPhotoRoute('PATCH', '/batch-album', {
        user: { id: 'member-1' },
        body: { albumId: 'album-1', photoIds: 'not-an-array' },
      });

      expect(reply.statusCode).toBe(400);
      expect(reply.payload).toEqual({ error: 'photoIds erforderlich' });
    });

    it('rejects album reassignment when one target album is not accessible', async () => {
      prisma.photo.findUnique.mockResolvedValue(
        createMockPhoto({ id: 'photo-1', uploaderId: 'uploader-1', groupId: 'group-1' })
      );
      prisma.user.findUnique.mockResolvedValue({ role: 'user' });
      prisma.groupMember.findUnique.mockResolvedValue({ userId: 'member-1', groupId: 'group-1' });
      prisma.album.findUnique.mockResolvedValue(
        createMockAlbum({ id: 'album-allowed', groupId: 'group-1', createdBy: 'someone-else' })
      );
      prisma.group.findUnique.mockResolvedValue({ createdBy: 'group-owner' });
      prisma.groupDeputy.findUnique.mockResolvedValue(null);
      prisma.albumContributor.findUnique.mockResolvedValue(null);

      const { reply } = await callPhotoRoute('PATCH', '/:id', {
        user: { id: 'member-1' },
        params: { id: 'photo-1' },
        body: { albumIds: ['album-allowed'] },
      });

      expect(reply.statusCode).toBe(403);
      expect(reply.payload).toEqual({ error: 'Keine Berechtigung für Album album-allowed' });
    });

    it('returns 404 for missing photos when changing album assignments', async () => {
      prisma.photo.findUnique.mockResolvedValue(null);

      const { reply } = await callPhotoRoute('PATCH', '/:id', {
        user: { id: 'member-1' },
        params: { id: 'photo-404' },
        body: { albumId: 'album-1' },
      });

      expect(reply.statusCode).toBe(404);
      expect(reply.payload).toEqual({ error: 'Foto nicht gefunden' });
    });

    it('rejects photo list access for non-members', async () => {
      prisma.user.findUnique.mockResolvedValue({ role: 'user' });
      prisma.groupMember.findUnique.mockResolvedValue(null);

      const { reply } = await callPhotoRoute('GET', '/', {
        user: { id: 'outsider' },
        query: { groupId: 'group-1' },
      });

      expect(reply.statusCode).toBe(403);
      expect(reply.payload).toEqual({
        error: 'Du bist nicht Mitglied dieser Gruppe',
        code: 'not_group_member',
      });
    });

    it('returns 500 when a batch update throws inside the photo route', async () => {
      prisma.album.findUnique.mockRejectedValue(new Error('db down'));

      const { reply } = await callPhotoRoute('PATCH', '/batch-album', {
        user: { id: 'member-1' },
        body: { albumId: 'album-1', photoIds: ['photo-1'] },
      });

      expect(reply.statusCode).toBe(500);
      expect(reply.payload).toEqual({ error: 'Batch-Update fehlgeschlagen' });
    });

    it('allows group deputies to delete photos from other uploaders', async () => {
      prisma.photo.findUnique.mockResolvedValue(
        createMockPhoto({ id: 'photo-1', uploaderId: 'uploader-1', groupId: 'group-1' })
      );
      prisma.user.findUnique.mockResolvedValue({ role: 'user' });
      prisma.groupMember.findUnique.mockResolvedValue({ userId: 'deputy-1', groupId: 'group-1' });
      prisma.group.findUnique.mockResolvedValue({ createdBy: 'group-owner' });
      prisma.groupDeputy.findUnique.mockResolvedValue({ groupId: 'group-1', userId: 'deputy-1' });
      prisma.photo.delete.mockResolvedValue({ id: 'photo-1' });

      const { result } = await callPhotoRoute('DELETE', '/:id', {
        user: { id: 'deputy-1' },
        params: { id: 'photo-1' },
      });

      expect(result).toEqual({ status: 'deleted' });
      expect(prisma.photo.delete).toHaveBeenCalledWith({ where: { id: 'photo-1' } });
    });

    it('rejects admin photo deletion when admin is not group member', async () => {
      prisma.photo.findUnique.mockResolvedValue(
        createMockPhoto({ id: 'photo-1', uploaderId: 'uploader-1', groupId: 'group-1' })
      );
      prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
      prisma.groupMember.findUnique.mockResolvedValue(null);
      prisma.group.findUnique.mockResolvedValue({ createdBy: 'group-owner' });
      prisma.groupDeputy.findUnique.mockResolvedValue(null);

      const { reply } = await callPhotoRoute('DELETE', '/:id', {
        user: { id: 'admin-1' },
        params: { id: 'photo-1' },
      });

      expect(reply.statusCode).toBe(403);
      expect(reply.payload).toEqual({
        error: 'Du kannst nur eigene Fotos oder als Moderator löschen',
      });
    });

    it('should sort by specified field', async () => {
      const albums = [
        { id: 'album-1', name: 'A Album', createdAt: new Date('2025-01-10') },
        { id: 'album-2', name: 'Z Album', createdAt: new Date('2025-01-20') },
      ];

      prisma.album.findMany.mockResolvedValue(albums);

      const getAlbums = async (prisma, sortBy = 'createdAt') => {
        return await prisma.album.findMany({
          orderBy: { [sortBy]: 'desc' },
        });
      };

      const sorted = await getAlbums(prisma, 'name');

      expect(sorted).toHaveLength(2);
      expect(prisma.album.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'desc' } })
      );
    });
  });

  describe('comments and likes routes', () => {
    it('rejects comment creation for non-members', async () => {
      prisma.photo.findUnique.mockResolvedValue({
        id: 'photo-1',
        uploaderId: 'uploader-1',
        groupId: 'group-1',
      });
      prisma.user.findUnique.mockResolvedValue({ role: 'user' });
      prisma.groupMember.findUnique.mockResolvedValue(null);

      const { reply } = await callCommentRoute('POST', '/', {
        user: { id: 'outsider' },
        body: { photoId: 'photo-1', content: 'test' },
      });

      expect(reply.statusCode).toBe(403);
      expect(reply.payload).toEqual({
        error: 'Du bist nicht Mitglied dieser Gruppe',
        code: 'not_group_member',
      });
    });

    it('allows admin comment creation without membership', async () => {
      prisma.photo.findUnique.mockResolvedValue({
        id: 'photo-1',
        uploaderId: 'uploader-1',
        groupId: 'group-1',
      });
      prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
      prisma.comment.create.mockResolvedValue({
        id: 'comment-1',
        user: { id: 'admin-1', name: 'Admin', username: 'admin' },
      });

      const { result } = await callCommentRoute('POST', '/', {
        user: { id: 'admin-1' },
        body: { photoId: 'photo-1', content: 'admin test' },
      });

      expect(result.id).toBe('comment-1');
    });

    it('rejects like creation for non-members', async () => {
      prisma.photo.findUnique.mockResolvedValue({
        id: 'photo-1',
        uploaderId: 'uploader-1',
        groupId: 'group-1',
      });
      prisma.user.findUnique.mockResolvedValue({ role: 'user' });
      prisma.groupMember.findUnique.mockResolvedValue(null);

      const { reply } = await callLikeRoute('POST', '/', {
        user: { id: 'outsider' },
        body: { photoId: 'photo-1' },
      });

      expect(reply.statusCode).toBe(403);
      expect(reply.payload).toEqual({
        error: 'Du bist nicht Mitglied dieser Gruppe',
        code: 'not_group_member',
      });
    });

    it('rejects unlike for non-members', async () => {
      prisma.like.findUnique.mockResolvedValue({ id: 'like-1', photoId: 'photo-1', userId: 'u-1' });
      prisma.photo.findUnique.mockResolvedValue({ id: 'photo-1', groupId: 'group-1' });
      prisma.user.findUnique.mockResolvedValue({ role: 'user' });
      prisma.groupMember.findUnique.mockResolvedValue(null);

      const { reply } = await callLikeRoute('DELETE', '/:photoId', {
        user: { id: 'u-1' },
        params: { photoId: 'photo-1' },
      });

      expect(reply.statusCode).toBe(403);
      expect(reply.payload).toEqual({
        error: 'Du bist nicht Mitglied dieser Gruppe',
        code: 'not_group_member',
      });
    });

    it('allows a deputy to delete another users comment in their group', async () => {
      prisma.comment.findUnique.mockResolvedValue({
        id: 'comment-1',
        userId: 'commenter-1',
        photo: { groupId: 'group-1' },
      });
      prisma.user.findUnique.mockResolvedValue({ role: 'user' });
      prisma.groupMember.findUnique.mockResolvedValue({ userId: 'deputy-1', groupId: 'group-1' });
      prisma.group.findUnique.mockResolvedValue({ createdBy: 'group-owner' });
      prisma.groupDeputy.findUnique.mockResolvedValue({ groupId: 'group-1', userId: 'deputy-1' });
      prisma.comment.delete.mockResolvedValue({ id: 'comment-1' });

      const { result } = await callCommentRoute('DELETE', '/:id', {
        user: { id: 'deputy-1' },
        params: { id: 'comment-1' },
      });

      expect(result).toEqual({ status: 'deleted' });
      expect(prisma.comment.delete).toHaveBeenCalledWith({ where: { id: 'comment-1' } });
    });

    it('rejects admin comment deletion when admin is not group member', async () => {
      prisma.comment.findUnique.mockResolvedValue({
        id: 'comment-1',
        userId: 'commenter-1',
        photo: { groupId: 'group-1' },
      });
      prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
      prisma.groupMember.findUnique.mockResolvedValue(null);
      prisma.group.findUnique.mockResolvedValue({ createdBy: 'group-owner' });
      prisma.groupDeputy.findUnique.mockResolvedValue(null);

      const { reply } = await callCommentRoute('DELETE', '/:id', {
        user: { id: 'admin-1' },
        params: { id: 'comment-1' },
      });

      expect(reply.statusCode).toBe(403);
      expect(reply.payload).toEqual({
        error: 'Du kannst nur eigene Kommentare oder als Moderator löschen',
      });
    });
  });
});

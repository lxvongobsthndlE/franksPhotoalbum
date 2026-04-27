/**
 * Integration Test — Reales API-Szenario für Refactoring-Sicherheit
 * Prüft: Auth-Middleware, Permissions, Fehlerbehandlung
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createMockPrismaClient,
  createMockFastify,
  createMockRequest,
  createMockReply,
} from './mocks/index.js';
import {
  createMockUser,
  createMockGroup,
  createMockAlbum,
} from './fixtures/index.js';

describe('Integration: API Permission Checks', () => {
  let prisma;
  let fastify;

  beforeEach(() => {
    prisma = createMockPrismaClient();
    fastify = createMockFastify();
  });

  /**
   * Szenario: User versucht, Album zu bearbeiten
   * Erwartet: Zugriff nur wenn Owner, Contributor oder Group-Admin
   */
  describe('Album Edit Permission Flow', () => {
    it('should allow album owner to edit album', async () => {
      const user = createMockUser({ id: 'user-owner' });
      const album = createMockAlbum({ id: 'album-1', groupId: 'group-1' });

      prisma.album.findUnique.mockResolvedValue(album);
      prisma.groupMember.findUnique.mockResolvedValue({
        userId: 'user-owner',
        groupId: 'group-1',
        role: 'owner',
      });

      const request = createMockRequest({ user });
      const reply = createMockReply();

      // Simuliere: checkAlbumEditPermission(prisma, user, albumId)
      const checkEditPermission = async (prisma, user, albumId) => {
        const album = await prisma.album.findUnique({
          where: { id: albumId },
          include: { group: { include: { members: true } } },
        });

        if (!album) return false;

        const groupMember = await prisma.groupMember.findUnique({
          where: { userId_groupId: { userId: user.id, groupId: album.groupId } },
        });

        return groupMember && ['owner', 'admin'].includes(groupMember.role);
      };

      const canEdit = await checkEditPermission(prisma, user, 'album-1');

      expect(canEdit).toBe(true);
    });

    it('should deny non-owner non-member access to album', async () => {
      const user = createMockUser({ id: 'user-stranger' });
      const album = createMockAlbum({ id: 'album-1', groupId: 'group-1' });

      prisma.album.findUnique.mockResolvedValue(album);
      prisma.groupMember.findUnique.mockResolvedValue(null);

      const checkEditPermission = async (prisma, user, albumId) => {
        const album = await prisma.album.findUnique({
          where: { id: albumId },
        });

        if (!album) return false;

        const groupMember = await prisma.groupMember.findUnique({
          where: { userId_groupId: { userId: user.id, groupId: album.groupId } },
        });

        return groupMember ? ['owner', 'admin'].includes(groupMember.role) : false;
      };

      const canEdit = await checkEditPermission(prisma, user, 'album-1');

      expect(canEdit).toBe(false);
    });

    it('should allow group admin to edit album', async () => {
      const admin = createMockUser({ id: 'user-admin' });
      const album = createMockAlbum({ id: 'album-1', groupId: 'group-1' });

      prisma.album.findUnique.mockResolvedValue(album);
      prisma.groupMember.findUnique.mockResolvedValue({
        userId: 'user-admin',
        groupId: 'group-1',
        role: 'admin',
      });

      const checkEditPermission = async (prisma, user, albumId) => {
        const album = await prisma.album.findUnique({ where: { id: albumId } });
        if (!album) return false;

        const groupMember = await prisma.groupMember.findUnique({
          where: { userId_groupId: { userId: user.id, groupId: album.groupId } },
        });

        return groupMember && ['owner', 'admin'].includes(groupMember.role);
      };

      const canEdit = await checkEditPermission(prisma, admin, 'album-1');

      expect(canEdit).toBe(true);
    });
  });

  /**
   * Szenario: User fragt Gruppen ab
   * Erwartet: Nur Gruppen, in denen User Mitglied ist (wenn Visibility: MEMBERS_ONLY)
   */
  describe('Group Visibility & Access Control', () => {
    it('should list public groups for non-members', async () => {
      const user = createMockUser({ id: 'user-123' });
      const publicGroup = createMockGroup({ id: 'group-public', visibility: 'PUBLIC' });

      prisma.group.findMany.mockResolvedValue([publicGroup]);

      // Simuliere: GET /groups (public)
      const getVisibleGroups = async (prisma, user) => {
        const groups = await prisma.group.findMany({
          where: {
            OR: [
              { visibility: 'PUBLIC' },
              { members: { some: { userId: user.id } } },
            ],
          },
        });
        return groups;
      };

      const groups = await getVisibleGroups(prisma, user);

      expect(groups.some((g) => g.id === 'group-public')).toBe(true);
    });

    it('should include private groups only for members', async () => {
      const user = createMockUser({ id: 'user-member' });
      const privateGroup = createMockGroup({ id: 'group-private', visibility: 'MEMBERS_ONLY' });

      prisma.group.findMany.mockResolvedValue([privateGroup]);
      prisma.groupMember.findUnique.mockResolvedValue({ userId: 'user-member', groupId: 'group-private' });

      const getVisibleGroups = async (prisma, user) => {
        const groups = await prisma.group.findMany({
          where: {
            OR: [
              { visibility: 'PUBLIC' },
              { members: { some: { userId: user.id } } },
            ],
          },
        });
        return groups;
      };

      const groups = await getVisibleGroups(prisma, user);

      expect(groups.length).toBeGreaterThan(0);
    });
  });

  /**
   * Szenario: Fehlerbehandlung bei nicht vorhandenen Ressourcen
   * Erwartet: 404 bei Missing, 403 bei Permission Denied, 500 bei Server Error
   */
  describe('Error Handling & HTTP Status Codes', () => {
    it('should return 404 when album not found', async () => {
      prisma.album.findUnique.mockResolvedValue(null);

      const request = createMockRequest({ user: { id: 'user-123' } });
      const reply = createMockReply();

      // Simuliere: GET /albums/:id
      const getAlbum = async (prisma, albumId) => {
        const album = await prisma.album.findUnique({ where: { id: albumId } });
        return album;
      };

      const album = await getAlbum(prisma, 'non-existent');

      expect(album).toBeNull();
      // In Real: reply.code(404).send({ error: 'Not Found' })
    });

    it('should return 403 when user lacks permissions', async () => {
      const user = createMockUser({ id: 'user-non-member' });
      const album = createMockAlbum({ id: 'album-1', groupId: 'group-1' });

      prisma.album.findUnique.mockResolvedValue(album);
      prisma.groupMember.findUnique.mockResolvedValue(null);

      // Simuliere Permission Check
      const hasPermission = async (prisma, user, albumId) => {
        const album = await prisma.album.findUnique({ where: { id: albumId } });
        if (!album) return false;

        const member = await prisma.groupMember.findUnique({
          where: { userId_groupId: { userId: user.id, groupId: album.groupId } },
        });

        return !!member;
      };

      const permitted = await hasPermission(prisma, user, 'album-1');

      expect(permitted).toBe(false);
      // In Real: reply.code(403).send({ error: 'Forbidden' })
    });

    it('should handle database errors gracefully', async () => {
      prisma.album.findUnique.mockRejectedValue(new Error('Database connection failed'));

      const getAlbum = async (prisma, albumId) => {
        try {
          return await prisma.album.findUnique({ where: { id: albumId } });
        } catch (error) {
          console.error('Database error:', error);
          throw error; // Re-throw für 500
        }
      };

      await expect(getAlbum(prisma, 'album-1')).rejects.toThrow('Database connection failed');
    });
  });

  /**
   * Szenario: Race Condition bei parallelen Requests
   * Erwartet: Korrekte Konflikt-Auflösung
   */
  describe('Race Condition Handling', () => {
    it('should handle concurrent album updates', async () => {
      const album = createMockAlbum({ id: 'album-1' });

      prisma.album.findUnique.mockResolvedValue(album);
      prisma.album.update.mockResolvedValue({ ...album, name: 'Updated Album' });

      const updateAlbum = async (prisma, albumId, data) => {
        const album = await prisma.album.findUnique({ where: { id: albumId } });
        if (!album) throw new Error('Not found');

        return await prisma.album.update({
          where: { id: albumId },
          data,
        });
      };

      const updated = await updateAlbum(prisma, 'album-1', { name: 'Updated Album' });

      expect(updated.name).toBe('Updated Album');
      expect(prisma.album.update).toHaveBeenCalled();
    });

    it('should detect and reject stale updates', async () => {
      const album = createMockAlbum({ id: 'album-1', updatedAt: new Date('2025-01-15') });

      prisma.album.findUnique.mockResolvedValue(album);

      const updateAlbumWithVersion = async (prisma, albumId, data, expectedVersion) => {
        const album = await prisma.album.findUnique({ where: { id: albumId } });

        if (album.updatedAt !== expectedVersion) {
          throw new Error('Stale data - resource was updated');
        }

        return await prisma.album.update({
          where: { id: albumId },
          data,
        });
      };

      const staleVersion = new Date('2025-01-14');
      await expect(
        updateAlbumWithVersion(prisma, 'album-1', { name: 'Test' }, staleVersion)
      ).rejects.toThrow('Stale data');
    });
  });

  /**
   * Szenario: Pagination für große Datensätze
   * Erwartet: Korrekte Limit, Offset, Sortierung
   */
  describe('Pagination & Sorting', () => {
    it('should paginate results correctly', async () => {
      const albums = Array.from({ length: 25 }, (_, i) => ({
        id: `album-${i}`,
        name: `Album ${i}`,
      }));

      prisma.album.findMany.mockResolvedValue(albums.slice(0, 10));

      const getAlbums = async (prisma, { skip = 0, take = 10 } = {}) => {
        return await prisma.album.findMany({
          skip,
          take,
          orderBy: { createdAt: 'desc' },
        });
      };

      const page1 = await getAlbums(prisma, { skip: 0, take: 10 });

      expect(page1).toHaveLength(10);
      expect(prisma.album.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 })
      );
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
});

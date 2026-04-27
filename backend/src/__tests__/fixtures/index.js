/**
 * Test Fixtures — Wiederverwendbare Test-Daten
 */

export const createMockUser = (overrides = {}) => ({
  id: 'user-123',
  email: 'test@example.com',
  username: 'testuser',
  displayName: 'Test User',
  avatar: null,
  createdAt: new Date('2025-01-01'),
  ...overrides,
});

export const createMockGroup = (overrides = {}) => ({
  id: 'group-123',
  name: 'Test Group',
  description: 'Test Description',
  ownerId: 'user-123',
  createdAt: new Date('2025-01-01'),
  ...overrides,
});

export const createMockAlbum = (overrides = {}) => ({
  id: 'album-123',
  name: 'Test Album',
  description: 'Test Album Description',
  groupId: 'group-123',
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  ...overrides,
});

export const createMockPhoto = (overrides = {}) => ({
  id: 'photo-123',
  filename: 'test-photo.jpg',
  mimeType: 'image/jpeg',
  albumId: 'album-123',
  uploadedBy: 'user-123',
  uploadedAt: new Date('2025-01-01'),
  ...overrides,
});

export const createMockJwtPayload = (overrides = {}) => ({
  id: 'user-123',
  email: 'test@example.com',
  username: 'testuser',
  type: 'access',
  iat: Math.floor(Date.now() / 1000),
  ...overrides,
});

export const createMockNotificationPreference = (overrides = {}) => ({
  userId: 'user-123',
  inApp_photoCommented: true,
  email_photoCommented: false,
  inApp_albumShared: true,
  email_albumShared: false,
  inApp_groupInvite: true,
  email_groupInvite: false,
  inApp_system: true,
  email_system: false,
  ...overrides,
});

export const createMockNotification = (overrides = {}) => ({
  id: 'notif-123',
  userId: 'user-123',
  type: 'photoCommented',
  title: 'New Comment',
  body: 'Someone commented on your photo',
  entityId: 'photo-123',
  entityType: 'photo',
  entityUrl: 'https://example.com/photos/photo-123',
  imageUrl: null,
  read: false,
  createdAt: new Date('2025-01-01'),
  ...overrides,
});

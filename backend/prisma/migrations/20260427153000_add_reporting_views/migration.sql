CREATE OR REPLACE VIEW vw_user_groups AS
WITH member_counts AS (
  SELECT gm."groupId" AS group_id, COUNT(*)::integer AS member_count
  FROM "GroupMember" gm
  GROUP BY gm."groupId"
),
album_counts AS (
  SELECT a."groupId" AS group_id, COUNT(*)::integer AS album_count
  FROM "Album" a
  GROUP BY a."groupId"
),
photo_counts AS (
  SELECT p."groupId" AS group_id, COUNT(*)::integer AS photo_count
  FROM "Photo" p
  GROUP BY p."groupId"
)
SELECT
  u.id AS user_id,
  u.email,
  u.username,
  u.name,
  COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
  u.role,
  g.id AS group_id,
  g.name AS group_name,
  g."createdBy" AS owner_id,
  COALESCE(NULLIF(owner_user.name, ''), owner_user.username) AS owner_name,
  (g."createdBy" = u.id) AS is_owner,
  EXISTS (
    SELECT 1
    FROM "GroupDeputy" gd
    WHERE gd."groupId" = g.id AND gd."userId" = u.id
  ) AS is_deputy,
  COALESCE(mc.member_count, 0) AS member_count,
  COALESCE(ac.album_count, 0) AS album_count,
  COALESCE(pc.photo_count, 0) AS photo_count,
  g."createdAt" AS group_created_at
FROM "GroupMember" gm
JOIN "User" u ON u.id = gm."userId"
JOIN "Group" g ON g.id = gm."groupId"
LEFT JOIN "User" owner_user ON owner_user.id = g."createdBy"
LEFT JOIN member_counts mc ON mc.group_id = g.id
LEFT JOIN album_counts ac ON ac.group_id = g.id
LEFT JOIN photo_counts pc ON pc.group_id = g.id;

CREATE OR REPLACE VIEW vw_user_overview AS
WITH group_counts AS (
  SELECT gm."userId" AS user_id, COUNT(*)::integer AS group_count
  FROM "GroupMember" gm
  GROUP BY gm."userId"
),
owned_group_counts AS (
  SELECT g."createdBy" AS user_id, COUNT(*)::integer AS owned_group_count
  FROM "Group" g
  WHERE g."createdBy" IS NOT NULL
  GROUP BY g."createdBy"
),
deputy_group_counts AS (
  SELECT gd."userId" AS user_id, COUNT(*)::integer AS deputy_group_count
  FROM "GroupDeputy" gd
  GROUP BY gd."userId"
),
photo_counts AS (
  SELECT p."uploaderId" AS user_id, COUNT(*)::integer AS photo_count
  FROM "Photo" p
  GROUP BY p."uploaderId"
),
comment_counts AS (
  SELECT c."userId" AS user_id, COUNT(*)::integer AS comment_count
  FROM "Comment" c
  GROUP BY c."userId"
),
like_counts AS (
  SELECT l."userId" AS user_id, COUNT(*)::integer AS like_count
  FROM "Like" l
  GROUP BY l."userId"
),
album_contribution_counts AS (
  SELECT ac."userId" AS user_id, COUNT(*)::integer AS album_contribution_count
  FROM "AlbumContributor" ac
  GROUP BY ac."userId"
),
notification_counts AS (
  SELECT n."userId" AS user_id,
         COUNT(*)::integer AS notification_count,
         COUNT(*) FILTER (WHERE NOT n.read)::integer AS unread_notification_count
  FROM "Notification" n
  GROUP BY n."userId"
)
SELECT
  u.id AS user_id,
  u.email,
  u.username,
  u.name,
  COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
  u.role,
  u.color,
  u.avatar,
  u."displayNameField" AS display_name_field,
  u."migratedFrom" AS migrated_from,
  u."migratedAt" AS migrated_at,
  u."lastLoginAt" AS last_login_at,
  u."createdAt" AS user_created_at,
  COALESCE(gc.group_count, 0) AS group_count,
  COALESCE(ogc.owned_group_count, 0) AS owned_group_count,
  COALESCE(dgc.deputy_group_count, 0) AS deputy_group_count,
  COALESCE(pc.photo_count, 0) AS photo_count,
  COALESCE(cc.comment_count, 0) AS comment_count,
  COALESCE(lc.like_count, 0) AS like_count,
  COALESCE(acc.album_contribution_count, 0) AS album_contribution_count,
  COALESCE(nc.notification_count, 0) AS notification_count,
  COALESCE(nc.unread_notification_count, 0) AS unread_notification_count
FROM "User" u
LEFT JOIN group_counts gc ON gc.user_id = u.id
LEFT JOIN owned_group_counts ogc ON ogc.user_id = u.id
LEFT JOIN deputy_group_counts dgc ON dgc.user_id = u.id
LEFT JOIN photo_counts pc ON pc.user_id = u.id
LEFT JOIN comment_counts cc ON cc.user_id = u.id
LEFT JOIN like_counts lc ON lc.user_id = u.id
LEFT JOIN album_contribution_counts acc ON acc.user_id = u.id
LEFT JOIN notification_counts nc ON nc.user_id = u.id;

CREATE OR REPLACE VIEW vw_user_notifications_stats AS
SELECT
  u.id AS user_id,
  u.email,
  u.username,
  COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
  COUNT(n.id)::integer AS total_notifications,
  COUNT(n.id) FILTER (WHERE NOT n.read)::integer AS unread_notifications,
  COUNT(n.id) FILTER (WHERE n.type = 'groupDeleted')::integer AS group_deleted_count,
  COUNT(n.id) FILTER (WHERE n.type = 'photoLiked')::integer AS photo_liked_count,
  COUNT(n.id) FILTER (WHERE n.type = 'photoCommented')::integer AS photo_commented_count,
  COUNT(n.id) FILTER (WHERE n.type = 'newPhoto')::integer AS new_photo_count,
  COUNT(n.id) FILTER (WHERE n.type = 'newAlbum')::integer AS new_album_count,
  COUNT(n.id) FILTER (WHERE n.type = 'system')::integer AS system_count,
  MAX(n."createdAt") AS latest_notification_at
FROM "User" u
LEFT JOIN "Notification" n ON n."userId" = u.id
GROUP BY u.id, u.email, u.username, u.name;

DROP MATERIALIZED VIEW IF EXISTS mv_user_activity_stats;

CREATE MATERIALIZED VIEW mv_user_activity_stats AS
WITH uploaded AS (
  SELECT p."uploaderId" AS user_id,
         COUNT(*)::integer AS uploaded_photos,
         MAX(p."createdAt") AS last_photo_at
  FROM "Photo" p
  GROUP BY p."uploaderId"
),
comments_written AS (
  SELECT c."userId" AS user_id,
         COUNT(*)::integer AS written_comments,
         MAX(c."createdAt") AS last_comment_at
  FROM "Comment" c
  GROUP BY c."userId"
),
likes_given AS (
  SELECT l."userId" AS user_id,
         COUNT(*)::integer AS given_likes,
         MAX(l."createdAt") AS last_like_at
  FROM "Like" l
  GROUP BY l."userId"
),
likes_received AS (
  SELECT p."uploaderId" AS user_id,
         COUNT(l.id)::integer AS received_likes_on_own_photos,
         MAX(l."createdAt") AS last_received_like_at
  FROM "Photo" p
  JOIN "Like" l ON l."photoId" = p.id
  GROUP BY p."uploaderId"
),
comments_received AS (
  SELECT p."uploaderId" AS user_id,
         COUNT(c.id)::integer AS received_comments_on_own_photos,
         MAX(c."createdAt") AS last_received_comment_at
  FROM "Photo" p
  JOIN "Comment" c ON c."photoId" = p.id
  GROUP BY p."uploaderId"
)
SELECT
  u.id AS user_id,
  u.email,
  u.username,
  COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
  COALESCE(up.uploaded_photos, 0) AS uploaded_photos,
  COALESCE(cw.written_comments, 0) AS written_comments,
  COALESCE(lg.given_likes, 0) AS given_likes,
  COALESCE(lr.received_likes_on_own_photos, 0) AS received_likes_on_own_photos,
  COALESCE(cr.received_comments_on_own_photos, 0) AS received_comments_on_own_photos,
  up.last_photo_at,
  cw.last_comment_at,
  lg.last_like_at,
  lr.last_received_like_at,
  cr.last_received_comment_at,
  NULLIF(
    GREATEST(
      COALESCE(up.last_photo_at, TIMESTAMP 'epoch'),
      COALESCE(cw.last_comment_at, TIMESTAMP 'epoch'),
      COALESCE(lg.last_like_at, TIMESTAMP 'epoch'),
      COALESCE(lr.last_received_like_at, TIMESTAMP 'epoch'),
      COALESCE(cr.last_received_comment_at, TIMESTAMP 'epoch'),
      COALESCE(u."lastLoginAt", TIMESTAMP 'epoch')
    ),
    TIMESTAMP 'epoch'
  ) AS last_activity_at
FROM "User" u
LEFT JOIN uploaded up ON up.user_id = u.id
LEFT JOIN comments_written cw ON cw.user_id = u.id
LEFT JOIN likes_given lg ON lg.user_id = u.id
LEFT JOIN likes_received lr ON lr.user_id = u.id
LEFT JOIN comments_received cr ON cr.user_id = u.id;

CREATE UNIQUE INDEX mv_user_activity_stats_user_id_idx ON mv_user_activity_stats (user_id);

DROP MATERIALIZED VIEW IF EXISTS mv_group_overview;

CREATE MATERIALIZED VIEW mv_group_overview AS
WITH member_counts AS (
  SELECT gm."groupId" AS group_id, COUNT(*)::integer AS member_count
  FROM "GroupMember" gm
  GROUP BY gm."groupId"
),
deputy_counts AS (
  SELECT gd."groupId" AS group_id, COUNT(*)::integer AS deputy_count
  FROM "GroupDeputy" gd
  GROUP BY gd."groupId"
),
album_counts AS (
  SELECT a."groupId" AS group_id, COUNT(*)::integer AS album_count
  FROM "Album" a
  GROUP BY a."groupId"
),
photo_counts AS (
  SELECT p."groupId" AS group_id,
         COUNT(*)::integer AS photo_count,
         MAX(p."createdAt") AS latest_photo_at
  FROM "Photo" p
  GROUP BY p."groupId"
),
comment_counts AS (
  SELECT p."groupId" AS group_id, COUNT(c.id)::integer AS comment_count
  FROM "Photo" p
  JOIN "Comment" c ON c."photoId" = p.id
  GROUP BY p."groupId"
),
like_counts AS (
  SELECT p."groupId" AS group_id, COUNT(l.id)::integer AS like_count
  FROM "Photo" p
  JOIN "Like" l ON l."photoId" = p.id
  GROUP BY p."groupId"
),
backup_stats AS (
  SELECT gb."groupId" AS group_id,
         COUNT(*)::integer AS backup_count,
         COALESCE(SUM(gb."photoCount"), 0)::integer AS backed_up_photo_count,
         MAX(gb."createdAt") AS latest_backup_at
  FROM group_backups gb
  WHERE gb."groupId" IS NOT NULL
  GROUP BY gb."groupId"
)
SELECT
  g.id AS group_id,
  g.name AS group_name,
  g."createdBy" AS owner_id,
  COALESCE(NULLIF(owner_user.name, ''), owner_user.username) AS owner_name,
  g."createdAt" AS group_created_at,
  COALESCE(mc.member_count, 0) AS member_count,
  COALESCE(dc.deputy_count, 0) AS deputy_count,
  COALESCE(ac.album_count, 0) AS album_count,
  COALESCE(pc.photo_count, 0) AS photo_count,
  COALESCE(cc.comment_count, 0) AS comment_count,
  COALESCE(lc.like_count, 0) AS like_count,
  COALESCE(bs.backup_count, 0) AS backup_count,
  COALESCE(bs.backed_up_photo_count, 0) AS backed_up_photo_count,
  bs.latest_backup_at,
  pc.latest_photo_at
FROM "Group" g
LEFT JOIN "User" owner_user ON owner_user.id = g."createdBy"
LEFT JOIN member_counts mc ON mc.group_id = g.id
LEFT JOIN deputy_counts dc ON dc.group_id = g.id
LEFT JOIN album_counts ac ON ac.group_id = g.id
LEFT JOIN photo_counts pc ON pc.group_id = g.id
LEFT JOIN comment_counts cc ON cc.group_id = g.id
LEFT JOIN like_counts lc ON lc.group_id = g.id
LEFT JOIN backup_stats bs ON bs.group_id = g.id;

CREATE UNIQUE INDEX mv_group_overview_group_id_idx ON mv_group_overview (group_id);

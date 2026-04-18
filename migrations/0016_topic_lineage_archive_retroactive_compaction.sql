WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY slug, archive_reason, merge_stage, merged_to_topic_id
      ORDER BY COALESCE(last_archived_at, archived_at) DESC, id DESC
    ) AS rn
  FROM topic_lineage_archive
)
UPDATE topic_lineage_archive AS keeper
SET archive_count = (
      SELECT SUM(other.archive_count)
      FROM topic_lineage_archive AS other
      WHERE other.slug = keeper.slug
        AND other.archive_reason = keeper.archive_reason
        AND other.merge_stage IS keeper.merge_stage
        AND other.merged_to_topic_id IS keeper.merged_to_topic_id
    ),
    archived_at = (
      SELECT MIN(other.archived_at)
      FROM topic_lineage_archive AS other
      WHERE other.slug = keeper.slug
        AND other.archive_reason = keeper.archive_reason
        AND other.merge_stage IS keeper.merge_stage
        AND other.merged_to_topic_id IS keeper.merged_to_topic_id
    ),
    last_archived_at = (
      SELECT MAX(COALESCE(other.last_archived_at, other.archived_at))
      FROM topic_lineage_archive AS other
      WHERE other.slug = keeper.slug
        AND other.archive_reason = keeper.archive_reason
        AND other.merge_stage IS keeper.merge_stage
        AND other.merged_to_topic_id IS keeper.merged_to_topic_id
    ),
    last_original_topic_id = (
      SELECT COALESCE(other.last_original_topic_id, other.original_topic_id)
      FROM topic_lineage_archive AS other
      WHERE other.slug = keeper.slug
        AND other.archive_reason = keeper.archive_reason
        AND other.merge_stage IS keeper.merge_stage
        AND other.merged_to_topic_id IS keeper.merged_to_topic_id
      ORDER BY COALESCE(other.last_archived_at, other.archived_at) DESC, other.id DESC
      LIMIT 1
    )
WHERE id IN (SELECT id FROM ranked WHERE rn = 1);

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY slug, archive_reason, merge_stage, merged_to_topic_id
      ORDER BY COALESCE(last_archived_at, archived_at) DESC, id DESC
    ) AS rn
  FROM topic_lineage_archive
)
DELETE FROM topic_lineage_archive
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

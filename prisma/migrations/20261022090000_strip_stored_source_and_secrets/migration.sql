-- Stop keeping customers' source: remove function bodies from stored Stage 1
-- results (reports and the review cache keep names, lines and findings only),
-- and the raw lines of detected secrets (new scans store a masked preview).

CREATE FUNCTION pg_temp.ab_strip_stage1(s jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN s IS NULL OR jsonb_typeof(s) <> 'object' THEN s ELSE
    s || jsonb_build_object(
      'functions', COALESCE((
        SELECT jsonb_agg(f || '{"code": ""}'::jsonb)
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s->'functions') = 'array' THEN s->'functions' ELSE '[]'::jsonb END) f
      ), '[]'::jsonb),
      'riskyFunctions', COALESCE((
        SELECT jsonb_agg(CASE WHEN jsonb_typeof(r->'fn') = 'object' THEN jsonb_set(r, '{fn,code}', '""') ELSE r END)
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s->'riskyFunctions') = 'array' THEN s->'riskyFunctions' ELSE '[]'::jsonb END) r
      ), '[]'::jsonb)
    )
  END
$$;

UPDATE "ScanFile" SET "stage1" = pg_temp.ab_strip_stage1("stage1") WHERE "stage1" IS NOT NULL;
UPDATE "Audit" SET "stage1" = pg_temp.ab_strip_stage1("stage1") WHERE "stage1" IS NOT NULL;
UPDATE "AuditCache" SET "stage1" = pg_temp.ab_strip_stage1("stage1") WHERE "stage1" IS NOT NULL;

UPDATE "ScanJob"
SET "secrets" = (
  SELECT jsonb_agg(e || '{"snippet": "(hidden: re-scan to see a masked preview)"}'::jsonb)
  FROM jsonb_array_elements("secrets") e
)
WHERE jsonb_typeof("secrets") = 'array' AND jsonb_array_length("secrets") > 0;

ALTER TABLE ingestion_log ADD COLUMN run_type TEXT NOT NULL DEFAULT 'refresh';
ALTER TABLE ingestion_log ADD COLUMN pipeline_report TEXT;

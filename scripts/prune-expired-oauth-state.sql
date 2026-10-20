-- Run with psql and autocommit enabled; do not wrap in a transaction.
-- Only expired temporary login state is removed. OAuth sessions are untouched.
\set ON_ERROR_STOP on
SET lock_timeout = '1s';
SET statement_timeout = '60s';

DO $cleanup$
DECLARE
  cutoff bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  removed integer;
  total_removed integer := 0;
BEGIN
  FOR batch IN 1..250 LOOP
    DELETE FROM oauth_state
    WHERE expires_at < cutoff AND key IN (
      SELECT key FROM oauth_state
      WHERE expires_at < cutoff ORDER BY expires_at LIMIT 1000
    );
    GET DIAGNOSTICS removed = ROW_COUNT;
    total_removed := total_removed + removed;
    COMMIT;
    EXIT WHEN removed < 1000;
    PERFORM pg_sleep(0.025);
  END LOOP;
  RAISE NOTICE 'Removed % expired OAuth flow-state rows', total_removed;
END
$cleanup$;

VACUUM (ANALYZE) oauth_state;

SELECT count(*) AS total,
  count(*) FILTER (
    WHERE expires_at < floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
  ) AS expired
FROM oauth_state;

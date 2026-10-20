const CLEANUP_INTERVAL_MS = 60_000;
const CLEANUP_BATCH_SIZE = 1_000;

interface OAuthStateCleanupClient {
  execute(query: { sql: string; args: number[] }): Promise<unknown>;
}

/**
 * Abandoned login attempts are never read again, so expiry checks on reads
 * cannot reclaim them. Prune one indexed batch per minute of login activity.
 * Keep each delete small so an existing backlog cannot stall new sign-ins.
 */
export class OAuthStateCleanup {
  private nextCleanupAt = 0;

  async run(
    client: OAuthStateCleanupClient,
    now = Date.now(),
  ): Promise<void> {
    if (now < this.nextCleanupAt) return;
    // Reserve the interval before awaiting so concurrent sign-ins cannot all
    // start cleanup. A failed attempt also backs off for the full interval.
    this.nextCleanupAt = now + CLEANUP_INTERVAL_MS;
    try {
      await client.execute({
        sql: `DELETE FROM oauth_state
          WHERE expires_at < ? AND key IN (
            SELECT key FROM oauth_state
            WHERE expires_at < ? ORDER BY expires_at LIMIT ?
          )`,
        args: [now, now, CLEANUP_BATCH_SIZE],
      });
    } catch (error) {
      // Maintenance must not turn a successfully stored login into a failure.
      // Database errors may contain query parameters; log only the category.
      console.warn(
        `[oauth-state] cleanup failed error=${
          error instanceof Error ? error.name : typeof error
        }`,
      );
    }
  }
}

import {
  type AppListing,
  listManagedAppListingsByAccountDid,
} from "./app-directory.ts";
import {
  findExistingAtstoreListingsForProfile,
  indexAtstoreListingMigrationRecord,
} from "./atstore-migration.ts";

export interface ManagedAppPortfolio {
  apps: AppListing[];
  discoveredAtstoreCount: number;
  syncUnavailable: boolean;
}

/**
 * Build the owner-facing app portfolio. Signed ATStore records in the user's
 * repository are indexed before the directory query so an existing app can be
 * connected to a host without first recreating its profile in Atmosphere.
 */
export async function loadManagedAppPortfolio(input: {
  did: string;
  pdsUrl?: string | null;
}): Promise<ManagedAppPortfolio> {
  let discoveredAtstoreCount = 0;
  let syncUnavailable = false;

  if (input.pdsUrl) {
    try {
      const records = await findExistingAtstoreListingsForProfile(
        input.did,
        input.pdsUrl,
      );
      discoveredAtstoreCount = records.length;
      for (const record of records) {
        await indexAtstoreListingMigrationRecord(record, input.did);
      }
    } catch (error) {
      syncUnavailable = true;
      console.warn("[managed-products] ATStore discovery unavailable:", error);
    }
  }

  const apps = await listManagedAppListingsByAccountDid(input.did, {
    syncLegacy: true,
  });
  return { apps, discoveredAtstoreCount, syncUnavailable };
}

export function selectManagedApp(
  apps: AppListing[],
  identifier: string | null | undefined,
): AppListing | null {
  if (apps.length === 0) return null;
  const key = identifier?.trim();
  if (!key) return apps[0];
  return apps.find((app) =>
    app.id === key || app.slug === key || app.canonicalUri === key ||
    app.atstoreListingUri === key
  ) ?? null;
}

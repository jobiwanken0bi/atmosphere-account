import type { RememberedAccount } from "./remembered-accounts.ts";

export interface DevPickerAccount extends RememberedAccount {
  avatarUrl: string;
}

/** Local-only accounts used to demonstrate the reusable Atmosphere picker. */
export const DEV_PICKER_ACCOUNTS: DevPickerAccount[] = [
  {
    did: "did:plc:aalocalpicker",
    handle: "local-picker.test",
    pdsUrl: "https://local-picker.test",
    avatarUrl: "/dev-picker-avatars/local-picker.png",
  },
  {
    did: "did:plc:aaaccountdemoone",
    handle: "alice.bsky.social",
    pdsUrl: "https://bsky.social",
    avatarUrl: "/dev-picker-avatars/alice.png",
  },
  {
    did: "did:plc:aaaccountdemotwo",
    handle: "you.com",
    pdsUrl: "https://pds.you.com",
    avatarUrl: "/dev-picker-avatars/you.png",
  },
  {
    did: "did:plc:aaaccountdemothree",
    handle: "you.eurosky.social",
    pdsUrl: "https://eurosky.social",
    avatarUrl: "/dev-picker-avatars/eurosky.png",
  },
];

export function devPickerAvatarUrl(did: string): string | null {
  return DEV_PICKER_ACCOUNTS.find((account) => account.did === did)
    ?.avatarUrl ?? null;
}

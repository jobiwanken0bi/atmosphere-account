import { rescoreAppDirectoryTrending } from "../lib/app-directory.ts";

const count = await rescoreAppDirectoryTrending();
console.log(`[rescore-app-trending] rescored ${count} app listing(s)`);

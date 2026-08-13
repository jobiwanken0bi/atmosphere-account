import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import HostManageSavedStatus from "./HostManageSavedStatus.tsx";

Deno.test("host management saved status is local and accessible", () => {
  const saved = renderToString(<HostManageSavedStatus saved />);
  const idle = renderToString(<HostManageSavedStatus saved={false} />);

  assertStringIncludes(saved, 'class="host-manage-saved"');
  assertStringIncludes(saved, 'role="status"');
  assertStringIncludes(saved, "Saved");
  assertEquals(idle, "");
});

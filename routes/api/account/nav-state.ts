import { define } from "../../../utils.ts";
import { accountNavStateResponse } from "../../../lib/account-nav-state.ts";

export const handler = define.handlers({
  GET(ctx): Response {
    return accountNavStateResponse(ctx.req, ctx.state);
  },
});

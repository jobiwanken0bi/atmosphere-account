import { define } from "../utils.ts";

export const handler = define.handlers({
  GET() {
    return new Response(null, {
      status: 308,
      headers: { location: "/docs" },
    });
  },
});

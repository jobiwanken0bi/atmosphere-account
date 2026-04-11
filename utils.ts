import { createDefine } from "fresh";

export interface State {
  // deno-lint-ignore no-explicit-any
  [key: string]: any;
}

export const define = createDefine<State>();

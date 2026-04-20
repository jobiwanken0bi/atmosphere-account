/**
 * Custom elements used in JSX (e.g. @lottiefiles/lottie-player).
 */
import type { JSX } from "preact";

declare module "preact" {
  namespace JSX {
    interface IntrinsicElements {
      "lottie-player": JSX.HTMLAttributes<HTMLElement> & {
        src?: string;
        background?: string;
        loop?: boolean;
        autoplay?: boolean;
      };
    }
  }
}

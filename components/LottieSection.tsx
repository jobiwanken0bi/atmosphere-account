import { useT } from "../i18n/mod.ts";

export default function LottieSection() {
  const t = useT();
  return (
    <div class="lottie-section">
      <div class="lottie-wrapper">
        <lottie-player
          src="/atmosphere.json"
          background="transparent"
          loop
          autoplay
          style="width:100%;height:100%;"
        />
        <img
          src="/union.svg"
          alt={t.lottie.logoAlt}
          class="lottie-logo-overlay"
          width="72"
          height="72"
        />
      </div>
    </div>
  );
}

export default function LottieSection() {
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
          alt="Atmosphere logo"
          class="lottie-logo-overlay"
          width="72"
          height="72"
        />
      </div>
    </div>
  );
}

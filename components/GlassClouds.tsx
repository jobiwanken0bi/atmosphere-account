interface CloudProps {
  id: string;
  /** Display size (SVG width/height attributes) */
  width: number;
  height: number;
  /** If set, viewBox uses this so path coordinates match the source asset while scaling down */
  viewBoxWidth?: number;
  viewBoxHeight?: number;
  style: Record<string, string | number>;
  path: string;
  fillOpacity?: number;
  blurRadius?: number;
  flipX?: boolean;
  parallaxSpeed?: number;
  /** Hide on narrow viewports — fewer clouds so the layer doesn’t feel crowded */
  hideOnMobile?: boolean;
}

function GlassCloud({
  id,
  width,
  height,
  viewBoxWidth,
  viewBoxHeight,
  style,
  path,
  fillOpacity = 0.2,
  blurRadius = 25,
  flipX = false,
  parallaxSpeed = -0.05,
  hideOnMobile = false,
}: CloudProps) {
  const vbW = viewBoxWidth ?? width;
  const vbH = viewBoxHeight ?? height;
  /* Padding: feGaussianBlur (stdDev 20) + stroke 4 need room past viewBox.
     (No foreignObject/backdrop-filter here — that combo with parallax transform caused GPU line artifacts.) */
  const pad = Math.max(Math.ceil(blurRadius * 3), 72);
  return (
    <svg
      class={`cloud-svg${hideOnMobile ? " cloud-svg--hide-sm" : ""}`}
      data-speed={parallaxSpeed}
      data-flip={flipX ? "1" : "0"}
      width={width}
      height={height}
      viewBox={`0 0 ${vbW} ${vbH}`}
      overflow="visible"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
    >
      <g filter={`url(#filter_${id})`}>
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d={path}
          fill="var(--cloud-fill, #79CFFF)"
          fill-opacity={fillOpacity}
          shape-rendering="geometricPrecision"
        />
        <path
          d={path}
          stroke={`url(#grad_${id})`}
          stroke-width="4"
          stroke-linejoin="round"
          stroke-linecap="round"
          fill="none"
          shape-rendering="geometricPrecision"
        />
      </g>
      <defs>
        <filter
          id={`filter_${id}`}
          x={-pad}
          y={-pad}
          width={vbW + pad * 2}
          height={vbH + pad * 2}
          filterUnits="userSpaceOnUse"
          color-interpolation-filters="sRGB"
        >
          <feFlood flood-opacity="0" result="BackgroundImageFix" />
          <feBlend
            mode="normal"
            in="SourceGraphic"
            in2="BackgroundImageFix"
            result="shape"
          />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dy="4" />
          <feGaussianBlur stdDeviation="20" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.8 0"
          />
          <feBlend mode="normal" in2="shape" result="innerShadow" />
        </filter>
        {/* Rim gradient: bottom stop must not hit opacity 0 or flat edges at max-Y lose stroke. */}
        <linearGradient
          id={`grad_${id}`}
          x1={vbW / 2}
          y1="0"
          x2={vbW / 2}
          y2={vbH}
          gradientUnits="userSpaceOnUse"
        >
          <stop stop-color="var(--cloud-stroke-top, #D0FCFF)" />
          <stop
            offset="0.78"
            stop-color="var(--cloud-stroke-bot, #E9FEFF)"
            stop-opacity="0.55"
          />
          <stop
            offset="1"
            stop-color="var(--cloud-stroke-bot, #E9FEFF)"
            stop-opacity="0.42"
          />
        </linearGradient>
      </defs>
    </svg>
  );
}

const clouds: CloudProps[] = [
  {
    id: "c1",
    width: 545,
    height: 324,
    path:
      "M430.377 323.959C431.455 323.986 432.536 324 433.621 324C495.134 324 545 279.795 545 225.266C545 172.442 498.203 129.307 439.355 126.661C424.209 88.0793 382.821 60.3905 334.137 60.3905C326.999 60.3905 320.017 60.9858 313.253 62.1233C296.847 25.72 256.703 0 209.782 0C148.269 0 98.4028 44.2046 98.4028 98.7337C98.4028 108.487 99.9982 117.911 102.97 126.81C45.3852 130.62 0 173.245 0 225.266C0 279.795 49.8661 324 111.379 324C113.192 324 114.994 323.962 116.786 323.886V324H430.377V323.959Z",
    fillOpacity: 0.18,
    blurRadius: 25,
    flipX: false,
    parallaxSpeed: -0.04,
    style: { position: "absolute", top: "3%", left: "-4%" },
  },
  {
    id: "c2",
    width: 420,
    height: 260,
    path:
      "M332 259.96C332.83 259.98 333.67 260 334.51 260C381.94 260 420 225.02 420 182.81C420 141.85 384.81 107.68 339.37 105.56C327.68 74.84 295.58 53 257.93 53C252.42 53 247.03 53.48 241.81 54.39C229.15 25.49 198.16 5 161.92 5C114.42 5 75.94 39.98 75.94 82.19C75.94 89.92 77.17 97.37 79.47 104.43C35.01 107.48 0 141.25 0 182.81C0 225.02 38.47 260 85.93 260C87.33 260 88.72 259.97 90.1 259.91V260H332V259.96Z",
    fillOpacity: 0.15,
    blurRadius: 22,
    flipX: true,
    parallaxSpeed: -0.07,
    hideOnMobile: true,
    style: { position: "absolute", top: "12%", right: "-6%" },
  },
  {
    id: "c3",
    width: 620,
    height: 370,
    path:
      "M490 369.95C491.23 369.98 492.47 370 493.71 370C563.73 370 620 319.6 620 257.3C620 197 564.63 147.7 500.67 144.68C483.44 100.58 436.3 68.93 380.85 68.93C372.72 68.93 364.78 69.61 357.08 70.9C338.4 29.33 292.67 0 238.87 0C168.85 0 112 50.41 112 112.71C112 123.83 113.82 134.58 117.2 144.73C51.65 149.08 0 197.73 0 257.3C0 319.6 56.78 370 126.79 370C128.85 370 130.9 369.96 132.94 369.87V370H490V369.95Z",
    fillOpacity: 0.14,
    blurRadius: 28,
    flipX: false,
    parallaxSpeed: -0.02,
    style: { position: "absolute", top: "36%", left: "5%" },
  },
  {
    id: "c4",
    width: 380,
    height: 230,
    path:
      "M300 229.96C300.75 229.98 301.51 230 302.27 230C345.13 230 380 198.09 380 159.26C380 121.6 347.21 90.52 305.59 88.58C295.05 60.39 266.03 40 232.03 40C227.05 40 222.18 40.43 217.47 41.26C206.05 14.95 178.07 -3 145.37 -3C102.5 -3 67.63 28.91 67.63 68.75C67.63 75.84 68.74 82.68 70.81 89.15C30.65 91.95 0 122.89 0 160.26C0 198.89 34.73 230 77.59 230C78.85 230 80.11 229.97 81.36 229.92V230H300V229.96Z",
    fillOpacity: 0.2,
    blurRadius: 20,
    flipX: true,
    parallaxSpeed: -0.1,
    hideOnMobile: true,
    style: { position: "absolute", top: "58%", right: "2%" },
  },
  {
    id: "c5",
    width: 480,
    height: 290,
    path:
      "M379 289.96C380 289.98 381.01 290 382.03 290C436.23 290 480 250.57 480 201.63C480 154.21 438.75 115.62 387.85 113.26C374.43 79.32 338 55 295.08 55C288.78 55 282.63 55.53 276.66 56.53C262.19 23.02 225.83 0 183.72 0C129.52 0 85.75 39.43 85.75 88.37C85.75 96.99 87.15 105.31 89.77 113.19C40.04 116.48 0 153.75 0 199.63C0 250.57 43.92 290 98.12 290C99.71 290 101.3 289.97 102.88 289.9V290H379V289.96Z",
    fillOpacity: 0.16,
    blurRadius: 24,
    flipX: true,
    parallaxSpeed: -0.05,
    hideOnMobile: true,
    style: { position: "absolute", top: "76%", left: "-2%" },
  },
  {
    id: "c6",
    /* Same path as Glass cloud.svg / c1 — unedited Figma geometry; scaled via display size only */
    width: 356,
    height: 211,
    viewBoxWidth: 545,
    viewBoxHeight: 324,
    path:
      "M430.377 323.959C431.455 323.986 432.536 324 433.621 324C495.134 324 545 279.795 545 225.266C545 172.442 498.203 129.307 439.355 126.661C424.209 88.0793 382.821 60.3905 334.137 60.3905C326.999 60.3905 320.017 60.9858 313.253 62.1233C296.847 25.72 256.703 0 209.782 0C148.269 0 98.4028 44.2046 98.4028 98.7337C98.4028 108.487 99.9982 117.911 102.97 126.81C45.3852 130.62 0 173.245 0 225.266C0 279.795 49.8661 324 111.379 324C113.192 324 114.994 323.962 116.786 323.886V324H430.377V323.959Z",
    fillOpacity: 0.19,
    blurRadius: 25,
    flipX: false,
    parallaxSpeed: -0.13,
    style: { position: "absolute", top: "90%", right: "12%" },
  },
];

export default function GlassClouds() {
  return (
    <div class="cloud-layer" aria-hidden="true">
      {clouds.map((cloud) => <GlassCloud key={cloud.id} {...cloud} />)}
    </div>
  );
}

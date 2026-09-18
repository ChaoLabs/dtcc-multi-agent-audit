import type { CSSProperties } from "react";

const paths = {
  expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  restore: "M3 8h5V3m13 5h-5V3M8 21v-5H3m13 5v-5h5",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  up: "M7 17 17 7M7 7h10v10",
  code: "m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18",
  scan: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 12h10",
  layers: "m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5",
  upload: "M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6",
  download: "M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5",
  chevron: "m7 10 5 5 5-5",
  close: "m6 6 12 12M6 18 18 6",
  plus: "M12 5v14M5 12h14",
  check: "m5 12 4 4L19 6",
  settings: "M4 7h16M4 17h16M8 4v6m8 4v6",
  file: "M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8m-8 4h6",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  copy: "M8 8h13v13H8zM16 8V3H3v13h5",
  clock: "M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  globe:
    "M2 12h20M12 2c6 5 6 15 0 20-6-5-6-15 0-20Zm10 10a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  shield: "m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Zm-4 10 3 3 5-6",
  book: "M12 5c-3-3-7-3-10-2v16c3-1 7-1 10 2 3-3 7-3 10-2V3c-3-1-7-1-10 2Zm0 0v16",
} as const;
export function Icon({
  name,
  size = 18,
  style,
}: {
  name: keyof typeof paths;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}

// Generated from docs/design/assets (the Figma icon set). Colours become currentColor, so set them with text-*.
// Sun, Pause, Clock, Search, Question and X are not in the fetched frames; they are drawn in the same style.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

export const Info = ({ size = 20, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden {...p}>
    <circle cx="10" cy="10" r="6.6" stroke="currentColor" strokeWidth="1.8" />{" "}
    <path
      d="M10 9.16667V13.3333"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <circle cx="10" cy="6.66667" r="1" fill="currentColor" />
  </svg>
);

export const InfoSmall = ({ size = 16, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <circle cx="8" cy="8" r="5.1" stroke="currentColor" strokeWidth="1.8" />{" "}
    <path d="M8 7.33333V10.6667" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />{" "}
    <circle cx="8" cy="5.33333" r="0.8" fill="currentColor" />
  </svg>
);

export const ArrowLeft = ({ size = 24, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path
      d="M19 12H5M11 18L5 12L11 6"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ChevronSmall = ({ size = 11.6, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 11.6 6.6" fill="none" aria-hidden {...p}>
    <path
      d="M0.8 0.8L5.8 5.8L10.8 0.8"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ChevronDown = ({ size = 20, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden {...p}>
    <path
      d="M5 7.5L10 12.5L15 7.5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const Moon = ({ size = 30, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 30 30" fill="none" aria-hidden {...p}>
    <path
      d="M10.8262 3.07812C10.299 4.10425 10 5.26701 10 6.5C10 10.6421 13.3579 14 17.5 14C18.7328 14 19.8949 13.6999 20.9209 13.1729C20.3459 17.5891 16.5729 21 12 21C7.02944 21 3 16.9706 3 12C3 7.42737 6.41038 3.65344 10.8262 3.07812Z"
      fill="currentColor"
    />
  </svg>
);

export const MoonSmall = ({ size = 18, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden {...p}>
    <path
      d="M8.22949 1.03711C7.45418 2.16391 7 3.52884 7 5C7 8.86599 10.134 12 14 12C14.9189 12 15.7957 11.8209 16.5996 11.499C15.5499 14.6931 12.5453 17 9 17C4.58172 17 1 13.4183 1 9C1 4.84165 4.17273 1.42481 8.22949 1.03711Z"
      fill="currentColor"
    />
  </svg>
);

export const Shield = ({ size = 20, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden {...p}>
    <path
      d="M15.8333 5L10 2.5L4.16667 5V9.16667C4.16667 12.9167 6.66667 15.8333 10 17.5C13.3333 15.8333 15.8333 12.9167 15.8333 9.16667V5Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const Settings = ({ size = 20, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden {...p}>
    <path
      d="M11.7484 4.95247C11.9076 5.10134 12.1155 5.18745 12.3333 5.19466L14.7259 5.27279L14.805 7.66634C14.8122 7.88435 14.8991 8.09302 15.0482 8.25228L16.6829 9.99935L15.0482 11.7484C14.9364 11.8678 14.8598 12.0143 14.8255 12.1722L14.805 12.3333L14.7259 14.7259L12.3333 14.805C12.1698 14.8104 12.0122 14.8611 11.8763 14.9486L11.7484 15.0482L9.99935 16.6829L8.25228 15.0482C8.09302 14.8991 7.88435 14.8122 7.66634 14.805L5.27279 14.7259L5.19466 12.3333C5.18926 12.1699 5.13942 12.0121 5.05208 11.8763L4.95247 11.7484L3.31576 9.99935L4.95247 8.25228C5.10153 8.09302 5.18745 7.88435 5.19466 7.66634L5.27279 5.27279L7.66634 5.19466C7.88435 5.18745 8.09302 5.10153 8.25228 4.95247L9.99935 3.31576L11.7484 4.95247Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />{" "}
    <circle cx="10" cy="10" r="1.6" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

export const SwapVert = ({ size = 20, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden {...p}>
    <path
      d="M6.66667 16.6667V3.33333M10 6.66667L6.66667 3.33333L3.33333 6.66667M13.3333 3.33333V16.6667M16.6667 13.3333L13.3333 16.6667L10 13.3333"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const Plus = ({ size = 18, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden {...p}>
    <path
      d="M9 3.75V14.25M3.75 9H14.25"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const Refresh = ({ size = 20, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden {...p}>
    <path
      d="M16.6667 10C16.6667 13.6667 13.6667 16.6667 10 16.6667C6.33333 16.6667 3.33333 13.6667 3.33333 10C3.33333 6.33333 6.33333 3.33333 10 3.33333C12.1667 3.33333 14.0833 4.33333 15.3333 6M15.8333 2.5V6.25H12.0833"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const Bars = ({ size = 22, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden {...p}>
    <path
      d="M5.5 18.3333V12.8333M11 18.3333V8.25M16.5 18.3333V3.66667"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const Warning = ({ size = 24, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path
      d="M21.5 20L12 3.5L2.5 20H21.5Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path d="M12 10V14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />{" "}
    <circle cx="12" cy="17" r="1.1" fill="currentColor" />
  </svg>
);

export const CheckCircle = ({ size = 22, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden {...p}>
    <circle cx="11" cy="11" r="9.16667" fill="#10A37F" />{" "}
    <path
      d="M6.875 11.1833L9.71667 13.9333L15.125 8.25"
      stroke="white"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const Document = ({ size = 24, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path
      d="M19 8L14 3H6V21H19V8ZM14 3V8H19M9 13H16M9 17H16"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ArrowUpRight = ({ size = 20, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden {...p}>
    <path
      d="M5.83333 14.1667L14.1667 5.83333M14.1667 13.3333V5.83333H6.66667"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const Database = ({ size = 26, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden {...p}>
    <path
      d="M12.9997 4.15039C15.0017 4.15039 16.7718 4.49973 18.0075 5.0293C18.6268 5.29471 19.0705 5.58773 19.3464 5.86719C19.6184 6.14284 19.6833 6.35562 19.6833 6.5C19.6833 6.64438 19.6184 6.85716 19.3464 7.13281C19.0705 7.41227 18.6268 7.70529 18.0075 7.9707C16.7718 8.50027 15.0017 8.84961 12.9997 8.84961C10.9977 8.84957 9.22751 8.50027 7.99186 7.9707C7.37263 7.70527 6.92879 7.41227 6.65299 7.13281C6.38104 6.85721 6.31706 6.64436 6.31706 6.5C6.31706 6.35564 6.38104 6.14279 6.65299 5.86719C6.92879 5.58773 7.37263 5.29473 7.99186 5.0293C9.22751 4.49973 10.9977 4.15043 12.9997 4.15039Z"
      stroke="currentColor"
      strokeWidth="1.8"
    />{" "}
    <path
      d="M5.41667 6.5V19.5C5.41667 23.8333 20.5833 23.8333 20.5833 19.5V6.5M5.41667 13C5.41667 17.3333 20.5833 17.3333 20.5833 13"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const TrendUp = ({ size = 26, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden {...p}>
    <path
      d="M3.25 18.4167L9.75 11.9167L14.0833 16.25L22.75 7.58333M22.75 14.0833V7.58333H16.25"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const BandArrows = ({ size = 26, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden {...p}>
    <path
      d="M4.33333 7.58333V18.4167M21.6667 7.58333V18.4167M8.66667 13H17.3333M10.8333 15.1667L8.66667 13L10.8333 10.8333M15.1667 15.1667L17.3333 13L15.1667 10.8333"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const Percent = ({ size = 26, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden {...p}>
    <path
      d="M20.5833 5.41667L5.41667 20.5833"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <circle cx="7.58333" cy="7.58333" r="1.80833" stroke="currentColor" strokeWidth="1.8" />{" "}
    <circle cx="18.4167" cy="18.4167" r="1.80833" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

export const ShieldLarge = ({ size = 26, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden {...p}>
    <path
      d="M20.5833 6.5L13 3.25L5.41667 6.5V11.9167C5.41667 16.7917 8.66667 20.5833 13 22.75C17.3333 20.5833 20.5833 16.7917 20.5833 11.9167V6.5Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const BarsLarge = ({ size = 26, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden {...p}>
    <path
      d="M6.5 21.6667V15.1667M13 21.6667V9.75M19.5 21.6667V4.33333"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const Sun = ({ size = 20, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden {...p}>
    <circle cx="10" cy="10" r="3.3" stroke="currentColor" strokeWidth="1.8" />
    <path
      d="M10 1.7V3.3M10 16.7V18.3M1.7 10H3.3M16.7 10H18.3M4.1 4.1L5.3 5.3M14.7 14.7L15.9 15.9M4.1 15.9L5.3 14.7M14.7 5.3L15.9 4.1"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

export const Pause = ({ size = 20, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden {...p}>
    <path d="M7.5 5V15M12.5 5V15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

export const Clock = ({ size = 26, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden {...p}>
    <circle cx="13" cy="13" r="8.7" stroke="currentColor" strokeWidth="2.2" />
    <path d="M13 8.2V13L16.2 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Search = ({ size = 20, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden {...p}>
    <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M13.2 13.2L16.7 16.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const Question = ({ size = 24, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
    <path
      d="M9.6 9.4C9.9 8.3 10.9 7.6 12.1 7.6C13.5 7.6 14.5 8.5 14.5 9.7C14.5 11.4 12 11.6 12 13.4"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <circle cx="12" cy="16.6" r="1.1" fill="currentColor" />
  </svg>
);

export const X = ({ size = 20, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden {...p}>
    <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const MoonLarge = ({ size = 26, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden {...p}>
    <path
      d="M10.8262 3.07812C10.299 4.10425 10 5.26701 10 6.5C10 10.6421 13.3579 14 17.5 14C18.7328 14 19.8949 13.6999 20.9209 13.1729C20.3459 17.5891 16.5729 21 12 21C7.02944 21 3 16.9706 3 12C3 7.42737 6.41038 3.65344 10.8262 3.07812Z"
      fill="currentColor"
    />
  </svg>
);

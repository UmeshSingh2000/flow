import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function iconProps({ size = 14, ...props }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...props,
  };
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M6 3.5L10.5 8 6 12.5" />
    </svg>
  );
}

export function IconMore(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="3.5" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconX(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
    </svg>
  );
}

export function IconPencil(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M11.2 2.6l2.2 2.2L5.3 12.9 2.8 13.2l.3-2.5z" />
    </svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.6" />
      <path d="M10.5 5.5V3.6a1.1 1.1 0 0 0-1.1-1.1H3.6a1.1 1.1 0 0 0-1.1 1.1v5.8a1.1 1.1 0 0 0 1.1 1.1h1.9" />
    </svg>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M8 2.5v7.5M5 7l3 3 3-3M3.5 13h9" />
    </svg>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M8 10V2.5M5 5.5l3-3 3 3M3.5 13h9" />
    </svg>
  );
}

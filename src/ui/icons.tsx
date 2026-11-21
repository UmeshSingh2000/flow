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

export function IconHelp(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="8" cy="8" r="6" />
      <path d="M6.3 6.2a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.3" />
      <circle cx="8" cy="11.4" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconImage(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.6" />
      <circle cx="6" cy="6.6" r="1.1" />
      <path d="M3.2 11.2l3-3 2.3 2.3 1.9-1.9 2.4 2.4" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.9v1.5M8 12.6v1.5M1.9 8h1.5M12.6 8h1.5M3.7 3.7l1 1M11.3 11.3l1 1M12.3 3.7l-1 1M4.7 11.3l-1 1" />
    </svg>
  );
}

export function IconPanelLeft(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.6" />
      <path d="M6.5 3v10" />
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

import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export function OrbitIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <ellipse cx="12" cy="12" rx="8.5" ry="3.6" />
      <path d="M12 3.5c2.6 0 4.6 3.8 4.6 8.5S14.6 20.5 12 20.5 7.4 16.7 7.4 12 9.4 3.5 12 3.5Z" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function FlyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h18M14 5l7 7-7 7" />
      <path d="M6 8l-3 4 3 4" />
    </Icon>
  )
}

export function WalkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="13" cy="4.5" r="2" />
      <path d="M12 7l-2 5 3 2 1 6M10 12l-4 2M13 14l4 2M10 19l-2 3" />
    </Icon>
  )
}

export function ResetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 10a8 8 0 1 1 2.3 6.2" />
      <path d="M4 4v6h6" />
    </Icon>
  )
}

export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.5v6M12 7.2v.2" />
    </Icon>
  )
}

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
    </Icon>
  )
}

export function ZoomIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21M8 10.5h5M10.5 8v5" />
    </Icon>
  )
}

export function FullscreenIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </Icon>
  )
}

export function ExitFullscreenIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </Icon>
  )
}

export function ImageIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m4 17 5-4 4 3 3-2 4 3" />
    </Icon>
  )
}

export function RecordIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="7" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function StopIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Icon>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4 12 5 5L20 6" />
    </Icon>
  )
}

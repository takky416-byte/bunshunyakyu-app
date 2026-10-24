import { useId } from 'react'

export default function Diamond({ className = '' }: { className?: string }) {
  const prefix = useId()
  return (
    <svg
      className={className}
      viewBox="0 0 360 270"
      fill="none"
      role="img"
      aria-label="野球場のイラスト"
    >
      <defs>
        <linearGradient
          id={`${prefix}-field`}
          x1="180"
          y1="0"
          x2="180"
          y2="270"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#3e6e56" />
          <stop offset="1" stopColor="#254938" />
        </linearGradient>
        <pattern
          id={`${prefix}-stripes`}
          width="36"
          height="36"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <path d="M0 0h18v36H0z" fill="#fff" opacity=".028" />
        </pattern>
      </defs>
      <path
        d="M180 244 23 87Q180-49 337 87Z"
        fill={`url(#${prefix}-field)`}
        stroke="#72927a"
        strokeWidth="1"
      />
      <path
        d="M180 244 23 87Q180-49 337 87Z"
        fill={`url(#${prefix}-stripes)`}
      />
      <path
        d="M180 227 42 88Q180-24 318 88Z"
        stroke="#b6c7a3"
        strokeOpacity=".35"
        strokeDasharray="3 5"
      />
      <path d="m180 244-96-96 96-96 96 96Z" fill="#c3a16d" fillOpacity=".85" />
      <path d="m180 222-74-74 74-74 74 74Z" fill="#416b4e" />
      <path
        d="M180 244 23 87M180 244 337 87"
        stroke="#e9e5cd"
        strokeOpacity=".8"
      />
      <circle cx="180" cy="148" r="14" fill="#c3a16d" />
      <rect x="175" y="145" width="10" height="3" rx="1" fill="#f7f1df" />
      <path d="m180 238 5 5v6h-10v-6Z" fill="#f7f1df" />
      <path
        d="m87 148 5-5 5 5-5 5ZM175 56l5-5 5 5-5 5ZM263 148l5-5 5 5-5 5Z"
        fill="#f7f1df"
      />
      <circle cx="180" cy="244" r="19" stroke="#b6c7a3" strokeOpacity=".45" />
      <path d="M56 213h29M275 213h29" stroke="#d6bd78" strokeOpacity=".5" />
      <circle cx="104" cy="105" r="5" fill="#d6bd78" />
      <circle cx="253" cy="101" r="5" fill="#d6bd78" />
      <circle cx="180" cy="30" r="5" fill="#d6bd78" />
    </svg>
  )
}

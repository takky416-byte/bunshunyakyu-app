import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

/** Keep supporting information available without taking over a phone screen. */
export default function CompactDetails({
  compact,
  title,
  children,
  className = '',
}: {
  compact: boolean
  title: string
  children: ReactNode
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <details
      className={`compact-details ${className}`}
      open={!compact || expanded}
      onToggle={(event) => {
        if (compact) setExpanded(event.currentTarget.open)
      }}
    >
      <summary>
        <span>{title}</span>
        <ChevronRight size={16} />
      </summary>
      <div className="compact-details-body">{children}</div>
    </details>
  )
}

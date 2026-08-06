import type { LucideIcon } from 'lucide-react'

interface IconButtonProps {
  label: string
  icon: LucideIcon
  onClick: () => void
  active?: boolean
  disabled?: boolean
}

export function IconButton({
  label,
  icon: Icon,
  onClick,
  active,
  disabled,
}: IconButtonProps) {
  return (
    <button
      className="icon-button"
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon aria-hidden="true" size={19} strokeWidth={2.2} />
    </button>
  )
}

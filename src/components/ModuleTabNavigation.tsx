import type { ReactNode } from 'react'

export type ModuleTabOption<T extends string = string> = {
  value: T
  label: string
  content?: ReactNode
}

type ModuleTabNavigationProps<T extends string> = {
  value: T
  options: readonly ModuleTabOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}

export default function ModuleTabNavigation<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className = '',
}: ModuleTabNavigationProps<T>) {
  const selectValue = (nextValue: string) => {
    const option = options.find(({ value: optionValue }) => optionValue === nextValue)
    if (option) onChange(option.value)
  }

  return (
    <div className={`admin-tabs module-tabs module-navigation ${options.length > 5 ? 'module-navigation-many' : ''} ${className}`}>
      <div className="module-tab-buttons" role="tablist" aria-label={ariaLabel}>
        {options.map((option) => (
          <button
            className={`button ${value === option.value ? 'button-primary' : 'button-secondary'}`}
            key={option.value}
            type="button"
            role="tab"
            aria-selected={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.content ?? option.label}
          </button>
        ))}
      </div>
      <label className="module-tab-select">
        <select aria-label={ariaLabel} value={value} onChange={(event) => selectValue(event.currentTarget.value)}>
          {options.map(({ value: optionValue, label }) => (
            <option key={optionValue} value={optionValue}>{label}</option>
          ))}
        </select>
      </label>
    </div>
  )
}

import { Moon, Sun } from 'lucide-react'

export default function AppearanceModeButton({
  darkMode,
  onToggle,
}: {
  darkMode: boolean
  onToggle: () => void
}) {
  const label = darkMode ? 'Ativar tema claro' : 'Ativar tema escuro'
  return <button
    className="button button-secondary pwa-appearance-button"
    type="button"
    aria-label={label}
    aria-pressed={darkMode}
    title={label}
    onClick={onToggle}
  >
    {darkMode ? <Sun size={17} /> : <Moon size={17} />}
  </button>
}

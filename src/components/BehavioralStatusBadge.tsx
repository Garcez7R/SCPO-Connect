export type BehavioralStatus = 'green' | 'yellow' | 'red'

const behavioralStatusLabels: Record<BehavioralStatus, string> = {
  green: 'Verde · bom comportamento',
  yellow: 'Amarelo · requer atenção',
  red: 'Vermelho · supervisão constante',
}

export function BehavioralStatusBadge({ status }: { status: BehavioralStatus | null }) {
  if (!status) {
    return <span className="behavioral-status-badge behavioral-status-unset">Sem sinalização</span>
  }
  return <span className={`behavioral-status-badge behavioral-status-${status}`}>
    {behavioralStatusLabels[status]}
  </span>
}

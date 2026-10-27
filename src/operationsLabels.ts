export type HygieneRequestType = 'routine' | 'spot' | 'after_procedure' | 'restock' | 'other'
export type HygieneArea = 'room' | 'bathroom' | 'shared' | 'clinical' | 'circulation' | 'other'

export const hygieneRequestTypeLabels: Record<HygieneRequestType, string> = {
  routine: 'Higienização programada',
  spot: 'Limpeza pontual',
  after_procedure: 'Limpeza após procedimento',
  restock: 'Reposição de material',
  other: 'Outra solicitação',
}

export const hygieneAreaLabels: Record<HygieneArea, string> = {
  room: 'Quarto / leito',
  bathroom: 'Banheiro',
  shared: 'Área comum',
  clinical: 'Consultório / sala',
  circulation: 'Área de circulação',
  other: 'Outro local',
}

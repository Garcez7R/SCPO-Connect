import { LogOut, Stethoscope } from 'lucide-react'
import PhysicianPage from './PhysicianPage'

type PhysicianMobileUser = {
  id: string
  name: string
  display_name: string
  modules: string[]
  permissions: Record<string, string[]>
}

export default function PhysicianMobilePage({ user, onLogout }: {
  user: PhysicianMobileUser
  onLogout: () => void
}) {
  const canAccess = user.modules.includes('physician')

  if (!canAccess) {
    return <main className="physician-mobile-shell">
      <header className="physician-mobile-header">
        <img src="/scpo-connect-icon.png" alt="" />
        <div><p className="eyebrow">SCPO CONNECT</p><h1>Médico móvel</h1></div>
        <button className="button button-secondary" type="button" onClick={onLogout}><LogOut size={16} /> Sair</button>
      </header>
      <section className="patient-list-panel">
        <h2>Acesso não autorizado</h2>
        <p>Seu perfil não tem permissão para usar o módulo Médico. Solicite a liberação ao administrador.</p>
        <a className="button button-secondary" href="/">Abrir sistema completo</a>
      </section>
    </main>
  }

  return <main className="physician-mobile-shell">
    <header className="physician-mobile-header">
      <div className="physician-mobile-brand">
        <img src="/scpo-connect-icon.png" alt="" />
        <div><p className="eyebrow">SCPO CONNECT</p><h1><Stethoscope size={20} /> Médico</h1><span>{user.display_name || user.name}</span></div>
      </div>
      <button className="button button-secondary physician-mobile-logout" type="button" onClick={onLogout}><LogOut size={16} /> Sair</button>
    </header>
    <PhysicianPage userId={user.id} onOpenPatientHistory={() => undefined} mobileMode />
  </main>
}

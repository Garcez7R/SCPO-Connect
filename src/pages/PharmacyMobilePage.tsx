import { LogOut, Pill } from 'lucide-react'
import PharmacyPage from './PharmacyPage'

type PharmacyMobileUser = {
  id: string
  username: string
  name: string
  display_name?: string
  role: string
  modules: string[]
  permissions: Record<string, string[]>
}

export default function PharmacyMobilePage({ user, onLogout }: {
  user: PharmacyMobileUser
  onLogout: () => void
}) {
  const canAccess = user.modules.includes('pharmacy')

  if (!canAccess) {
    return <main className="pharmacy-mobile-shell">
      <header className="pharmacy-mobile-header">
        <img src="/scpo-connect-icon.png" alt="" />
        <div><p className="eyebrow">SCPO CONNECT</p><h1>Farmácia móvel</h1></div>
        <button className="button button-secondary" type="button" onClick={onLogout}><LogOut size={16} /> Sair</button>
      </header>
      <section className="patient-list-panel">
        <h2>Acesso não autorizado</h2>
        <p>Seu perfil não tem permissão para usar o módulo Farmácia. Solicite a liberação ao administrador.</p>
        <a className="button button-secondary" href="/">Abrir sistema completo</a>
      </section>
    </main>
  }

  return <main className="pharmacy-mobile-shell">
    <header className="pharmacy-mobile-header">
      <div className="pharmacy-mobile-brand">
        <img src="/scpo-connect-icon.png" alt="" />
        <div><p className="eyebrow">SCPO CONNECT</p><h1><Pill size={20} /> Farmácia</h1><span>{user.display_name || user.name}</span></div>
      </div>
      <button className="button button-secondary pharmacy-mobile-logout" type="button" onClick={onLogout}><LogOut size={16} /> Sair</button>
    </header>
    <PharmacyPage user={user} mobileMode />
  </main>
}

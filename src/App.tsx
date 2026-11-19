import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { RoofPage } from '@/pages/RoofPage';
import { LayoutPage } from '@/pages/LayoutPage';
import { SimulationPage } from '@/pages/SimulationPage';
import { SettingsPage } from '@/pages/SettingsPage';

const NAV = [
  { to: '/projects', label: '项目管理', icon: '▦' },
  { to: '/roof', label: '屋面建模', icon: '⛰' },
  { to: '/layout', label: '排布设计', icon: '▤' },
  { to: '/simulation', label: '仿真分析', icon: '∿' },
  { to: '/settings', label: '设置', icon: '⚙' },
];

export default function App() {
  const init = useStore(s => s.init);
  const ready = useStore(s => s.ready);
  useEffect(() => { init(); }, [init]);

  if (!ready) return <div style={{ padding: 40 }} className="muted">正在初始化本地工程数据库…</div>;

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="brand">光伏工程设计<br />与交付管理系统</div>
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span style={{ fontSize: 16 }}>{n.icon}</span>{n.label}
          </NavLink>
        ))}
        <div style={{ marginTop: 'auto', padding: '10px', fontSize: 11.5, color: '#5c6678' }}>
          全本地处理 · WebGL2<br />数据不出浏览器
        </div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/roof" element={<RoofPage />} />
          <Route path="/layout" element={<LayoutPage />} />
          <Route path="/simulation" element={<SimulationPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

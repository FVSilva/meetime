import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard   from './pages/Dashboard';
import Kanban      from './pages/Kanban';
import Leads       from './pages/Leads';
import Calls       from './pages/Calls';
import Activities  from './pages/Activities';
import Users       from './pages/Users';
import WebhookInfo from './pages/WebhookInfo';
import WhatsApp    from './pages/WhatsApp';

export default function App() {
  return (
    <div className="flex h-screen overflow-hidden bg-black">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/"           element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard"  element={<Dashboard />}   />
          <Route path="/kanban"     element={<Kanban />}      />
          <Route path="/leads"      element={<Leads />}       />
          <Route path="/calls"      element={<Calls />}       />
          <Route path="/activities" element={<Activities />}  />
          <Route path="/users"      element={<Users />}       />
          <Route path="/whatsapp"   element={<WhatsApp />}    />
          <Route path="/webhook"    element={<WebhookInfo />} />
        </Routes>
      </main>
    </div>
  );
}

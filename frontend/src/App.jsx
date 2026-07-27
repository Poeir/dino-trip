import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext.jsx'
import Header from './components/Header.jsx'
import MobileMenu from './components/MobileMenu.jsx'
import WelcomeModal from './components/WelcomeModal.jsx'
import Footer from './components/Footer.jsx'
import ChatWidget from './components/ChatWidget.jsx'

import HomePage from './pages/HomePage.jsx'
import PlacesListPage from './pages/PlacesListPage.jsx'
import PlaceDetailPage from './pages/PlaceDetailPage.jsx'
import EventsListPage from './pages/EventsListPage.jsx'
import EventDetailPage from './pages/EventDetailPage.jsx'
import TripFormPage from './pages/TripFormPage.jsx'
import TripResultPage from './pages/TripResultPage.jsx'
import PointsPage from './pages/PointsPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import SignupPage from './pages/SignupPage.jsx'
import AdminLoginPage from './pages/AdminLoginPage.jsx'
import AdminDashboardPage from './pages/AdminDashboardPage.jsx'

function PublicLayout() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header />
      <MobileMenu />
      <WelcomeModal />
      <main style={{ flex: 1 }}>
        <Outlet />
      </main>
      <Footer />
      <ChatWidget />
    </div>
  )
}

function RequireAdmin({ children }) {
  const { state } = useApp()
  return state.adminLoggedIn ? children : <Navigate to="/admin/login" replace />
}

function Shell() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#FFFDF6', backgroundImage: "url('./assets/background1.png')", backgroundSize: 'cover', backgroundPosition: 'top center', backgroundRepeat: 'no-repeat', backgroundAttachment: 'fixed' }}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/places" element={<PlacesListPage />} />
          <Route path="/places/:id" element={<PlaceDetailPage />} />
          <Route path="/events" element={<EventsListPage />} />
          <Route path="/events/:id" element={<EventDetailPage />} />
          <Route path="/trip" element={<TripFormPage />} />
          <Route path="/trip/result" element={<TripResultPage />} />
          <Route path="/points" element={<PointsPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
        </Route>
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin" element={<RequireAdmin><AdminDashboardPage /></RequireAdmin>} />
        <Route path="/admin/:tab" element={<RequireAdmin><AdminDashboardPage /></RequireAdmin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}

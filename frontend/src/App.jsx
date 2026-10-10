import { Suspense } from 'react'
import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext.jsx'
import ScrollToTop from './components/ScrollToTop.jsx'
import Header from './components/Header.jsx'
import BottomNav from './components/BottomNav.jsx'
import WelcomeModal from './components/WelcomeModal.jsx'
import Toast from './components/Toast.jsx'
import Footer from './components/Footer.jsx'
import ChatWidget from './components/ChatWidget.jsx'

import HomePage from './pages/HomePage.jsx'
import PlacesListPage from './pages/PlacesListPage.jsx'
import PlaceDetailPage from './pages/PlaceDetailPage.jsx'
import EventsListPage from './pages/EventsListPage.jsx'
import EventDetailPage from './pages/EventDetailPage.jsx'
import TripFormPage from './pages/TripFormPage.jsx'
import LoadingSpinner from './components/LoadingSpinner.jsx'
import { lazyPage } from './lib/lazyPage.js'

// Landing pages stay in the main bundle (first paint, deep links from search).
// Everything else -- account pages, the QR flow, trip results and the whole admin
// dashboard -- is its own chunk, fetched when the route is first opened.
const TripResultPage = lazyPage(() => import('./pages/TripResultPage.jsx'))
const MyTripsPage = lazyPage(() => import('./pages/MyTripsPage.jsx'))
const PointsPage = lazyPage(() => import('./pages/PointsPage.jsx'))
const ProfilePage = lazyPage(() => import('./pages/ProfilePage.jsx'))
const ConfirmEmailChangePage = lazyPage(() => import('./pages/ConfirmEmailChangePage.jsx'))
const ScanLandingPage = lazyPage(() => import('./pages/ScanLandingPage.jsx'))
const LoginPage = lazyPage(() => import('./pages/LoginPage.jsx'))
const SignupPage = lazyPage(() => import('./pages/SignupPage.jsx'))
const ForgotPasswordPage = lazyPage(() => import('./pages/ForgotPasswordPage.jsx'))
const AdminLoginPage = lazyPage(() => import('./pages/AdminLoginPage.jsx'))
const ConfirmEmailPage = lazyPage(() => import('./pages/ConfirmEmailPage.jsx'))
const ResetPasswordPage = lazyPage(() => import('./pages/ResetPasswordPage.jsx'))
const AdminDashboardPage = lazyPage(() => import('./pages/AdminDashboardPage.jsx'))

function PublicLayout() {
  return (
    <div data-role="public-layout" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header />
      <WelcomeModal />
      {/* Public pages call showToast() too ("link copied", "please log in", ...);
          the toast used to be mounted only inside the admin dashboard, so none of
          those were ever shown to visitors. */}
      <Toast />
      <main style={{ flex: 1 }}>
        <Suspense fallback={<LoadingSpinner size={36} label="กำลังโหลด..." />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
      <BottomNav />
      <ChatWidget />
    </div>
  )
}

function RequireAdmin({ children }) {
  const { state } = useApp()
  // Wait for /auth/me before deciding, otherwise F5 on /admin/users bounces to
  // the login page (adminLoggedIn is only hydrated after the session check).
  if (!state.authChecked) return <LoadingSpinner size={36} label="กำลังตรวจสอบการเข้าสู่ระบบ..." />
  return state.adminLoggedIn ? children : <Navigate to="/admin/login" replace />
}

// Waits for the session check on load so a refresh on /profile doesn't bounce a
// signed-in user to /login before /auth/me answers.
function RequireAuth({ children }) {
  const { state } = useApp()
  if (!state.authChecked) return <LoadingSpinner size={36} label="กำลังตรวจสอบการเข้าสู่ระบบ..." />
  return state.loggedIn ? children : <Navigate to="/login" replace />
}

// /login, /signup and /forgot-password mean nothing to someone already signed
// in (the session is an httpOnly cookie that outlives the tab, so a bookmark,
// back button or typed URL can land here while the header already shows the
// account) -- send them on instead of showing a form that looks logged-out.
function RedirectIfAuthed({ children }) {
  const { state } = useApp()
  if (!state.authChecked) return <LoadingSpinner size={36} label="กำลังตรวจสอบการเข้าสู่ระบบ..." />
  return state.loggedIn ? <Navigate to="/" replace /> : children
}

function Shell() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#FFFDF6', backgroundImage: "url('/assets/background1.webp')", backgroundSize: 'cover', backgroundPosition: 'top center', backgroundRepeat: 'no-repeat', backgroundAttachment: 'fixed' }}>
      <ScrollToTop />
      <Suspense fallback={<LoadingSpinner size={36} label="กำลังโหลด..." />}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/places" element={<PlacesListPage />} />
          <Route path="/places/:id" element={<PlaceDetailPage />} />
          <Route path="/events" element={<EventsListPage />} />
          <Route path="/events/:id" element={<EventDetailPage />} />
          <Route path="/trip" element={<TripFormPage />} />
          <Route path="/trips" element={<RequireAuth><MyTripsPage /></RequireAuth>} />
          <Route path="/trip/result" element={<TripResultPage />} />
          <Route path="/trip/:id" element={<TripResultPage />} />
          <Route path="/points" element={<PointsPage />} />
          <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
          <Route path="/scan/:qrId" element={<ScanLandingPage />} />
          <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
          <Route path="/signup" element={<RedirectIfAuthed><SignupPage /></RedirectIfAuthed>} />
          <Route path="/forgot-password" element={<RedirectIfAuthed><ForgotPasswordPage /></RedirectIfAuthed>} />
        </Route>
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/confirm" element={<ConfirmEmailPage />} />
        <Route path="/confirm-email-change" element={<ConfirmEmailChangePage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/admin" element={<RequireAdmin><AdminDashboardPage /></RequireAdmin>} />
        <Route path="/admin/:tab" element={<RequireAdmin><AdminDashboardPage /></RequireAdmin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
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

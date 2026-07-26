import { AppProvider, useApp } from './context/AppContext.jsx'
import Header from './components/Header.jsx'
import MobileMenu from './components/MobileMenu.jsx'
import WelcomeModal from './components/WelcomeModal.jsx'
import Footer from './components/Footer.jsx'
import ChatWidget from './components/ChatWidget.jsx'
import Toast from './components/Toast.jsx'

import HomePage from './pages/HomePage.jsx'
import PlacesListPage from './pages/PlacesListPage.jsx'
import PlaceDetailPage from './pages/PlaceDetailPage.jsx'
import EventsListPage from './pages/EventsListPage.jsx'
import EventDetailPage from './pages/EventDetailPage.jsx'
import TripFormPage from './pages/TripFormPage.jsx'
import TripLoadingPage from './pages/TripLoadingPage.jsx'
import TripResultPage from './pages/TripResultPage.jsx'
import PointsPage from './pages/PointsPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import SignupPage from './pages/SignupPage.jsx'
import AdminLoginPage from './pages/AdminLoginPage.jsx'
import AdminDashboardPage from './pages/AdminDashboardPage.jsx'

function PublicSite() {
  const { derived } = useApp()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header />
      <MobileMenu />
      <WelcomeModal />

      <main style={{ flex: 1 }}>
        {derived.isHome && <HomePage />}
        {derived.isPlacesList && <PlacesListPage />}
        {derived.isEventsList && <EventsListPage />}
        {derived.isPlaceDetail && <PlaceDetailPage />}
        {derived.isEventDetail && <EventDetailPage />}
        {derived.isTripForm && <TripFormPage />}
        {derived.isTripLoading && <TripLoadingPage />}
        {derived.isTripResult && <TripResultPage />}
        {derived.isPoints && <PointsPage />}
        {derived.isLogin && <LoginPage />}
        {derived.isSignup && <SignupPage />}
      </main>

      <Footer />
      <ChatWidget />
    </div>
  )
}

function Shell() {
  const { derived } = useApp()
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#FFFDF6', backgroundImage: "url('./assets/background1.png')", backgroundSize: 'cover', backgroundPosition: 'top center', backgroundRepeat: 'no-repeat', backgroundAttachment: 'fixed' }}>
      {derived.isPublic && <PublicSite />}
      {derived.isAdminLoginView && <AdminLoginPage />}
      {derived.isAdminDashboardView && <AdminDashboardPage />}
      {!derived.isPublic && !derived.isAdminLoginView && !derived.isAdminDashboardView && <Toast />}
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

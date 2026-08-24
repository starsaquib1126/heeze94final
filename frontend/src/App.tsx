import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import LoginPage from '@/pages/LoginPage'

// Lazy-loaded pages (keeps initial bundle small)
import { lazy, Suspense } from 'react'
const DashboardPage       = lazy(() => import('@/pages/DashboardPage'))
const RecruitmentPage     = lazy(() => import('@/pages/RecruitmentPage'))
const CandidateDetailPage = lazy(() => import('@/pages/CandidateDetailPage'))
const EmployeesPage       = lazy(() => import('@/pages/EmployeesPage'))
const AdminPage           = lazy(() => import('@/pages/AdminPage'))
const CtcStructuresPage   = lazy(() => import('@/pages/CtcStructuresPage'))
const LetterTemplatesPage = lazy(() => import('@/pages/LetterTemplatesPage'))
const PublicOfferForm     = lazy(() => import('@/pages/PublicOfferForm'))
const DocumentUploadPage  = lazy(() => import('@/pages/DocumentUploadPage'))

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore()
  if (loading) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireSuperUser({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore()
  if (user?.role !== 'super_user') return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function FullPageSpinner() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent
                      rounded-full animate-spin" />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<FullPageSpinner />}>
        <Routes>
          {/* Public — no auth */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/offer/:tenantSlug" element={<PublicOfferForm />} />
          <Route path="/documents/:token" element={<DocumentUploadPage />} />

          {/* Protected — any HR or Super User */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={
            <RequireAuth><DashboardPage /></RequireAuth>
          } />
          <Route path="/recruitment" element={
            <RequireAuth><RecruitmentPage /></RequireAuth>
          } />
          <Route path="/recruitment/:candidateId" element={
            <RequireAuth><CandidateDetailPage /></RequireAuth>
          } />
          <Route path="/employees" element={
            <RequireAuth><EmployeesPage /></RequireAuth>
          } />

          {/* Super User only */}
          <Route path="/admin/*" element={
            <RequireAuth>
              <RequireSuperUser><AdminPage /></RequireSuperUser>
            </RequireAuth>
          } />
          {/* Any authenticated user — backend allows HR to manage their own
              location's CTC structures, not just Super User */}
          <Route path="/ctc-structures" element={
            <RequireAuth><CtcStructuresPage /></RequireAuth>
          } />
          <Route path="/letter-templates" element={
            <RequireAuth>
              <RequireSuperUser><LetterTemplatesPage /></RequireSuperUser>
            </RequireAuth>
          } />

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

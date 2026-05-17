import React from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import Auth from "./pages/Auth";
import SelectCompany from "./pages/SelectCompany";
import Vendors from "./pages/Vendors";
import Settings from "./pages/Settings";
import ReviewQueue from "./pages/ReviewQueue";
import UploadDocument from "./pages/UploadDocument";
import Organizations from "./pages/Organizations";
import Integrations from "./pages/Integrations";
import VendorRules from "./pages/VendorRules";
import ValidationRules from "./pages/ValidationRules";
import ErrorDocuments from "./pages/ErrorDocuments";
import PublishedDocuments from "./pages/PublishedDocuments";
import AcceptInvitation from "./pages/AcceptInvitation";
import AuditReport from "./pages/AuditReport";
import VendorCategories from "./pages/VendorCategories";
import MultiTenantDocs from "./pages/MultiTenantDocs";
import InvoicesPendingLog from "./pages/InvoicesPendingLog";
import SalesInvoices from "./pages/SalesInvoices";
import TaxRateReport from "./pages/TaxRateReport";
import QuickBooksStatus from "./pages/QuickBooksStatus";
import UsersManagement from "./pages/UsersManagement";
import MyCompany from "./pages/MyCompany";
import AllInvoices from "./pages/AllInvoices";
import BankStatements from "./pages/BankStatements";
import ResetPassword from "./pages/ResetPassword";
import ForgotPassword from "./pages/ForgotPassword";
import XmlDebug from "./pages/XmlDebug";
import LegacyAccountMapping from "./pages/LegacyAccountMapping";
import Onboarding from "./pages/Onboarding";
import AdminCleanupQuickActions from "./pages/AdminCleanupQuickActions";
import NotFound from "./pages/NotFound";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AuthProvider } from "./contexts/AuthContext";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutos - datos considerados frescos
      gcTime: 10 * 60 * 1000, // 10 minutos - tiempo en cache
      refetchOnWindowFocus: false, // No refetch al cambiar ventana
      retry: 1, // Solo 1 reintento en caso de error
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AuthProvider>
        <TooltipProvider>
          <AppErrorBoundary>
            <Routes>
              {/* Auth routes - both "/" and "/auth" point to login */}
              <Route path="/" element={<Auth />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/multi-tenant" element={<MultiTenantDocs />} />

              {/* Protected: Select company */}
              <Route
                path="/select-company"
                element={
                  <ProtectedRoute>
                    <SelectCompany />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/accept-invitation"
                element={
                  <ProtectedRoute>
                    <AcceptInvitation />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/upload"
                element={
                  <ProtectedRoute>
                    <UploadDocument />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/review-queue"
                element={
                  <ProtectedRoute>
                    <ReviewQueue />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/vendors"
                element={
                  <ProtectedRoute requireAdmin>
                    <Vendors />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute requireAdmin>
                    <Settings />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/organization"
                element={
                  <ProtectedRoute requireAdmin>
                    <Organizations />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/my-company"
                element={
                  <ProtectedRoute>
                    <MyCompany />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/integrations"
                element={
                  <ProtectedRoute requireAdmin>
                    <Integrations />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/vendor-rules"
                element={
                  <ProtectedRoute requireAdmin>
                    <VendorRules />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/vendor-categories"
                element={
                  <ProtectedRoute requireAdmin>
                    <VendorCategories />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/validation-rules"
                element={
                  <ProtectedRoute requireAdmin>
                    <ValidationRules />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/error-documents"
                element={
                  <ProtectedRoute>
                    <ErrorDocuments />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/published-documents"
                element={
                  <ProtectedRoute>
                    <PublishedDocuments />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/audit-report"
                element={
                  <ProtectedRoute>
                    <AuditReport />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/xml-debug"
                element={
                  <ProtectedRoute>
                    <XmlDebug />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/legacy-account-mapping"
                element={
                  <ProtectedRoute requireAdmin>
                    <LegacyAccountMapping />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/invoices-pending-log"
                element={
                  <ProtectedRoute>
                    <InvoicesPendingLog />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/sales-invoices"
                element={
                  <ProtectedRoute>
                    <SalesInvoices />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/tax-rate-report"
                element={
                  <ProtectedRoute>
                    <TaxRateReport />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/quickbooks-status"
                element={
                  <ProtectedRoute>
                    <QuickBooksStatus />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/all-invoices"
                element={
                  <ProtectedRoute>
                    <AllInvoices />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/users-management"
                element={
                  <ProtectedRoute requireAdmin>
                    <UsersManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/bank-statements"
                element={
                  <ProtectedRoute>
                    <BankStatements />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/cleanup-quick-actions"
                element={
                  <ProtectedRoute requireAdmin>
                    <AdminCleanupQuickActions />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/onboarding/:orgId"
                element={
                  <ProtectedRoute>
                    <Onboarding />
                  </ProtectedRoute>
                }
              />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppErrorBoundary>
          <Sonner />
        </TooltipProvider>
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;

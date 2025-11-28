import React from "react";
import { Toaster } from "@/components/ui/toaster";
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
import QuickBooksStatus from "./pages/QuickBooksStatus";
import UsersManagement from "./pages/UsersManagement";
import MyCompany from "./pages/MyCompany";
import AllInvoices from "./pages/AllInvoices";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AuthProvider } from "./contexts/AuthContext";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
        <Routes>
          <Route path="/" element={<Auth />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/select-company" element={<SelectCompany />} />
          <Route path="/multi-tenant" element={<MultiTenantDocs />} />
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
            path="/invoices-pending-log"
            element={
              <ProtectedRoute>
                <InvoicesPendingLog />
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
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

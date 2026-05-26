export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      alert_history: {
        Row: {
          acknowledged: boolean | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_type: string
          created_at: string | null
          email_id: string | null
          id: string
          issues_count: number
          issues_data: Json | null
          organization_id: string
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          sent_at: string | null
        }
        Insert: {
          acknowledged?: boolean | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type: string
          created_at?: string | null
          email_id?: string | null
          id?: string
          issues_count?: number
          issues_data?: Json | null
          organization_id: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          sent_at?: string | null
        }
        Update: {
          acknowledged?: boolean | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type?: string
          created_at?: string | null
          email_id?: string | null
          id?: string
          issues_count?: number
          issues_data?: Json | null
          organization_id?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      allowed_emails: {
        Row: {
          added_by: string | null
          created_at: string
          default_role: Database["public"]["Enums"]["app_role"]
          email: string
          note: string | null
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          default_role?: Database["public"]["Enums"]["app_role"]
          email: string
          note?: string | null
        }
        Update: {
          added_by?: string | null
          created_at?: string
          default_role?: Database["public"]["Enums"]["app_role"]
          email?: string
          note?: string | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          ip_address: unknown
          organization_id: string | null
          resource_id: string | null
          resource_type: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: unknown
          organization_id?: string | null
          resource_id?: string | null
          resource_type: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: unknown
          organization_id?: string | null
          resource_id?: string | null
          resource_type?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_import_configs: {
        Row: {
          amount_layout: string
          bank_name: string
          created_at: string
          currency: string
          date_format: string
          id: string
          input_format_type: string
          is_active: boolean
          onedrive_folder_error: string | null
          onedrive_folder_incoming: string | null
          onedrive_folder_processed: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          amount_layout?: string
          bank_name: string
          created_at?: string
          currency?: string
          date_format?: string
          id?: string
          input_format_type?: string
          is_active?: boolean
          onedrive_folder_error?: string | null
          onedrive_folder_incoming?: string | null
          onedrive_folder_processed?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          amount_layout?: string
          bank_name?: string
          created_at?: string
          currency?: string
          date_format?: string
          id?: string
          input_format_type?: string
          is_active?: boolean
          onedrive_folder_error?: string | null
          onedrive_folder_incoming?: string | null
          onedrive_folder_processed?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_import_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_import_job_items: {
        Row: {
          bank_import_job_id: string
          created_at: string
          currency: string
          description: string | null
          id: string
          money_in: number | null
          money_out: number | null
          organization_id: string
          raw_row: Json | null
          reference: string | null
          source_bank: string | null
          status: string
          transaction_date: string
          validation_error: string | null
        }
        Insert: {
          bank_import_job_id: string
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          money_in?: number | null
          money_out?: number | null
          organization_id: string
          raw_row?: Json | null
          reference?: string | null
          source_bank?: string | null
          status?: string
          transaction_date: string
          validation_error?: string | null
        }
        Update: {
          bank_import_job_id?: string
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          money_in?: number | null
          money_out?: number | null
          organization_id?: string
          raw_row?: Json | null
          reference?: string | null
          source_bank?: string | null
          status?: string
          transaction_date?: string
          validation_error?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_import_job_items_bank_import_job_id_fkey"
            columns: ["bank_import_job_id"]
            isOneToOne: false
            referencedRelation: "bank_import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_import_job_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_import_jobs: {
        Row: {
          bank_import_config_id: string
          created_at: string
          error_details: string | null
          error_message: string | null
          file_hash: string | null
          generated_csv_url: string | null
          id: string
          invalid_rows: number | null
          onedrive_file_id: string | null
          onedrive_file_name: string | null
          onedrive_file_path: string | null
          organization_id: string
          status: string
          total_rows: number | null
          updated_at: string
          valid_rows: number | null
        }
        Insert: {
          bank_import_config_id: string
          created_at?: string
          error_details?: string | null
          error_message?: string | null
          file_hash?: string | null
          generated_csv_url?: string | null
          id?: string
          invalid_rows?: number | null
          onedrive_file_id?: string | null
          onedrive_file_name?: string | null
          onedrive_file_path?: string | null
          organization_id: string
          status?: string
          total_rows?: number | null
          updated_at?: string
          valid_rows?: number | null
        }
        Update: {
          bank_import_config_id?: string
          created_at?: string
          error_details?: string | null
          error_message?: string | null
          file_hash?: string | null
          generated_csv_url?: string | null
          id?: string
          invalid_rows?: number | null
          onedrive_file_id?: string | null
          onedrive_file_name?: string | null
          onedrive_file_path?: string | null
          organization_id?: string
          status?: string
          total_rows?: number | null
          updated_at?: string
          valid_rows?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_import_jobs_bank_import_config_id_fkey"
            columns: ["bank_import_config_id"]
            isOneToOne: false
            referencedRelation: "bank_import_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_import_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_import_sources: {
        Row: {
          bank_import_config_id: string
          column_mapping: Json
          created_at: string
          file_extension: string
          id: string
          is_active: boolean
          organization_id: string
          sample_file_url: string | null
          source_name: string
          updated_at: string
        }
        Insert: {
          bank_import_config_id: string
          column_mapping?: Json
          created_at?: string
          file_extension?: string
          id?: string
          is_active?: boolean
          organization_id: string
          sample_file_url?: string | null
          source_name: string
          updated_at?: string
        }
        Update: {
          bank_import_config_id?: string
          column_mapping?: Json
          created_at?: string
          file_extension?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          sample_file_url?: string | null
          source_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_import_sources_bank_import_config_id_fkey"
            columns: ["bank_import_config_id"]
            isOneToOne: false
            referencedRelation: "bank_import_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_import_sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      batch_import_items: {
        Row: {
          batch_id: string
          created_at: string
          currency: string | null
          doc_key: string | null
          doc_number: string | null
          doc_type: string | null
          filename: string
          hacienda_message_code: string | null
          id: string
          issue_date: string | null
          organization_id: string
          pdf_storage_path: string | null
          processed_document_id: string | null
          reason: string | null
          receptor_tax_id: string | null
          receptor_xml_storage_path: string | null
          status: string
          supplier_name: string | null
          supplier_tax_id: string | null
          total_amount: number | null
          total_tax: number | null
          xml_storage_path: string | null
        }
        Insert: {
          batch_id: string
          created_at?: string
          currency?: string | null
          doc_key?: string | null
          doc_number?: string | null
          doc_type?: string | null
          filename: string
          hacienda_message_code?: string | null
          id?: string
          issue_date?: string | null
          organization_id: string
          pdf_storage_path?: string | null
          processed_document_id?: string | null
          reason?: string | null
          receptor_tax_id?: string | null
          receptor_xml_storage_path?: string | null
          status: string
          supplier_name?: string | null
          supplier_tax_id?: string | null
          total_amount?: number | null
          total_tax?: number | null
          xml_storage_path?: string | null
        }
        Update: {
          batch_id?: string
          created_at?: string
          currency?: string | null
          doc_key?: string | null
          doc_number?: string | null
          doc_type?: string | null
          filename?: string
          hacienda_message_code?: string | null
          id?: string
          issue_date?: string | null
          organization_id?: string
          pdf_storage_path?: string | null
          processed_document_id?: string | null
          reason?: string | null
          receptor_tax_id?: string | null
          receptor_xml_storage_path?: string | null
          status?: string
          supplier_name?: string | null
          supplier_tax_id?: string | null
          total_amount?: number | null
          total_tax?: number | null
          xml_storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "batch_import_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batch_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      batch_imports: {
        Row: {
          accepted_count: number
          completed_at: string | null
          created_at: string
          created_by: string
          duplicate_count: number
          id: string
          missing_consecutives: Json
          month_filter: string | null
          notification_sent: boolean
          organization_id: string
          pending_count: number
          rejected_count: number
          status: string
          total_files: number
        }
        Insert: {
          accepted_count?: number
          completed_at?: string | null
          created_at?: string
          created_by: string
          duplicate_count?: number
          id?: string
          missing_consecutives?: Json
          month_filter?: string | null
          notification_sent?: boolean
          organization_id: string
          pending_count?: number
          rejected_count?: number
          status?: string
          total_files?: number
        }
        Update: {
          accepted_count?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string
          duplicate_count?: number
          id?: string
          missing_consecutives?: Json
          month_filter?: string | null
          notification_sent?: boolean
          organization_id?: string
          pending_count?: number
          rejected_count?: number
          status?: string
          total_files?: number
        }
        Relationships: []
      }
      billing_sequences: {
        Row: {
          branch_code: string | null
          created_at: string
          doc_type: string
          id: string
          is_active: boolean | null
          next_number: number | null
          organization_id: string
          prefix: string | null
          terminal_code: string | null
          updated_at: string
        }
        Insert: {
          branch_code?: string | null
          created_at?: string
          doc_type: string
          id?: string
          is_active?: boolean | null
          next_number?: number | null
          organization_id: string
          prefix?: string | null
          terminal_code?: string | null
          updated_at?: string
        }
        Update: {
          branch_code?: string | null
          created_at?: string
          doc_type?: string
          id?: string
          is_active?: boolean | null
          next_number?: number | null
          organization_id?: string
          prefix?: string | null
          terminal_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_sequences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cabys_items: {
        Row: {
          cabys_code: string
          created_at: string
          created_by: string | null
          default_price: number | null
          description: string | null
          id: string
          is_active: boolean | null
          is_service: boolean | null
          name: string
          organization_id: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          cabys_code: string
          created_at?: string
          created_by?: string | null
          default_price?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_service?: boolean | null
          name: string
          organization_id: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          cabys_code?: string
          created_at?: string
          created_by?: string | null
          default_price?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_service?: boolean | null
          name?: string
          organization_id?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cabys_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_defaults: {
        Row: {
          created_at: string
          customer_name: string
          customer_tax_id: string | null
          default_class_ref: string | null
          default_income_account_ref: string | null
          id: string
          organization_id: string
          payment_terms_ref: string | null
          qbo_customer_ref: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_name: string
          customer_tax_id?: string | null
          default_class_ref?: string | null
          default_income_account_ref?: string | null
          id?: string
          organization_id: string
          payment_terms_ref?: string | null
          qbo_customer_ref?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_name?: string
          customer_tax_id?: string | null
          default_class_ref?: string | null
          default_income_account_ref?: string | null
          id?: string
          organization_id?: string
          payment_terms_ref?: string | null
          qbo_customer_ref?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_defaults_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hacienda_certificates: {
        Row: {
          certificate_name: string
          certificate_storage_path: string | null
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          organization_id: string
          pin_hash: string | null
          updated_at: string
        }
        Insert: {
          certificate_name: string
          certificate_storage_path?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id: string
          pin_hash?: string | null
          updated_at?: string
        }
        Update: {
          certificate_name?: string
          certificate_storage_path?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string
          pin_hash?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hacienda_certificates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_accounts: {
        Row: {
          account_email: string | null
          account_name: string | null
          created_at: string | null
          created_by: string | null
          credentials: Json | null
          id: string
          is_active: boolean | null
          organization_id: string
          service_type: string
          updated_at: string | null
        }
        Insert: {
          account_email?: string | null
          account_name?: string | null
          created_at?: string | null
          created_by?: string | null
          credentials?: Json | null
          id?: string
          is_active?: boolean | null
          organization_id: string
          service_type: string
          updated_at?: string | null
        }
        Update: {
          account_email?: string | null
          account_name?: string | null
          created_at?: string | null
          created_by?: string | null
          credentials?: Json | null
          id?: string
          is_active?: boolean | null
          organization_id?: string
          service_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      legacy_account_mapping: {
        Row: {
          created_at: string
          id: string
          legacy_account_code: string
          organization_id: string
          qbo_account_id: string | null
          qbo_account_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          legacy_account_code: string
          organization_id: string
          qbo_account_id?: string | null
          qbo_account_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          legacy_account_code?: string
          organization_id?: string
          qbo_account_id?: string | null
          qbo_account_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "legacy_account_mapping_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_credentials: {
        Row: {
          client_id: string
          client_secret: string
          created_at: string
          id: string
          organization_id: string
          provider: string
          updated_at: string
        }
        Insert: {
          client_id: string
          client_secret: string
          created_at?: string
          id?: string
          organization_id: string
          provider: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          client_secret?: string
          created_at?: string
          id?: string
          organization_id?: string
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_credentials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_progress: {
        Row: {
          completed_at: string | null
          completed_steps: number[]
          created_at: string
          created_by: string | null
          current_step: number
          id: string
          organization_id: string
          step_data: Json
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_steps?: number[]
          created_at?: string
          created_by?: string | null
          current_step?: number
          id?: string
          organization_id: string
          step_data?: Json
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_steps?: number[]
          created_at?: string
          created_by?: string | null
          current_step?: number
          id?: string
          organization_id?: string
          step_data?: Json
          updated_at?: string
        }
        Relationships: []
      }
      onedrive_subscriptions: {
        Row: {
          created_at: string
          delta_link: string | null
          expiration_datetime: string | null
          id: string
          organization_id: string
          resource: string | null
          state: string
          subscription_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          delta_link?: string | null
          expiration_datetime?: string | null
          id?: string
          organization_id: string
          resource?: string | null
          state?: string
          subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          delta_link?: string | null
          expiration_datetime?: string | null
          id?: string
          organization_id?: string
          resource?: string | null
          state?: string
          subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onedrive_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          role: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          organization_id: string
          role?: string
          token: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          role?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          organization_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          organization_id: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          bluehost_connected: boolean | null
          bluehost_email: string | null
          canton: string | null
          created_at: string
          default_account_ref: string | null
          district: string | null
          economic_activity_code: string | null
          email: string | null
          exact_address: string | null
          gmail_connected: boolean | null
          gmail_email: string | null
          google_drive_connected: boolean | null
          google_drive_enabled: boolean | null
          google_drive_folder_id: string | null
          hacienda_notification_email: string | null
          hostinger_connected: boolean | null
          hostinger_email: string | null
          id: string
          identification_number: string | null
          identification_type: string | null
          is_active: boolean
          legal_name: string | null
          main_economic_activity: string | null
          name: string
          outlook_connected: boolean | null
          outlook_email: string | null
          phone: string | null
          province: string | null
          qbo_company_id: string | null
          qbo_realm_id: string | null
          quickbooks_connected: boolean | null
          quickbooks_realm_id: string | null
          sector: string | null
          settings: Json | null
          sharepoint_enabled: boolean
          sharepoint_folder_override: string | null
          tax_id: string | null
          tax_regime: string | null
          trade_name: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          bluehost_connected?: boolean | null
          bluehost_email?: string | null
          canton?: string | null
          created_at?: string
          default_account_ref?: string | null
          district?: string | null
          economic_activity_code?: string | null
          email?: string | null
          exact_address?: string | null
          gmail_connected?: boolean | null
          gmail_email?: string | null
          google_drive_connected?: boolean | null
          google_drive_enabled?: boolean | null
          google_drive_folder_id?: string | null
          hacienda_notification_email?: string | null
          hostinger_connected?: boolean | null
          hostinger_email?: string | null
          id?: string
          identification_number?: string | null
          identification_type?: string | null
          is_active?: boolean
          legal_name?: string | null
          main_economic_activity?: string | null
          name: string
          outlook_connected?: boolean | null
          outlook_email?: string | null
          phone?: string | null
          province?: string | null
          qbo_company_id?: string | null
          qbo_realm_id?: string | null
          quickbooks_connected?: boolean | null
          quickbooks_realm_id?: string | null
          sector?: string | null
          settings?: Json | null
          sharepoint_enabled?: boolean
          sharepoint_folder_override?: string | null
          tax_id?: string | null
          tax_regime?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          bluehost_connected?: boolean | null
          bluehost_email?: string | null
          canton?: string | null
          created_at?: string
          default_account_ref?: string | null
          district?: string | null
          economic_activity_code?: string | null
          email?: string | null
          exact_address?: string | null
          gmail_connected?: boolean | null
          gmail_email?: string | null
          google_drive_connected?: boolean | null
          google_drive_enabled?: boolean | null
          google_drive_folder_id?: string | null
          hacienda_notification_email?: string | null
          hostinger_connected?: boolean | null
          hostinger_email?: string | null
          id?: string
          identification_number?: string | null
          identification_type?: string | null
          is_active?: boolean
          legal_name?: string | null
          main_economic_activity?: string | null
          name?: string
          outlook_connected?: boolean | null
          outlook_email?: string | null
          phone?: string | null
          province?: string | null
          qbo_company_id?: string | null
          qbo_realm_id?: string | null
          quickbooks_connected?: boolean | null
          quickbooks_realm_id?: string | null
          sector?: string | null
          settings?: Json | null
          sharepoint_enabled?: boolean
          sharepoint_folder_override?: string | null
          tax_id?: string | null
          tax_regime?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      password_reset_tokens: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          token: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at: string
          id?: string
          token: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          token?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      processed_documents: {
        Row: {
          created_at: string
          currency: string
          default_account_ref: string | null
          default_class_ref: string | null
          doc_key: string
          doc_number: string
          doc_type: string
          error_message: string | null
          exchange_rate: number | null
          file_path: string | null
          google_drive_pdf_id: string | null
          google_drive_uploaded_at: string | null
          google_drive_xml_id: string | null
          id: string
          issue_date: string
          organization_id: string | null
          pdf_attachment_url: string | null
          processed_at: string | null
          processed_by: string | null
          qbo_entity_id: string | null
          qbo_entity_type: string | null
          retry_count: number | null
          sharepoint_error: string | null
          sharepoint_pdf_id: string | null
          sharepoint_retry_count: number
          sharepoint_status: string | null
          sharepoint_uploaded_at: string | null
          sharepoint_xml_id: string | null
          status: string
          supplier_email: string | null
          supplier_name: string
          supplier_tax_id: string | null
          total_amount: number
          total_discount: number | null
          total_tax: number | null
          updated_at: string
          uses_tax: boolean | null
          vendor_id: string | null
          xml_attachment_url: string | null
          xml_data: Json | null
        }
        Insert: {
          created_at?: string
          currency?: string
          default_account_ref?: string | null
          default_class_ref?: string | null
          doc_key: string
          doc_number: string
          doc_type: string
          error_message?: string | null
          exchange_rate?: number | null
          file_path?: string | null
          google_drive_pdf_id?: string | null
          google_drive_uploaded_at?: string | null
          google_drive_xml_id?: string | null
          id?: string
          issue_date: string
          organization_id?: string | null
          pdf_attachment_url?: string | null
          processed_at?: string | null
          processed_by?: string | null
          qbo_entity_id?: string | null
          qbo_entity_type?: string | null
          retry_count?: number | null
          sharepoint_error?: string | null
          sharepoint_pdf_id?: string | null
          sharepoint_retry_count?: number
          sharepoint_status?: string | null
          sharepoint_uploaded_at?: string | null
          sharepoint_xml_id?: string | null
          status?: string
          supplier_email?: string | null
          supplier_name: string
          supplier_tax_id?: string | null
          total_amount: number
          total_discount?: number | null
          total_tax?: number | null
          updated_at?: string
          uses_tax?: boolean | null
          vendor_id?: string | null
          xml_attachment_url?: string | null
          xml_data?: Json | null
        }
        Update: {
          created_at?: string
          currency?: string
          default_account_ref?: string | null
          default_class_ref?: string | null
          doc_key?: string
          doc_number?: string
          doc_type?: string
          error_message?: string | null
          exchange_rate?: number | null
          file_path?: string | null
          google_drive_pdf_id?: string | null
          google_drive_uploaded_at?: string | null
          google_drive_xml_id?: string | null
          id?: string
          issue_date?: string
          organization_id?: string | null
          pdf_attachment_url?: string | null
          processed_at?: string | null
          processed_by?: string | null
          qbo_entity_id?: string | null
          qbo_entity_type?: string | null
          retry_count?: number | null
          sharepoint_error?: string | null
          sharepoint_pdf_id?: string | null
          sharepoint_retry_count?: number
          sharepoint_status?: string | null
          sharepoint_uploaded_at?: string | null
          sharepoint_xml_id?: string | null
          status?: string
          supplier_email?: string | null
          supplier_name?: string
          supplier_tax_id?: string | null
          total_amount?: number
          total_discount?: number | null
          total_tax?: number | null
          updated_at?: string
          uses_tax?: boolean | null
          vendor_id?: string | null
          xml_attachment_url?: string | null
          xml_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "processed_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processed_documents_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          activo: boolean
          avatar_url: string | null
          cedula_representante: string | null
          created_at: string
          direccion: string | null
          email: string
          full_name: string | null
          id: string
          nombre_comercial: string | null
          nombre_representante: string | null
          numero_cedula: string | null
          telefono: string | null
          tipo_persona: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          avatar_url?: string | null
          cedula_representante?: string | null
          created_at?: string
          direccion?: string | null
          email: string
          full_name?: string | null
          id: string
          nombre_comercial?: string | null
          nombre_representante?: string | null
          numero_cedula?: string | null
          telefono?: string | null
          tipo_persona?: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          avatar_url?: string | null
          cedula_representante?: string | null
          created_at?: string
          direccion?: string | null
          email?: string
          full_name?: string | null
          id?: string
          nombre_comercial?: string | null
          nombre_representante?: string | null
          numero_cedula?: string | null
          telefono?: string | null
          tipo_persona?: string
          updated_at?: string
        }
        Relationships: []
      }
      qbo_publish_tracking: {
        Row: {
          clave_hacienda: string
          created_at: string
          currency: string | null
          doc_number: string
          document_id: string | null
          emisor_identificacion: string | null
          error_message: string | null
          id: string
          organization_id: string
          published_at: string | null
          qbo_doc_number: string | null
          qbo_entity_id: string | null
          qbo_entity_type: string | null
          receptor_identificacion: string | null
          status: string
          supplier_name: string | null
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          clave_hacienda: string
          created_at?: string
          currency?: string | null
          doc_number: string
          document_id?: string | null
          emisor_identificacion?: string | null
          error_message?: string | null
          id?: string
          organization_id: string
          published_at?: string | null
          qbo_doc_number?: string | null
          qbo_entity_id?: string | null
          qbo_entity_type?: string | null
          receptor_identificacion?: string | null
          status?: string
          supplier_name?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          clave_hacienda?: string
          created_at?: string
          currency?: string | null
          doc_number?: string
          document_id?: string | null
          emisor_identificacion?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string
          published_at?: string | null
          qbo_doc_number?: string | null
          qbo_entity_id?: string | null
          qbo_entity_type?: string | null
          receptor_identificacion?: string | null
          status?: string
          supplier_name?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_publish_tracking_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "processed_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qbo_publish_tracking_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          identifier: string
          request_count: number | null
          window_start: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          identifier: string
          request_count?: number | null
          window_start?: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          identifier?: string
          request_count?: number | null
          window_start?: string
        }
        Relationships: []
      }
      sales_invoices: {
        Row: {
          created_at: string
          currency: string
          customer_email: string | null
          customer_name: string
          customer_tax_id: string | null
          default_class_ref: string | null
          default_income_account_ref: string | null
          doc_key: string
          doc_number: string
          doc_type: string
          error_message: string | null
          exchange_rate: number | null
          id: string
          issue_date: string
          organization_id: string
          payment_terms_ref: string | null
          pdf_attachment_url: string | null
          processed_at: string | null
          processed_by: string | null
          qbo_customer_ref: string | null
          qbo_entity_id: string | null
          qbo_entity_type: string | null
          retry_count: number | null
          status: string
          subtotal: number
          total_amount: number
          total_discount: number | null
          total_tax: number | null
          updated_at: string
          xml_attachment_url: string | null
          xml_data: Json | null
        }
        Insert: {
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name: string
          customer_tax_id?: string | null
          default_class_ref?: string | null
          default_income_account_ref?: string | null
          doc_key: string
          doc_number: string
          doc_type?: string
          error_message?: string | null
          exchange_rate?: number | null
          id?: string
          issue_date: string
          organization_id: string
          payment_terms_ref?: string | null
          pdf_attachment_url?: string | null
          processed_at?: string | null
          processed_by?: string | null
          qbo_customer_ref?: string | null
          qbo_entity_id?: string | null
          qbo_entity_type?: string | null
          retry_count?: number | null
          status?: string
          subtotal: number
          total_amount: number
          total_discount?: number | null
          total_tax?: number | null
          updated_at?: string
          xml_attachment_url?: string | null
          xml_data?: Json | null
        }
        Update: {
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name?: string
          customer_tax_id?: string | null
          default_class_ref?: string | null
          default_income_account_ref?: string | null
          doc_key?: string
          doc_number?: string
          doc_type?: string
          error_message?: string | null
          exchange_rate?: number | null
          id?: string
          issue_date?: string
          organization_id?: string
          payment_terms_ref?: string | null
          pdf_attachment_url?: string | null
          processed_at?: string | null
          processed_by?: string | null
          qbo_customer_ref?: string | null
          qbo_entity_id?: string | null
          qbo_entity_type?: string | null
          retry_count?: number | null
          status?: string
          subtotal?: number
          total_amount?: number
          total_discount?: number | null
          total_tax?: number | null
          updated_at?: string
          xml_attachment_url?: string | null
          xml_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sharepoint_admin_account: {
        Row: {
          admin_email: string
          created_at: string
          credentials: Json
          drive_id: string | null
          id: string
          is_active: boolean
          root_folder_id: string | null
          root_folder_path: string
          site_id: string | null
          site_name: string | null
          site_url: string | null
          updated_at: string
        }
        Insert: {
          admin_email: string
          created_at?: string
          credentials: Json
          drive_id?: string | null
          id?: string
          is_active?: boolean
          root_folder_id?: string | null
          root_folder_path?: string
          site_id?: string | null
          site_name?: string | null
          site_url?: string | null
          updated_at?: string
        }
        Update: {
          admin_email?: string
          created_at?: string
          credentials?: Json
          drive_id?: string | null
          id?: string
          is_active?: boolean
          root_folder_id?: string | null
          root_folder_path?: string
          site_id?: string | null
          site_name?: string | null
          site_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sync_logs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_code: string | null
          error_detail: string | null
          error_message: string | null
          execution_time_ms: number | null
          gmail_failed: number | null
          gmail_fetched: number | null
          gmail_processed: number | null
          id: string
          organization_id: string
          qbo_failed: number | null
          qbo_published: number | null
          started_at: string
          status: string
          trigger_type: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_detail?: string | null
          error_message?: string | null
          execution_time_ms?: number | null
          gmail_failed?: number | null
          gmail_fetched?: number | null
          gmail_processed?: number | null
          id?: string
          organization_id: string
          qbo_failed?: number | null
          qbo_published?: number | null
          started_at?: string
          status?: string
          trigger_type: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_detail?: string | null
          error_message?: string | null
          execution_time_ms?: number | null
          gmail_failed?: number | null
          gmail_fetched?: number | null
          gmail_processed?: number | null
          id?: string
          organization_id?: string
          qbo_failed?: number | null
          qbo_published?: number | null
          started_at?: string
          status?: string
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          description: string | null
          key: string
          organization_id: string
          updated_at: string
          updated_by: string | null
          value: string
        }
        Insert: {
          description?: string | null
          key: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
          value: string
        }
        Update: {
          description?: string | null
          key?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_active_organization: {
        Row: {
          organization_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          organization_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          organization_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_active_organization_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vendor_categories: {
        Row: {
          account_code: string
          created_at: string
          id: string
          is_active: boolean
          organization_id: string
          updated_at: string
          vendor_identification: string
          vendor_name: string
        }
        Insert: {
          account_code: string
          created_at?: string
          id?: string
          is_active?: boolean
          organization_id: string
          updated_at?: string
          vendor_identification: string
          vendor_name: string
        }
        Update: {
          account_code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          updated_at?: string
          vendor_identification?: string
          vendor_name?: string
        }
        Relationships: []
      }
      vendor_classification_rules: {
        Row: {
          account_code: string
          account_description: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          organization_id: string
          updated_at: string
          vendor_name: string
        }
        Insert: {
          account_code: string
          account_description?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          organization_id: string
          updated_at?: string
          vendor_name: string
        }
        Update: {
          account_code?: string
          account_description?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          updated_at?: string
          vendor_name?: string
        }
        Relationships: []
      }
      vendor_defaults: {
        Row: {
          created_at: string
          default_account_ref: string | null
          default_uses_tax: boolean | null
          id: string
          organization_id: string
          updated_at: string
          vendor_name: string
        }
        Insert: {
          created_at?: string
          default_account_ref?: string | null
          default_uses_tax?: boolean | null
          id?: string
          organization_id: string
          updated_at?: string
          vendor_name: string
        }
        Update: {
          created_at?: string
          default_account_ref?: string | null
          default_uses_tax?: boolean | null
          id?: string
          organization_id?: string
          updated_at?: string
          vendor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_defaults_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          created_at: string
          created_by: string | null
          default_account_ref: string
          default_class_ref: string | null
          default_location_ref: string | null
          discount_account_ref: string | null
          id: string
          is_active: boolean
          mapping_hints: string | null
          organization_id: string | null
          qbo_vendor_ref: string
          tax_rate: number
          tax_treatment: string
          terms_ref: string | null
          updated_at: string
          vendor_email: string | null
          vendor_name: string
          vendor_tax_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_account_ref: string
          default_class_ref?: string | null
          default_location_ref?: string | null
          discount_account_ref?: string | null
          id?: string
          is_active?: boolean
          mapping_hints?: string | null
          organization_id?: string | null
          qbo_vendor_ref: string
          tax_rate: number
          tax_treatment: string
          terms_ref?: string | null
          updated_at?: string
          vendor_email?: string | null
          vendor_name: string
          vendor_tax_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_account_ref?: string
          default_class_ref?: string | null
          default_location_ref?: string | null
          discount_account_ref?: string | null
          id?: string
          is_active?: boolean
          mapping_hints?: string | null
          organization_id?: string | null
          qbo_vendor_ref?: string
          tax_rate?: number
          tax_treatment?: string
          terms_ref?: string | null
          updated_at?: string
          vendor_email?: string | null
          vendor_name?: string
          vendor_tax_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_edit_organization_content: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      get_active_email_services: {
        Args: { _org_id: string }
        Returns: {
          service_type: string
        }[]
      }
      get_user_active_organization: {
        Args: { _user_id: string }
        Returns: string
      }
      has_active_integration: {
        Args: { _org_id: string; _service_type: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_organization_admin: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      is_organization_member: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      is_organization_owner: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const

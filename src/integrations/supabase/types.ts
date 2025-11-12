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
          created_at: string
          email: string | null
          gmail_connected: boolean | null
          gmail_email: string | null
          google_drive_connected: boolean | null
          google_drive_enabled: boolean | null
          google_drive_folder_id: string | null
          id: string
          is_active: boolean
          name: string
          outlook_connected: boolean | null
          outlook_email: string | null
          phone: string | null
          qbo_company_id: string | null
          qbo_realm_id: string | null
          quickbooks_connected: boolean | null
          quickbooks_realm_id: string | null
          settings: Json | null
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          gmail_connected?: boolean | null
          gmail_email?: string | null
          google_drive_connected?: boolean | null
          google_drive_enabled?: boolean | null
          google_drive_folder_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          outlook_connected?: boolean | null
          outlook_email?: string | null
          phone?: string | null
          qbo_company_id?: string | null
          qbo_realm_id?: string | null
          quickbooks_connected?: boolean | null
          quickbooks_realm_id?: string | null
          settings?: Json | null
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          gmail_connected?: boolean | null
          gmail_email?: string | null
          google_drive_connected?: boolean | null
          google_drive_enabled?: boolean | null
          google_drive_folder_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          outlook_connected?: boolean | null
          outlook_email?: string | null
          phone?: string | null
          qbo_company_id?: string | null
          qbo_realm_id?: string | null
          quickbooks_connected?: boolean | null
          quickbooks_realm_id?: string | null
          settings?: Json | null
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      processed_documents: {
        Row: {
          created_at: string
          currency: string
          doc_key: string
          doc_number: string
          doc_type: string
          error_message: string | null
          exchange_rate: number | null
          file_path: string | null
          id: string
          issue_date: string
          organization_id: string | null
          pdf_attachment_url: string | null
          processed_at: string | null
          processed_by: string | null
          qbo_entity_id: string | null
          qbo_entity_type: string | null
          retry_count: number | null
          status: string
          supplier_email: string | null
          supplier_name: string
          supplier_tax_id: string | null
          total_amount: number
          total_discount: number | null
          total_tax: number | null
          updated_at: string
          vendor_id: string | null
          xml_attachment_url: string | null
          xml_data: Json | null
        }
        Insert: {
          created_at?: string
          currency?: string
          doc_key: string
          doc_number: string
          doc_type: string
          error_message?: string | null
          exchange_rate?: number | null
          file_path?: string | null
          id?: string
          issue_date: string
          organization_id?: string | null
          pdf_attachment_url?: string | null
          processed_at?: string | null
          processed_by?: string | null
          qbo_entity_id?: string | null
          qbo_entity_type?: string | null
          retry_count?: number | null
          status?: string
          supplier_email?: string | null
          supplier_name: string
          supplier_tax_id?: string | null
          total_amount: number
          total_discount?: number | null
          total_tax?: number | null
          updated_at?: string
          vendor_id?: string | null
          xml_attachment_url?: string | null
          xml_data?: Json | null
        }
        Update: {
          created_at?: string
          currency?: string
          doc_key?: string
          doc_number?: string
          doc_type?: string
          error_message?: string | null
          exchange_rate?: number | null
          file_path?: string | null
          id?: string
          issue_date?: string
          organization_id?: string | null
          pdf_attachment_url?: string | null
          processed_at?: string | null
          processed_by?: string | null
          qbo_entity_id?: string | null
          qbo_entity_type?: string | null
          retry_count?: number | null
          status?: string
          supplier_email?: string | null
          supplier_name?: string
          supplier_tax_id?: string | null
          total_amount?: number
          total_discount?: number | null
          total_tax?: number | null
          updated_at?: string
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
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      sync_logs: {
        Row: {
          completed_at: string | null
          created_at: string
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
      get_user_active_organization: {
        Args: { _user_id: string }
        Returns: string
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

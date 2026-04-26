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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          importance: string
          organization_id: string
          payload: Json
          processed_at: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          importance?: string
          organization_id: string
          payload?: Json
          processed_at?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          importance?: string
          organization_id?: string
          payload?: Json
          processed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
          organization_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          organization_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          company_website: string | null
          contact_name: string | null
          created_at: string
          created_by: string | null
          email: string | null
          external_id: number | null
          external_source: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          company_website?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          external_id?: number | null
          external_source?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          company_website?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          external_id?: number | null
          external_source?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          description: string | null
          head_employee_id: string | null
          id: string
          name: string
          organization_id: string
          parent_department_id: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          head_employee_id?: string | null
          id?: string
          name: string
          organization_id: string
          parent_department_id?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          head_employee_id?: string | null
          id?: string
          name?: string
          organization_id?: string
          parent_department_id?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_head_employee_fk"
            columns: ["head_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_parent_department_id_fkey"
            columns: ["parent_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          department_id: string | null
          email: string | null
          employment_status: string
          external_id: number | null
          external_source: string | null
          full_name: string
          id: string
          job_title: string | null
          manager_employee_id: string | null
          organization_id: string
          phone: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          department_id?: string | null
          email?: string | null
          employment_status?: string
          external_id?: number | null
          external_source?: string | null
          full_name: string
          id?: string
          job_title?: string | null
          manager_employee_id?: string | null
          organization_id: string
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          department_id?: string | null
          email?: string | null
          employment_status?: string
          external_id?: number | null
          external_source?: string | null
          full_name?: string
          id?: string
          job_title?: string | null
          manager_employee_id?: string | null
          organization_id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_profiles_manager_employee_id_fkey"
            columns: ["manager_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          organization_id: string
          read_at: string | null
          recipient_employee_id: string | null
          recipient_user_id: string | null
          title: string
          type: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          organization_id: string
          read_at?: string | null
          recipient_employee_id?: string | null
          recipient_user_id?: string | null
          title: string
          type: string
        }
        Update: {
          body?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          organization_id?: string
          read_at?: string | null
          recipient_employee_id?: string | null
          recipient_user_id?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_employee_id_fkey"
            columns: ["recipient_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          default_locale: string
          id: string
          logo_url: string | null
          name: string
          project_manager_employee_id: string | null
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_locale?: string
          id?: string
          logo_url?: string | null
          name: string
          project_manager_employee_id?: string | null
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_locale?: string
          id?: string
          logo_url?: string | null
          name?: string
          project_manager_employee_id?: string | null
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_project_manager_employee_id_fkey"
            columns: ["project_manager_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          created_at: string
          description: string | null
          id: string
          key: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          key: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          key?: string
        }
        Relationships: []
      }
      project_members: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          organization_id: string
          project_id: string
          role_label: string | null
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          organization_id: string
          project_id: string
          role_label?: string | null
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          organization_id?: string
          project_id?: string
          role_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_members_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_services: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          project_id: string
          service_id: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          project_id: string
          service_id: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          project_id?: string
          service_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_services_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_services_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          account_manager_employee_id: string | null
          client_id: string
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string | null
          external_id: number | null
          external_source: string | null
          id: string
          name: string
          organization_id: string
          priority: string
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_manager_employee_id?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          external_id?: number | null
          external_source?: string | null
          id?: string
          name: string
          organization_id: string
          priority?: string
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_manager_employee_id?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          external_id?: number | null
          external_source?: string | null
          id?: string
          name?: string
          organization_id?: string
          priority?: string
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_account_manager_employee_id_fkey"
            columns: ["account_manager_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_id: string
          role_id: string
        }
        Insert: {
          permission_id: string
          role_id: string
        }
        Update: {
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          key: string
          name: string
          organization_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key: string
          name: string
          organization_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key?: string
          name?: string
          organization_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_handover_forms: {
        Row: {
          assigned_account_manager_employee_id: string | null
          client_contact_name: string | null
          client_email: string | null
          client_id: string | null
          client_name: string
          client_phone: string | null
          created_at: string
          id: string
          organization_id: string
          package_details: string | null
          project_id: string | null
          project_start_date: string | null
          sales_notes: string | null
          selected_service_ids: string[]
          status: string
          submitted_by: string
          updated_at: string
          urgency_level: string
        }
        Insert: {
          assigned_account_manager_employee_id?: string | null
          client_contact_name?: string | null
          client_email?: string | null
          client_id?: string | null
          client_name: string
          client_phone?: string | null
          created_at?: string
          id?: string
          organization_id: string
          package_details?: string | null
          project_id?: string | null
          project_start_date?: string | null
          sales_notes?: string | null
          selected_service_ids?: string[]
          status?: string
          submitted_by: string
          updated_at?: string
          urgency_level?: string
        }
        Update: {
          assigned_account_manager_employee_id?: string | null
          client_contact_name?: string | null
          client_email?: string | null
          client_id?: string | null
          client_name?: string
          client_phone?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          package_details?: string | null
          project_id?: string | null
          project_start_date?: string | null
          sales_notes?: string | null
          selected_service_ids?: string[]
          status?: string
          submitted_by?: string
          updated_at?: string
          urgency_level?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_handover_forms_assigned_account_manager_employee_id_fkey"
            columns: ["assigned_account_manager_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_handover_forms_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_handover_forms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_handover_forms_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          created_at: string
          default_department_id: string | null
          default_specialist_employee_id: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_department_id?: string | null
          default_specialist_employee_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_department_id?: string | null
          default_specialist_employee_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_default_department_id_fkey"
            columns: ["default_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_default_specialist_employee_id_fkey"
            columns: ["default_specialist_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignees: {
        Row: {
          assigned_by: string | null
          created_at: string
          employee_id: string
          id: string
          organization_id: string
          role_type: Database["public"]["Enums"]["task_role_type"]
          task_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          employee_id: string
          id?: string
          organization_id: string
          role_type: Database["public"]["Enums"]["task_role_type"]
          task_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          organization_id?: string
          role_type?: Database["public"]["Enums"]["task_role_type"]
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          author_user_id: string
          body: string
          created_at: string
          id: string
          is_internal: boolean
          organization_id: string
          task_id: string
          updated_at: string
        }
        Insert: {
          author_user_id: string
          body: string
          created_at?: string
          id?: string
          is_internal?: boolean
          organization_id: string
          task_id: string
          updated_at?: string
        }
        Update: {
          author_user_id?: string
          body?: string
          created_at?: string
          id?: string
          is_internal?: boolean
          organization_id?: string
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
        ]
      }
      task_mentions: {
        Row: {
          created_at: string
          id: string
          mentioned_employee_id: string
          mentioned_user_id: string | null
          organization_id: string
          task_comment_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mentioned_employee_id: string
          mentioned_user_id?: string | null
          organization_id: string
          task_comment_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mentioned_employee_id?: string
          mentioned_user_id?: string | null
          organization_id?: string
          task_comment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_mentions_mentioned_employee_id_fkey"
            columns: ["mentioned_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_mentions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_mentions_task_comment_id_fkey"
            columns: ["task_comment_id"]
            isOneToOne: false
            referencedRelation: "task_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      task_stage_history: {
        Row: {
          created_at: string
          duration_seconds: number | null
          entered_at: string
          exited_at: string | null
          from_stage: Database["public"]["Enums"]["task_stage"] | null
          id: string
          moved_by: string | null
          organization_id: string
          task_id: string
          to_stage: Database["public"]["Enums"]["task_stage"]
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          entered_at?: string
          exited_at?: string | null
          from_stage?: Database["public"]["Enums"]["task_stage"] | null
          id?: string
          moved_by?: string | null
          organization_id: string
          task_id: string
          to_stage: Database["public"]["Enums"]["task_stage"]
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          entered_at?: string
          exited_at?: string | null
          from_stage?: Database["public"]["Enums"]["task_stage"] | null
          id?: string
          moved_by?: string | null
          organization_id?: string
          task_id?: string
          to_stage?: Database["public"]["Enums"]["task_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "task_stage_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_stage_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_stage_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
        ]
      }
      task_template_items: {
        Row: {
          created_at: string
          default_department_id: string | null
          default_role_key: string | null
          description: string | null
          duration_days: number
          id: string
          offset_days_from_project_start: number
          order_index: number
          organization_id: string
          priority: string
          task_template_id: string
          title: string
          updated_at: string
          upload_offset_days_before_deadline: number | null
          week_index: number | null
        }
        Insert: {
          created_at?: string
          default_department_id?: string | null
          default_role_key?: string | null
          description?: string | null
          duration_days?: number
          id?: string
          offset_days_from_project_start?: number
          order_index?: number
          organization_id: string
          priority?: string
          task_template_id: string
          title: string
          updated_at?: string
          upload_offset_days_before_deadline?: number | null
          week_index?: number | null
        }
        Update: {
          created_at?: string
          default_department_id?: string | null
          default_role_key?: string | null
          description?: string | null
          duration_days?: number
          id?: string
          offset_days_from_project_start?: number
          order_index?: number
          organization_id?: string
          priority?: string
          task_template_id?: string
          title?: string
          updated_at?: string
          upload_offset_days_before_deadline?: number | null
          week_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "task_template_items_default_department_id_fkey"
            columns: ["default_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_template_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_template_items_task_template_id_fkey"
            columns: ["task_template_id"]
            isOneToOne: false
            referencedRelation: "task_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      task_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          service_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          service_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          service_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          allocated_time_minutes: number | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          created_from_template_item_id: string | null
          description: string | null
          due_date: string | null
          expected_progress_percent: number
          external_id: number | null
          external_source: string | null
          id: string
          organization_id: string
          planned_date: string | null
          priority: string
          progress_percent: number
          progress_slip_percent: number
          project_id: string
          service_id: string | null
          stage: Database["public"]["Enums"]["task_stage"]
          stage_entered_at: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          allocated_time_minutes?: number | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_from_template_item_id?: string | null
          description?: string | null
          due_date?: string | null
          expected_progress_percent?: number
          external_id?: number | null
          external_source?: string | null
          id?: string
          organization_id: string
          planned_date?: string | null
          priority?: string
          progress_percent?: number
          progress_slip_percent?: number
          project_id: string
          service_id?: string | null
          stage?: Database["public"]["Enums"]["task_stage"]
          stage_entered_at?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          allocated_time_minutes?: number | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_from_template_item_id?: string | null
          description?: string | null
          due_date?: string | null
          expected_progress_percent?: number
          external_id?: number | null
          external_source?: string | null
          id?: string
          organization_id?: string
          planned_date?: string | null
          priority?: string
          progress_percent?: number
          progress_slip_percent?: number
          project_id?: string
          service_id?: string | null
          stage?: Database["public"]["Enums"]["task_stage"]
          stage_entered_at?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_created_from_template_item_id_fkey"
            columns: ["created_from_template_item_id"]
            isOneToOne: false
            referencedRelation: "task_template_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_groups: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          invite_url: string | null
          kind: Database["public"]["Enums"]["whatsapp_group_kind"]
          name: string
          notes: string | null
          organization_id: string
          project_id: string
          updated_at: string
          whatsapp_chat_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          invite_url?: string | null
          kind: Database["public"]["Enums"]["whatsapp_group_kind"]
          name: string
          notes?: string | null
          organization_id: string
          project_id: string
          updated_at?: string
          whatsapp_chat_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          invite_url?: string | null
          kind?: Database["public"]["Enums"]["whatsapp_group_kind"]
          name?: string
          notes?: string | null
          organization_id?: string
          project_id?: string
          updated_at?: string
          whatsapp_chat_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_groups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      tasks_with_metrics: {
        Row: {
          allocated_time_minutes: number | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          created_from_template_item_id: string | null
          current_stage_seconds: number | null
          delay_days: number | null
          description: string | null
          due_date: string | null
          expected_progress_percent: number | null
          id: string | null
          organization_id: string | null
          planned_date: string | null
          priority: string | null
          progress_percent: number | null
          progress_slip_percent: number | null
          project_id: string | null
          service_id: string | null
          stage: Database["public"]["Enums"]["task_stage"] | null
          stage_entered_at: string | null
          status: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          allocated_time_minutes?: number | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          created_from_template_item_id?: string | null
          current_stage_seconds?: never
          delay_days?: never
          description?: string | null
          due_date?: string | null
          expected_progress_percent?: number | null
          id?: string | null
          organization_id?: string | null
          planned_date?: string | null
          priority?: string | null
          progress_percent?: number | null
          progress_slip_percent?: number | null
          project_id?: string | null
          service_id?: string | null
          stage?: Database["public"]["Enums"]["task_stage"] | null
          stage_entered_at?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          allocated_time_minutes?: number | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          created_from_template_item_id?: string | null
          current_stage_seconds?: never
          delay_days?: never
          description?: string | null
          due_date?: string | null
          expected_progress_percent?: number | null
          id?: string | null
          organization_id?: string | null
          planned_date?: string | null
          priority?: string | null
          progress_percent?: number | null
          progress_slip_percent?: number | null
          project_id?: string | null
          service_id?: string | null
          stage?: Database["public"]["Enums"]["task_stage"] | null
          stage_entered_at?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_created_from_template_item_id_fkey"
            columns: ["created_from_template_item_id"]
            isOneToOne: false
            referencedRelation: "task_template_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      current_user_organization_ids: { Args: never; Returns: string[] }
      has_org_access: { Args: { target_org: string }; Returns: boolean }
      has_permission: {
        Args: { perm_key: string; target_org: string }
        Returns: boolean
      }
      task_current_stage_seconds: {
        Args: { t: Database["public"]["Tables"]["tasks"]["Row"] }
        Returns: number
      }
      task_delay_days: {
        Args: { t: Database["public"]["Tables"]["tasks"]["Row"] }
        Returns: number
      }
    }
    Enums: {
      task_role_type: "specialist" | "manager" | "agent" | "account_manager"
      task_stage:
        | "new"
        | "in_progress"
        | "manager_review"
        | "specialist_review"
        | "ready_to_send"
        | "sent_to_client"
        | "client_changes"
        | "done"
      whatsapp_group_kind: "client" | "internal"
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
      task_role_type: ["specialist", "manager", "agent", "account_manager"],
      task_stage: [
        "new",
        "in_progress",
        "manager_review",
        "specialist_review",
        "ready_to_send",
        "sent_to_client",
        "client_changes",
        "done",
      ],
      whatsapp_group_kind: ["client", "internal"],
    },
  },
} as const


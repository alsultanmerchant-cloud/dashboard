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
      accountability_advice_cache: {
        Row: {
          employee_id: string
          generated_at: string
          model: string | null
          organization_id: string
          result_json: Json
          signature: string
        }
        Insert: {
          employee_id: string
          generated_at?: string
          model?: string | null
          organization_id: string
          result_json: Json
          signature: string
        }
        Update: {
          employee_id?: string
          generated_at?: string
          model?: string | null
          organization_id?: string
          result_json?: Json
          signature?: string
        }
        Relationships: [
          {
            foreignKeyName: "accountability_advice_cache_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountability_advice_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      accountability_case_events: {
        Row: {
          actor_employee_id: string | null
          case_id: string
          created_at: string
          id: string
          kind: string
          note: string | null
          organization_id: string
          severity: string | null
          status: string | null
        }
        Insert: {
          actor_employee_id?: string | null
          case_id: string
          created_at?: string
          id?: string
          kind: string
          note?: string | null
          organization_id: string
          severity?: string | null
          status?: string | null
        }
        Update: {
          actor_employee_id?: string | null
          case_id?: string
          created_at?: string
          id?: string
          kind?: string
          note?: string | null
          organization_id?: string
          severity?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accountability_case_events_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountability_case_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "accountability_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountability_case_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      accountability_cases: {
        Row: {
          client_names: string[]
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          employee_id: string
          first_seen_at: string
          id: string
          is_current: boolean
          last_seen_at: string
          last_seen_date: string
          ledger: Json | null
          organization_id: string
          problem_tags: string[]
          proof: Json
          severity: string
          status: string
          streams: string[]
          times_seen: number
          updated_at: string
        }
        Insert: {
          client_names?: string[]
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          employee_id: string
          first_seen_at?: string
          id?: string
          is_current?: boolean
          last_seen_at?: string
          last_seen_date?: string
          ledger?: Json | null
          organization_id: string
          problem_tags?: string[]
          proof?: Json
          severity: string
          status?: string
          streams?: string[]
          times_seen?: number
          updated_at?: string
        }
        Update: {
          client_names?: string[]
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          employee_id?: string
          first_seen_at?: string
          id?: string
          is_current?: boolean
          last_seen_at?: string
          last_seen_date?: string
          ledger?: Json | null
          organization_id?: string
          problem_tags?: string[]
          proof?: Json
          severity?: string
          status?: string
          streams?: string[]
          times_seen?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accountability_cases_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountability_cases_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountability_cases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      accountability_scorecard: {
        Row: {
          avg_dwell: number | null
          employee_id: string
          open_tasks: number
          organization_id: string
          overdue_owned: number
          refreshed_at: string
          rework_30d: number
          role: string
          sample_size: number
          sla_n: number
          sla_ok: number
        }
        Insert: {
          avg_dwell?: number | null
          employee_id: string
          open_tasks?: number
          organization_id: string
          overdue_owned?: number
          refreshed_at?: string
          rework_30d?: number
          role: string
          sample_size?: number
          sla_n?: number
          sla_ok?: number
        }
        Update: {
          avg_dwell?: number | null
          employee_id?: string
          open_tasks?: number
          organization_id?: string
          overdue_owned?: number
          refreshed_at?: string
          rework_30d?: number
          role?: string
          sample_size?: number
          sla_n?: number
          sla_ok?: number
        }
        Relationships: [
          {
            foreignKeyName: "accountability_scorecard_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_actor_aliases: {
        Row: {
          author_name: string
          employee_id: string
          organization_id: string
        }
        Insert: {
          author_name: string
          employee_id: string
          organization_id: string
        }
        Update: {
          author_name?: string
          employee_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_actor_aliases_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_actor_aliases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_config: {
        Row: {
          created_at: string
          instrumentation_cutover_date: string
          organization_id: string
          scored_roles: string[]
          updated_at: string
          window_working_days: number
        }
        Insert: {
          created_at?: string
          instrumentation_cutover_date?: string
          organization_id: string
          scored_roles?: string[]
          updated_at?: string
          window_working_days?: number
        }
        Update: {
          created_at?: string
          instrumentation_cutover_date?: string
          organization_id?: string
          scored_roles?: string[]
          updated_at?: string
          window_working_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "activity_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_ai_cache: {
        Row: {
          employee_id: string
          generated_at: string
          kind: string
          organization_id: string
          payload: Json
        }
        Insert: {
          employee_id: string
          generated_at?: string
          kind: string
          organization_id: string
          payload: Json
        }
        Update: {
          employee_id?: string
          generated_at?: string
          kind?: string
          organization_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "agent_ai_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_company_knowledge: {
        Row: {
          corrected_text: string | null
          created_at: string
          created_by: string | null
          id: string
          instruction: string
          is_active: boolean
          kind: string
          organization_id: string
          source_field: string | null
          updated_at: string
          wrong_text: string | null
        }
        Insert: {
          corrected_text?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          instruction: string
          is_active?: boolean
          kind?: string
          organization_id: string
          source_field?: string | null
          updated_at?: string
          wrong_text?: string | null
        }
        Update: {
          corrected_text?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          instruction?: string
          is_active?: boolean
          kind?: string
          organization_id?: string
          source_field?: string | null
          updated_at?: string
          wrong_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_company_knowledge_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_conversations: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
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
      ai_insight_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          is_current: boolean
          model: string | null
          organization_id: string
          requested_by: string | null
          result_json: Json | null
          snapshot_text: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          is_current?: boolean
          model?: string | null
          organization_id: string
          requested_by?: string | null
          result_json?: Json | null
          snapshot_text?: string | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          is_current?: boolean
          model?: string | null
          organization_id?: string
          requested_by?: string | null
          result_json?: Json | null
          snapshot_text?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_insight_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_lesson_cache: {
        Row: {
          employee_profile_id: string
          generated_at: string
          model: string | null
          organization_id: string
          result_json: Json
          signature: string
          task_id: string
        }
        Insert: {
          employee_profile_id: string
          generated_at?: string
          model?: string | null
          organization_id: string
          result_json: Json
          signature: string
          task_id: string
        }
        Update: {
          employee_profile_id?: string
          generated_at?: string
          model?: string | null
          organization_id?: string
          result_json?: Json
          signature?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_lesson_cache_employee_profile_id_fkey"
            columns: ["employee_profile_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_lesson_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_lesson_cache_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "ai_lesson_cache_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_lesson_cache_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_lesson_cache_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "ai_lesson_cache_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "ai_lesson_cache_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
        ]
      }
      ai_messages: {
        Row: {
          content: Json
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: Json
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: Json
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      am_targets: {
        Row: {
          account_manager_id: string
          achieved_total: number
          achievement_pct: number
          breakdown_json: Json
          created_at: string
          expected_total: number
          id: string
          month: string
          organization_id: string
          team_achieved: number | null
          team_expected: number | null
          team_role: string | null
          updated_at: string
        }
        Insert: {
          account_manager_id: string
          achieved_total?: number
          achievement_pct?: number
          breakdown_json?: Json
          created_at?: string
          expected_total?: number
          id?: string
          month: string
          organization_id: string
          team_achieved?: number | null
          team_expected?: number | null
          team_role?: string | null
          updated_at?: string
        }
        Update: {
          account_manager_id?: string
          achieved_total?: number
          achievement_pct?: number
          breakdown_json?: Json
          created_at?: string
          expected_total?: number
          id?: string
          month?: string
          organization_id?: string
          team_achieved?: number | null
          team_expected?: number | null
          team_role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "am_targets_account_manager_id_fkey"
            columns: ["account_manager_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "am_targets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          check_in_at: string | null
          check_out_at: string | null
          created_at: string
          created_by: string | null
          employee_profile_id: string
          id: string
          late_minutes: number
          note: string | null
          organization_id: string
          source: string
          status: Database["public"]["Enums"]["attendance_status"]
          updated_at: string
          work_date: string
          worked_minutes: number | null
        }
        Insert: {
          check_in_at?: string | null
          check_out_at?: string | null
          created_at?: string
          created_by?: string | null
          employee_profile_id: string
          id?: string
          late_minutes?: number
          note?: string | null
          organization_id: string
          source?: string
          status?: Database["public"]["Enums"]["attendance_status"]
          updated_at?: string
          work_date: string
          worked_minutes?: number | null
        }
        Update: {
          check_in_at?: string | null
          check_out_at?: string | null
          created_at?: string
          created_by?: string | null
          employee_profile_id?: string
          id?: string
          late_minutes?: number
          note?: string | null
          organization_id?: string
          source?: string
          status?: Database["public"]["Enums"]["attendance_status"]
          updated_at?: string
          work_date?: string
          worked_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_employee_profile_id_fkey"
            columns: ["employee_profile_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_organization_id_fkey"
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
      business_hours: {
        Row: {
          close_time: string
          open_time: string
          tz: string
          weekday: number
        }
        Insert: {
          close_time: string
          open_time: string
          tz?: string
          weekday: number
        }
        Update: {
          close_time?: string
          open_time?: string
          tz?: string
          weekday?: number
        }
        Relationships: []
      }
      ceo_brief_dismissed_risks: {
        Row: {
          created_at: string
          dismissed_by: string | null
          entity_id: string | null
          id: string
          is_active: boolean
          organization_id: string
          reason: string | null
          risk_id: string
        }
        Insert: {
          created_at?: string
          dismissed_by?: string | null
          entity_id?: string | null
          id?: string
          is_active?: boolean
          organization_id: string
          reason?: string | null
          risk_id: string
        }
        Update: {
          created_at?: string
          dismissed_by?: string | null
          entity_id?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          reason?: string | null
          risk_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ceo_brief_dismissed_risks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ceo_brief_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          is_current: boolean
          model: string | null
          organization_id: string
          requested_by: string | null
          result_json: Json | null
          snapshot_text: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          is_current?: boolean
          model?: string | null
          organization_id: string
          requested_by?: string | null
          result_json?: Json | null
          snapshot_text?: string | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          is_current?: boolean
          model?: string | null
          organization_id?: string
          requested_by?: string | null
          result_json?: Json | null
          snapshot_text?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ceo_brief_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_chat_imports: {
        Row: {
          client_id: string
          created_at: string
          first_message_at: string | null
          group_kind: string
          id: string
          last_message_at: string | null
          message_count: number
          organization_id: string
          participant_count: number
          source_filename: string | null
          transcript: string
          uploaded_by: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          first_message_at?: string | null
          group_kind: string
          id?: string
          last_message_at?: string | null
          message_count?: number
          organization_id: string
          participant_count?: number
          source_filename?: string | null
          transcript?: string
          uploaded_by?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          first_message_at?: string | null
          group_kind?: string
          id?: string
          last_message_at?: string | null
          message_count?: number
          organization_id?: string
          participant_count?: number
          source_filename?: string | null
          transcript?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_chat_imports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_chat_imports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_delivery_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_chat_imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_satisfaction_analyses: {
        Row: {
          accountability: Json | null
          analyzed_by: string | null
          big_picture: Json | null
          brief_adherence: Json | null
          brief_adherence_score: number | null
          causes: Json | null
          client_group_signals: Json | null
          client_id: string
          client_import_id: string | null
          contract_context: Json | null
          created_at: string
          highlights: Json
          id: string
          indicators: Json | null
          is_current: boolean
          model: string | null
          organization_id: string
          recommendations: Json
          risks: Json
          satisfaction_score: number | null
          sentiment: string | null
          sentiment_timeline: Json
          summary: string | null
          team_context: Json | null
          technical_group_signals: Json | null
          technical_import_id: string | null
          window_end: string | null
          window_kind: string
          window_start: string | null
        }
        Insert: {
          accountability?: Json | null
          analyzed_by?: string | null
          big_picture?: Json | null
          brief_adherence?: Json | null
          brief_adherence_score?: number | null
          causes?: Json | null
          client_group_signals?: Json | null
          client_id: string
          client_import_id?: string | null
          contract_context?: Json | null
          created_at?: string
          highlights?: Json
          id?: string
          indicators?: Json | null
          is_current?: boolean
          model?: string | null
          organization_id: string
          recommendations?: Json
          risks?: Json
          satisfaction_score?: number | null
          sentiment?: string | null
          sentiment_timeline?: Json
          summary?: string | null
          team_context?: Json | null
          technical_group_signals?: Json | null
          technical_import_id?: string | null
          window_end?: string | null
          window_kind?: string
          window_start?: string | null
        }
        Update: {
          accountability?: Json | null
          analyzed_by?: string | null
          big_picture?: Json | null
          brief_adherence?: Json | null
          brief_adherence_score?: number | null
          causes?: Json | null
          client_group_signals?: Json | null
          client_id?: string
          client_import_id?: string | null
          contract_context?: Json | null
          created_at?: string
          highlights?: Json
          id?: string
          indicators?: Json | null
          is_current?: boolean
          model?: string | null
          organization_id?: string
          recommendations?: Json
          risks?: Json
          satisfaction_score?: number | null
          sentiment?: string | null
          sentiment_timeline?: Json
          summary?: string | null
          team_context?: Json | null
          technical_group_signals?: Json | null
          technical_import_id?: string | null
          window_end?: string | null
          window_kind?: string
          window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_satisfaction_analyses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_satisfaction_analyses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_delivery_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_satisfaction_analyses_client_import_id_fkey"
            columns: ["client_import_id"]
            isOneToOne: false
            referencedRelation: "client_chat_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_satisfaction_analyses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_satisfaction_analyses_technical_import_id_fkey"
            columns: ["technical_import_id"]
            isOneToOne: false
            referencedRelation: "client_chat_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          client_code: string | null
          company_website: string | null
          contact_name: string | null
          contract_seq: number
          created_at: string
          created_by: string | null
          email: string | null
          external_id: string | null
          external_source: string | null
          id: string
          merged_into_client_id: string | null
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          client_code?: string | null
          company_website?: string | null
          contact_name?: string | null
          contract_seq?: number
          created_at?: string
          created_by?: string | null
          email?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          merged_into_client_id?: string | null
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          client_code?: string | null
          company_website?: string | null
          contact_name?: string | null
          contract_seq?: number
          created_at?: string
          created_by?: string | null
          email?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          merged_into_client_id?: string | null
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
            foreignKeyName: "clients_merged_into_client_id_fkey"
            columns: ["merged_into_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_merged_into_client_id_fkey"
            columns: ["merged_into_client_id"]
            isOneToOne: false
            referencedRelation: "v_client_delivery_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_events: {
        Row: {
          actor_id: string | null
          contract_id: string
          created_at: string
          event_type: string
          id: string
          occurred_at: string
          organization_id: string
          payload: Json
        }
        Insert: {
          actor_id?: string | null
          contract_id: string
          created_at?: string
          event_type: string
          id?: string
          occurred_at?: string
          organization_id: string
          payload?: Json
        }
        Update: {
          actor_id?: string | null
          contract_id?: string
          created_at?: string
          event_type?: string
          id?: string
          occurred_at?: string
          organization_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "contract_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_events_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_packages: {
        Row: {
          contract_id: string
          created_at: string
          id: string
          package_id: string
          sort_order: number
        }
        Insert: {
          contract_id: string
          created_at?: string
          id?: string
          package_id: string
          sort_order?: number
        }
        Update: {
          contract_id?: string
          created_at?: string
          id?: string
          package_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "contract_packages_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_packages_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_sheet_logs: {
        Row: {
          account_manager: string | null
          client_external_id: string | null
          client_name: string | null
          contract_id: string | null
          contract_key: string
          created_at: string
          id: string
          log_time: string | null
          log_type: string
          notes: string | null
          organization_id: string
          snapshot: Json
        }
        Insert: {
          account_manager?: string | null
          client_external_id?: string | null
          client_name?: string | null
          contract_id?: string | null
          contract_key: string
          created_at?: string
          id?: string
          log_time?: string | null
          log_type: string
          notes?: string | null
          organization_id: string
          snapshot?: Json
        }
        Update: {
          account_manager?: string | null
          client_external_id?: string | null
          client_name?: string | null
          contract_id?: string | null
          contract_key?: string
          created_at?: string
          id?: string
          log_time?: string | null
          log_type?: string
          notes?: string | null
          organization_id?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "contract_sheet_logs_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_sheet_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_types: {
        Row: {
          created_at: string
          id: string
          key: string
          name_ar: string
          organization_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          name_ar: string
          organization_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          name_ar?: string
          organization_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "contract_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          account_manager_id: string | null
          account_manager_name: string | null
          actual_end_date: string | null
          client_id: string
          contract_code: string | null
          contract_status_label: string | null
          contract_type_id: string | null
          created_at: string
          delay_days: number | null
          duration_months: number | null
          end_date: string | null
          extension_days: number | null
          external_id: string | null
          external_source: string | null
          hold_end_date: string | null
          hold_started_at: string | null
          id: string
          last_hold_notification: string | null
          next_contract_value: number | null
          notes: string | null
          organization_id: string
          original_end_date: string | null
          package_id: string | null
          package_name: string | null
          paid_value: number
          payment_status: string | null
          previous_contract_id: string | null
          project_id: string | null
          renewal_paid_value: number | null
          renewed_status: string | null
          repeated_services_value: number | null
          sheet_client_name: string | null
          sheet_present: boolean
          start_date: string
          status: string
          target: string
          target_by_month: string | null
          total_days_computed: number | null
          total_value: number
          type_before_hold_id: string | null
          updated_at: string
        }
        Insert: {
          account_manager_id?: string | null
          account_manager_name?: string | null
          actual_end_date?: string | null
          client_id: string
          contract_code?: string | null
          contract_status_label?: string | null
          contract_type_id?: string | null
          created_at?: string
          delay_days?: number | null
          duration_months?: number | null
          end_date?: string | null
          extension_days?: number | null
          external_id?: string | null
          external_source?: string | null
          hold_end_date?: string | null
          hold_started_at?: string | null
          id?: string
          last_hold_notification?: string | null
          next_contract_value?: number | null
          notes?: string | null
          organization_id: string
          original_end_date?: string | null
          package_id?: string | null
          package_name?: string | null
          paid_value?: number
          payment_status?: string | null
          previous_contract_id?: string | null
          project_id?: string | null
          renewal_paid_value?: number | null
          renewed_status?: string | null
          repeated_services_value?: number | null
          sheet_client_name?: string | null
          sheet_present?: boolean
          start_date: string
          status?: string
          target?: string
          target_by_month?: string | null
          total_days_computed?: number | null
          total_value?: number
          type_before_hold_id?: string | null
          updated_at?: string
        }
        Update: {
          account_manager_id?: string | null
          account_manager_name?: string | null
          actual_end_date?: string | null
          client_id?: string
          contract_code?: string | null
          contract_status_label?: string | null
          contract_type_id?: string | null
          created_at?: string
          delay_days?: number | null
          duration_months?: number | null
          end_date?: string | null
          extension_days?: number | null
          external_id?: string | null
          external_source?: string | null
          hold_end_date?: string | null
          hold_started_at?: string | null
          id?: string
          last_hold_notification?: string | null
          next_contract_value?: number | null
          notes?: string | null
          organization_id?: string
          original_end_date?: string | null
          package_id?: string | null
          package_name?: string | null
          paid_value?: number
          payment_status?: string | null
          previous_contract_id?: string | null
          project_id?: string | null
          renewal_paid_value?: number | null
          renewed_status?: string | null
          repeated_services_value?: number | null
          sheet_client_name?: string | null
          sheet_present?: boolean
          start_date?: string
          status?: string
          target?: string
          target_by_month?: string | null
          total_days_computed?: number | null
          total_value?: number
          type_before_hold_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_account_manager_id_fkey"
            columns: ["account_manager_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_delivery_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "contracts_contract_type_id_fkey"
            columns: ["contract_type_id"]
            isOneToOne: false
            referencedRelation: "contract_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_previous_contract_id_fkey"
            columns: ["previous_contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "contracts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_type_before_hold_id_fkey"
            columns: ["type_before_hold_id"]
            isOneToOne: false
            referencedRelation: "contract_types"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_daily_snapshots: {
        Row: {
          created_at: string
          done_30d_count: number
          on_time_30d_count: number
          on_time_pct_30d: number | null
          open_count: number
          organization_id: string
          overdue_count: number
          snapshot_date: string
        }
        Insert: {
          created_at?: string
          done_30d_count?: number
          on_time_30d_count?: number
          on_time_pct_30d?: number | null
          open_count?: number
          organization_id: string
          overdue_count?: number
          snapshot_date: string
        }
        Update: {
          created_at?: string
          done_30d_count?: number
          on_time_30d_count?: number
          on_time_pct_30d?: number | null
          open_count?: number
          organization_id?: string
          overdue_count?: number
          snapshot_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_daily_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_rights: {
        Row: {
          created_at: string
          decision_key: string
          id: string
          organization_id: string
          owner_position: string
          scope_note: string | null
        }
        Insert: {
          created_at?: string
          decision_key: string
          id?: string
          organization_id: string
          owner_position: string
          scope_note?: string | null
        }
        Update: {
          created_at?: string
          decision_key?: string
          id?: string
          organization_id?: string
          owner_position?: string
          scope_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "decision_rights_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      department_targets: {
        Row: {
          created_at: string
          created_by: string | null
          department_id: string
          id: string
          month: string
          notes: string | null
          organization_id: string
          target_completed_tasks: number
          target_on_time_pct: number | null
          target_projects_delivered: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department_id: string
          id?: string
          month: string
          notes?: string | null
          organization_id: string
          target_completed_tasks?: number
          target_on_time_pct?: number | null
          target_projects_delivered?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department_id?: string
          id?: string
          month?: string
          notes?: string | null
          organization_id?: string
          target_completed_tasks?: number
          target_on_time_pct?: number | null
          target_projects_delivered?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_targets_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_targets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      department_team_leads: {
        Row: {
          added_at: string
          added_by: string | null
          department_id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          department_id: string
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          department_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_team_leads_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          description: string | null
          external_id: string | null
          external_source: string | null
          head_employee_id: string | null
          id: string
          kind: Database["public"]["Enums"]["department_kind"]
          name: string
          organization_id: string
          parent_department_id: string | null
          show_in_team_pulse: boolean
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          external_id?: string | null
          external_source?: string | null
          head_employee_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["department_kind"]
          name: string
          organization_id: string
          parent_department_id?: string | null
          show_in_team_pulse?: boolean
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          external_id?: string | null
          external_source?: string | null
          head_employee_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["department_kind"]
          name?: string
          organization_id?: string
          parent_department_id?: string | null
          show_in_team_pulse?: boolean
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
      direct_message_attachments: {
        Row: {
          created_at: string
          filename: string
          id: string
          message_id: string
          mimetype: string | null
          organization_id: string
          size_bytes: number | null
          storage_path: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          filename: string
          id?: string
          message_id: string
          mimetype?: string | null
          organization_id: string
          size_bytes?: number | null
          storage_path?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          filename?: string
          id?: string
          message_id?: string
          mimetype?: string | null
          organization_id?: string
          size_bytes?: number | null
          storage_path?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "direct_message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "direct_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_message_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_messages: {
        Row: {
          body: string | null
          context_project_id: string | null
          context_task_id: string | null
          created_at: string
          id: string
          organization_id: string
          read_at: string | null
          recipient_employee_id: string
          recipient_user_id: string | null
          sender_employee_id: string
          sender_user_id: string | null
        }
        Insert: {
          body?: string | null
          context_project_id?: string | null
          context_task_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          read_at?: string | null
          recipient_employee_id: string
          recipient_user_id?: string | null
          sender_employee_id: string
          sender_user_id?: string | null
        }
        Update: {
          body?: string | null
          context_project_id?: string | null
          context_task_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          read_at?: string | null
          recipient_employee_id?: string
          recipient_user_id?: string | null
          sender_employee_id?: string
          sender_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "direct_messages_context_project_id_fkey"
            columns: ["context_project_id"]
            isOneToOne: false
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "direct_messages_context_project_id_fkey"
            columns: ["context_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_context_task_id_fkey"
            columns: ["context_task_id"]
            isOneToOne: false
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "direct_messages_context_task_id_fkey"
            columns: ["context_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_context_task_id_fkey"
            columns: ["context_task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_context_task_id_fkey"
            columns: ["context_task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "direct_messages_context_task_id_fkey"
            columns: ["context_task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "direct_messages_context_task_id_fkey"
            columns: ["context_task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "direct_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_recipient_employee_id_fkey"
            columns: ["recipient_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_sender_employee_id_fkey"
            columns: ["sender_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_activity_daily: {
        Row: {
          actions_count: number
          activity_date: string
          activity_pct: number | null
          answered_episodes: number
          answered_within_sla: number
          computed_at: string
          confidence: string
          employee_id: string
          episodes_with_sla: number
          freshness: number | null
          open_owned: number
          organization_id: string
          owned_episodes: number
          responsiveness: number | null
          stale_open: number
          status: string
          throughput: number | null
        }
        Insert: {
          actions_count?: number
          activity_date: string
          activity_pct?: number | null
          answered_episodes?: number
          answered_within_sla?: number
          computed_at?: string
          confidence?: string
          employee_id: string
          episodes_with_sla?: number
          freshness?: number | null
          open_owned?: number
          organization_id: string
          owned_episodes?: number
          responsiveness?: number | null
          stale_open?: number
          status?: string
          throughput?: number | null
        }
        Update: {
          actions_count?: number
          activity_date?: string
          activity_pct?: number | null
          answered_episodes?: number
          answered_within_sla?: number
          computed_at?: string
          confidence?: string
          employee_id?: string
          episodes_with_sla?: number
          freshness?: number | null
          open_owned?: number
          organization_id?: string
          owned_episodes?: number
          responsiveness?: number | null
          stale_open?: number
          status?: string
          throughput?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_activity_daily_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_activity_daily_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_monthly_closing: {
        Row: {
          achievement_pct: number | null
          avg_completion_hours: number | null
          completed_projects: number
          completed_tasks: number
          created_at: string
          department_id: string | null
          designs_count: number
          employee_profile_id: string
          month: string
          on_time_pct: number | null
          organization_id: string
          overdue_tasks: number
          revision_count: number
          target_completed_tasks: number | null
        }
        Insert: {
          achievement_pct?: number | null
          avg_completion_hours?: number | null
          completed_projects?: number
          completed_tasks?: number
          created_at?: string
          department_id?: string | null
          designs_count?: number
          employee_profile_id: string
          month: string
          on_time_pct?: number | null
          organization_id: string
          overdue_tasks?: number
          revision_count?: number
          target_completed_tasks?: number | null
        }
        Update: {
          achievement_pct?: number | null
          avg_completion_hours?: number | null
          completed_projects?: number
          completed_tasks?: number
          created_at?: string
          department_id?: string | null
          designs_count?: number
          employee_profile_id?: string
          month?: string
          on_time_pct?: number | null
          organization_id?: string
          overdue_tasks?: number
          revision_count?: number
          target_completed_tasks?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_monthly_closing_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_monthly_closing_employee_profile_id_fkey"
            columns: ["employee_profile_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_monthly_closing_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          external_id: string | null
          external_source: string | null
          full_name: string
          id: string
          job_title: string | null
          manager_employee_id: string | null
          organization_id: string
          phone: string | null
          position: string | null
          position_id: string | null
          team_leader_employee_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          department_id?: string | null
          email?: string | null
          employment_status?: string
          external_id?: string | null
          external_source?: string | null
          full_name: string
          id?: string
          job_title?: string | null
          manager_employee_id?: string | null
          organization_id: string
          phone?: string | null
          position?: string | null
          position_id?: string | null
          team_leader_employee_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          department_id?: string | null
          email?: string | null
          employment_status?: string
          external_id?: string | null
          external_source?: string | null
          full_name?: string
          id?: string
          job_title?: string | null
          manager_employee_id?: string | null
          organization_id?: string
          phone?: string | null
          position?: string | null
          position_id?: string | null
          team_leader_employee_id?: string | null
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
          {
            foreignKeyName: "employee_profiles_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_profiles_team_leader_employee_id_fkey"
            columns: ["team_leader_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_targets: {
        Row: {
          created_at: string
          created_by: string | null
          employee_profile_id: string
          id: string
          month: string
          notes: string | null
          organization_id: string
          target_completed_tasks: number
          target_designs: number
          target_on_time_pct: number | null
          target_quality_max_revisions: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_profile_id: string
          id?: string
          month: string
          notes?: string | null
          organization_id: string
          target_completed_tasks?: number
          target_designs?: number
          target_on_time_pct?: number | null
          target_quality_max_revisions?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_profile_id?: string
          id?: string
          month?: string
          notes?: string | null
          organization_id?: string
          target_completed_tasks?: number
          target_designs?: number
          target_on_time_pct?: number | null
          target_quality_max_revisions?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_targets_employee_profile_id_fkey"
            columns: ["employee_profile_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_targets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_warnings: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          created_by: string | null
          detail: string | null
          employee_profile_id: string
          id: string
          issued_at: string
          issued_by: string | null
          organization_id: string
          reason: string
          related_task_id: string | null
          severity: Database["public"]["Enums"]["warning_severity"]
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          created_by?: string | null
          detail?: string | null
          employee_profile_id: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          organization_id: string
          reason: string
          related_task_id?: string | null
          severity?: Database["public"]["Enums"]["warning_severity"]
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          created_by?: string | null
          detail?: string | null
          employee_profile_id?: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          organization_id?: string
          reason?: string
          related_task_id?: string | null
          severity?: Database["public"]["Enums"]["warning_severity"]
        }
        Relationships: [
          {
            foreignKeyName: "employee_warnings_employee_profile_id_fkey"
            columns: ["employee_profile_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_warnings_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_warnings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_warnings_related_task_id_fkey"
            columns: ["related_task_id"]
            isOneToOne: false
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "employee_warnings_related_task_id_fkey"
            columns: ["related_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_warnings_related_task_id_fkey"
            columns: ["related_task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_warnings_related_task_id_fkey"
            columns: ["related_task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "employee_warnings_related_task_id_fkey"
            columns: ["related_task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "employee_warnings_related_task_id_fkey"
            columns: ["related_task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
        ]
      }
      entity_comment_attachments: {
        Row: {
          comment_id: string
          created_at: string
          filename: string
          id: string
          mimetype: string | null
          size_bytes: number | null
          storage_path: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          filename: string
          id?: string
          mimetype?: string | null
          size_bytes?: number | null
          storage_path: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          filename?: string
          id?: string
          mimetype?: string | null
          size_bytes?: number | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_comment_attachments_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "entity_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_comment_mentions: {
        Row: {
          comment_id: string
          created_at: string
          id: string
          mentioned_employee_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          id?: string
          mentioned_employee_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          id?: string
          mentioned_employee_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_comment_mentions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "entity_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_comment_mentions_mentioned_employee_id_fkey"
            columns: ["mentioned_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_comments: {
        Row: {
          author_user_id: string
          body: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          is_internal: boolean
          organization_id: string
          updated_at: string
        }
        Insert: {
          author_user_id: string
          body: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          is_internal?: boolean
          organization_id: string
          updated_at?: string
        }
        Update: {
          author_user_id?: string
          body?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          is_internal?: boolean
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      escalation_paths: {
        Row: {
          created_at: string
          from_position: string
          id: string
          kind: string
          organization_id: string
          sla_minutes: number | null
          to_position: string
        }
        Insert: {
          created_at?: string
          from_position: string
          id?: string
          kind: string
          organization_id: string
          sla_minutes?: number | null
          to_position: string
        }
        Update: {
          created_at?: string
          from_position?: string
          id?: string
          kind?: string
          organization_id?: string
          sla_minutes?: number | null
          to_position?: string
        }
        Relationships: [
          {
            foreignKeyName: "escalation_paths_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      escalations: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          exception_id: string | null
          id: string
          level: number
          organization_id: string
          raised_at: string
          raised_to_user_id: string | null
          status: string
          task_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          exception_id?: string | null
          id?: string
          level?: number
          organization_id: string
          raised_at?: string
          raised_to_user_id?: string | null
          status?: string
          task_id: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          exception_id?: string | null
          id?: string
          level?: number
          organization_id?: string
          raised_at?: string
          raised_to_user_id?: string | null
          status?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "escalations_exception_id_fkey"
            columns: ["exception_id"]
            isOneToOne: false
            referencedRelation: "exceptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "escalations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "escalations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "escalations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
        ]
      }
      exceptions: {
        Row: {
          id: string
          kind: string
          opened_at: string
          opened_by: string | null
          organization_id: string
          reason: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          stage_entered_at: string | null
          task_id: string
        }
        Insert: {
          id?: string
          kind: string
          opened_at?: string
          opened_by?: string | null
          organization_id: string
          reason: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          stage_entered_at?: string | null
          task_id: string
        }
        Update: {
          id?: string
          kind?: string
          opened_at?: string
          opened_by?: string | null
          organization_id?: string
          reason?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          stage_entered_at?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exceptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "exceptions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "exceptions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "exceptions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string
          created_by: string | null
          description: string | null
          expense_date: string
          id: string
          organization_id: string
          project_id: string | null
          updated_at: string
          vendor: string | null
        }
        Insert: {
          amount: number
          category: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          expense_date: string
          id?: string
          organization_id: string
          project_id?: string | null
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          amount?: number
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          organization_id?: string
          project_id?: string | null
          updated_at?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "expenses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          description: string | null
          enabled: boolean
          key: string
          rollout_roles: string[]
          updated_at: string
        }
        Insert: {
          description?: string | null
          enabled?: boolean
          key: string
          rollout_roles?: string[]
          updated_at?: string
        }
        Update: {
          description?: string | null
          enabled?: boolean
          key?: string
          rollout_roles?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      governance_violations: {
        Row: {
          detected_at: string
          id: string
          kind: string
          note: string | null
          organization_id: string
          project_id: string | null
          resolved_at: string | null
          resolver_user_id: string | null
          task_id: string | null
        }
        Insert: {
          detected_at?: string
          id?: string
          kind: string
          note?: string | null
          organization_id: string
          project_id?: string | null
          resolved_at?: string | null
          resolver_user_id?: string | null
          task_id?: string | null
        }
        Update: {
          detected_at?: string
          id?: string
          kind?: string
          note?: string | null
          organization_id?: string
          project_id?: string | null
          resolved_at?: string | null
          resolver_user_id?: string | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "governance_violations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_violations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "governance_violations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_violations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "governance_violations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_violations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_violations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "governance_violations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "governance_violations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
        ]
      }
      holidays: {
        Row: {
          created_at: string
          created_by: string | null
          holiday_date: string
          id: string
          name: string
          organization_id: string
          recurring: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          holiday_date: string
          id?: string
          name: string
          organization_id: string
          recurring?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          holiday_date?: string
          id?: string
          name?: string
          organization_id?: string
          recurring?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "holidays_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      installments: {
        Row: {
          actual_amount: number | null
          actual_date: string | null
          contract_id: string
          created_at: string
          expected_amount: number
          expected_date: string
          id: string
          lost_date: string | null
          organization_id: string
          sequence: number
          source_type_key: string | null
          status: string
          updated_at: string
        }
        Insert: {
          actual_amount?: number | null
          actual_date?: string | null
          contract_id: string
          created_at?: string
          expected_amount?: number
          expected_date: string
          id?: string
          lost_date?: string | null
          organization_id: string
          sequence: number
          source_type_key?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          actual_amount?: number | null
          actual_date?: string | null
          contract_id?: string
          created_at?: string
          expected_amount?: number
          expected_date?: string
          id?: string
          lost_date?: string | null
          organization_id?: string
          sequence?: number
          source_type_key?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "installments_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_settings: {
        Row: {
          organization_id: string
          setting_key: string
          setting_value: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          organization_id: string
          setting_key: string
          setting_value: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          organization_id?: string
          setting_key?: string
          setting_value?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kpi_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_to_employee_id: string | null
          contact_name: string | null
          converted_client_id: string | null
          created_at: string
          created_by: string | null
          email: string | null
          estimated_value: number
          id: string
          name: string
          next_step_at: string | null
          notes: string | null
          organization_id: string
          phone: string | null
          source: string | null
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
        }
        Insert: {
          assigned_to_employee_id?: string | null
          contact_name?: string | null
          converted_client_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          estimated_value?: number
          id?: string
          name: string
          next_step_at?: string | null
          notes?: string | null
          organization_id: string
          phone?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
        }
        Update: {
          assigned_to_employee_id?: string | null
          contact_name?: string | null
          converted_client_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          estimated_value?: number
          id?: string
          name?: string
          next_step_at?: string | null
          notes?: string | null
          organization_id?: string
          phone?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_employee_id_fkey"
            columns: ["assigned_to_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_converted_client_id_fkey"
            columns: ["converted_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_converted_client_id_fkey"
            columns: ["converted_client_id"]
            isOneToOne: false
            referencedRelation: "v_client_delivery_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leaves: {
        Row: {
          created_at: string
          created_by: string | null
          days: number
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          employee_profile_id: string | null
          employee_user_id: string
          end_date: string
          id: string
          leave_type: Database["public"]["Enums"]["leave_type"]
          organization_id: string
          reason: string | null
          start_date: string
          status: Database["public"]["Enums"]["leave_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          days: number
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          employee_profile_id?: string | null
          employee_user_id: string
          end_date: string
          id?: string
          leave_type?: Database["public"]["Enums"]["leave_type"]
          organization_id: string
          reason?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["leave_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          days?: number
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          employee_profile_id?: string | null
          employee_user_id?: string
          end_date?: string
          id?: string
          leave_type?: Database["public"]["Enums"]["leave_type"]
          organization_id?: string
          reason?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["leave_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leaves_employee_profile_id_fkey"
            columns: ["employee_profile_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leaves_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_cycles: {
        Row: {
          actual_cycle_add_date: string | null
          actual_meeting_date: string | null
          contract_id: string
          created_at: string
          cycle_no: number
          expected_cycle_add_date: string | null
          expected_meeting_date: string | null
          grace_days: number
          id: string
          meeting_delay_days: number | null
          meeting_status: string | null
          month: string
          organization_id: string
          start_date: string | null
          state: string
          updated_at: string
        }
        Insert: {
          actual_cycle_add_date?: string | null
          actual_meeting_date?: string | null
          contract_id: string
          created_at?: string
          cycle_no: number
          expected_cycle_add_date?: string | null
          expected_meeting_date?: string | null
          grace_days?: number
          id?: string
          meeting_delay_days?: number | null
          meeting_status?: string | null
          month: string
          organization_id: string
          start_date?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          actual_cycle_add_date?: string | null
          actual_meeting_date?: string | null
          contract_id?: string
          created_at?: string
          cycle_no?: number
          expected_cycle_add_date?: string | null
          expected_meeting_date?: string | null
          grace_days?: number
          id?: string
          meeting_delay_days?: number | null
          meeting_status?: string | null
          month?: string
          organization_id?: string
          start_date?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_cycles_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_cycles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_dashboard_totals: {
        Row: {
          acc_achievement_pct: number
          acc_act_inst: number
          acc_act_ontarget: number
          acc_act_overdue_clients: number
          acc_act_sd_renewed: number
          acc_actual: number
          acc_exp_inst: number
          acc_exp_ontarget: number
          acc_exp_overdue_clients: number
          acc_exp_overdue_inst: number
          acc_expected: number
          acc_gap: number
          acc_upsell: number
          acc_winback: number
          achievement_pct: number
          actual_installments: number
          actual_renewals: number
          cnt_on_target: number
          cnt_overdue: number
          cnt_roster_hold: number
          cnt_roster_new: number
          cnt_roster_renew: number
          cnt_roster_upsell: number
          cnt_roster_winback: number
          cnt_sales_deposit: number
          cnt_total_clients: number
          created_at: string
          expected_installments: number
          expected_renewals: number
          frozen_at: string | null
          id: string
          is_frozen: boolean
          month: string
          mov_closed: number
          mov_hold: number
          mov_lost: number
          mov_new: number
          mov_renewed: number
          mov_upsell: number
          mov_winback: number
          organization_id: string
          sales_achievement_pct: number
          sales_act_inst: number
          sales_exp_inst: number
          sales_exp_overdue_inst: number
          sales_expected: number
          sales_gap: number
          sales_new_income: number
          sales_total_income: number
          sales_upsell: number
          source: string
          total_actual: number
          total_expected: number
          updated_at: string
        }
        Insert: {
          acc_achievement_pct?: number
          acc_act_inst?: number
          acc_act_ontarget?: number
          acc_act_overdue_clients?: number
          acc_act_sd_renewed?: number
          acc_actual?: number
          acc_exp_inst?: number
          acc_exp_ontarget?: number
          acc_exp_overdue_clients?: number
          acc_exp_overdue_inst?: number
          acc_expected?: number
          acc_gap?: number
          acc_upsell?: number
          acc_winback?: number
          achievement_pct?: number
          actual_installments?: number
          actual_renewals?: number
          cnt_on_target?: number
          cnt_overdue?: number
          cnt_roster_hold?: number
          cnt_roster_new?: number
          cnt_roster_renew?: number
          cnt_roster_upsell?: number
          cnt_roster_winback?: number
          cnt_sales_deposit?: number
          cnt_total_clients?: number
          created_at?: string
          expected_installments?: number
          expected_renewals?: number
          frozen_at?: string | null
          id?: string
          is_frozen?: boolean
          month: string
          mov_closed?: number
          mov_hold?: number
          mov_lost?: number
          mov_new?: number
          mov_renewed?: number
          mov_upsell?: number
          mov_winback?: number
          organization_id: string
          sales_achievement_pct?: number
          sales_act_inst?: number
          sales_exp_inst?: number
          sales_exp_overdue_inst?: number
          sales_expected?: number
          sales_gap?: number
          sales_new_income?: number
          sales_total_income?: number
          sales_upsell?: number
          source?: string
          total_actual?: number
          total_expected?: number
          updated_at?: string
        }
        Update: {
          acc_achievement_pct?: number
          acc_act_inst?: number
          acc_act_ontarget?: number
          acc_act_overdue_clients?: number
          acc_act_sd_renewed?: number
          acc_actual?: number
          acc_exp_inst?: number
          acc_exp_ontarget?: number
          acc_exp_overdue_clients?: number
          acc_exp_overdue_inst?: number
          acc_expected?: number
          acc_gap?: number
          acc_upsell?: number
          acc_winback?: number
          achievement_pct?: number
          actual_installments?: number
          actual_renewals?: number
          cnt_on_target?: number
          cnt_overdue?: number
          cnt_roster_hold?: number
          cnt_roster_new?: number
          cnt_roster_renew?: number
          cnt_roster_upsell?: number
          cnt_roster_winback?: number
          cnt_sales_deposit?: number
          cnt_total_clients?: number
          created_at?: string
          expected_installments?: number
          expected_renewals?: number
          frozen_at?: string | null
          id?: string
          is_frozen?: boolean
          month?: string
          mov_closed?: number
          mov_hold?: number
          mov_lost?: number
          mov_new?: number
          mov_renewed?: number
          mov_upsell?: number
          mov_winback?: number
          organization_id?: string
          sales_achievement_pct?: number
          sales_act_inst?: number
          sales_exp_inst?: number
          sales_exp_overdue_inst?: number
          sales_expected?: number
          sales_gap?: number
          sales_new_income?: number
          sales_total_income?: number
          sales_upsell?: number
          source?: string
          total_actual?: number
          total_expected?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_dashboard_totals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_target_snapshot: {
        Row: {
          account_manager_name: string | null
          bucket: string
          client_code: string | null
          client_name: string | null
          contract_id: string
          end_date_at_freeze: string | null
          frozen_at: string
          month: string
          organization_id: string
          renewed_status_at_freeze: string | null
          status_at_freeze: string | null
          value: number
        }
        Insert: {
          account_manager_name?: string | null
          bucket: string
          client_code?: string | null
          client_name?: string | null
          contract_id: string
          end_date_at_freeze?: string | null
          frozen_at?: string
          month: string
          organization_id: string
          renewed_status_at_freeze?: string | null
          status_at_freeze?: string | null
          value?: number
        }
        Update: {
          account_manager_name?: string | null
          bucket?: string
          client_code?: string | null
          client_name?: string | null
          contract_id?: string
          end_date_at_freeze?: string | null
          frozen_at?: string
          month?: string
          organization_id?: string
          renewed_status_at_freeze?: string | null
          status_at_freeze?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "monthly_target_snapshot_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_target_snapshot_organization_id_fkey"
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
      org_client_counters: {
        Row: {
          last_seq: number
          organization_id: string
        }
        Insert: {
          last_seq?: number
          organization_id: string
        }
        Update: {
          last_seq?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_client_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_project_counters: {
        Row: {
          last_seq: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          last_seq?: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          last_seq?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_project_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          ai_knowledge_updated_at: string
          contracts_synced_at: string | null
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
          ai_knowledge_updated_at?: string
          contracts_synced_at?: string | null
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
          ai_knowledge_updated_at?: string
          contracts_synced_at?: string | null
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
      ownership_episodes: {
        Row: {
          answered_at: string | null
          answered_by_employee_id: string | null
          answered_kind: string | null
          closed_at: string | null
          created_at: string
          external_origin: boolean
          id: string
          opened_at: string
          organization_id: string
          owner_employee_id: string | null
          owner_role: string | null
          response_minutes: number | null
          sla_minutes: number | null
          source: string
          stage: Database["public"]["Enums"]["task_stage"]
          task_id: string
          within_sla: boolean | null
        }
        Insert: {
          answered_at?: string | null
          answered_by_employee_id?: string | null
          answered_kind?: string | null
          closed_at?: string | null
          created_at?: string
          external_origin?: boolean
          id?: string
          opened_at: string
          organization_id: string
          owner_employee_id?: string | null
          owner_role?: string | null
          response_minutes?: number | null
          sla_minutes?: number | null
          source?: string
          stage: Database["public"]["Enums"]["task_stage"]
          task_id: string
          within_sla?: boolean | null
        }
        Update: {
          answered_at?: string | null
          answered_by_employee_id?: string | null
          answered_kind?: string | null
          closed_at?: string | null
          created_at?: string
          external_origin?: boolean
          id?: string
          opened_at?: string
          organization_id?: string
          owner_employee_id?: string | null
          owner_role?: string | null
          response_minutes?: number | null
          sla_minutes?: number | null
          source?: string
          stage?: Database["public"]["Enums"]["task_stage"]
          task_id?: string
          within_sla?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "ownership_episodes_answered_by_employee_id_fkey"
            columns: ["answered_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ownership_episodes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ownership_episodes_owner_employee_id_fkey"
            columns: ["owner_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ownership_episodes_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "ownership_episodes_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ownership_episodes_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ownership_episodes_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "ownership_episodes_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "ownership_episodes_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
        ]
      }
      packages: {
        Row: {
          active: boolean
          created_at: string
          extra_days: number
          grace_days: number
          id: string
          included_service_ids: string[]
          is_renewable: boolean | null
          key: string
          name_ar: string
          organization_id: string
          price_type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          extra_days?: number
          grace_days?: number
          id?: string
          included_service_ids?: string[]
          is_renewable?: boolean | null
          key: string
          name_ar: string
          organization_id: string
          price_type?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          extra_days?: number
          grace_days?: number
          id?: string
          included_service_ids?: string[]
          is_renewable?: boolean | null
          key?: string
          name_ar?: string
          organization_id?: string
          price_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_snapshots: {
        Row: {
          actions_count: number
          avg_dwell: number | null
          completed_count: number
          grain: string
          on_time_pct: number | null
          organization_id: string
          period_end: string
          period_start: string
          refreshed_at: string
          rework_count: number
          sample_size: number
          scope_id: string
          scope_type: string
          sla_n: number
          sla_ok: number
        }
        Insert: {
          actions_count?: number
          avg_dwell?: number | null
          completed_count?: number
          grain: string
          on_time_pct?: number | null
          organization_id: string
          period_end: string
          period_start: string
          refreshed_at?: string
          rework_count?: number
          sample_size?: number
          scope_id: string
          scope_type: string
          sla_n?: number
          sla_ok?: number
        }
        Update: {
          actions_count?: number
          avg_dwell?: number | null
          completed_count?: number
          grain?: string
          on_time_pct?: number | null
          organization_id?: string
          period_end?: string
          period_start?: string
          refreshed_at?: string
          rework_count?: number
          sample_size?: number
          scope_id?: string
          scope_type?: string
          sla_n?: number
          sla_ok?: number
        }
        Relationships: [
          {
            foreignKeyName: "performance_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      personal_events: {
        Row: {
          color: number
          created_at: string
          event_date: string
          event_time: string | null
          id: string
          note: string | null
          organization_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: number
          created_at?: string
          event_date: string
          event_time?: string | null
          id?: string
          note?: string | null
          organization_id: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: number
          created_at?: string
          event_date?: string
          event_time?: string | null
          id?: string
          note?: string | null
          organization_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personal_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      positions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_system: boolean
          name: string
          organization_id: string
          role: string
          slug: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_system?: boolean
          name: string
          organization_id: string
          role: string
          slug: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_system?: boolean
          name?: string
          organization_id?: string
          role?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "positions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_attachments: {
        Row: {
          created_at: string
          external_id: string | null
          external_source: string | null
          filename: string
          id: string
          mimetype: string | null
          organization_id: string
          project_comment_id: string | null
          project_id: string
          size_bytes: number | null
          source_url: string | null
          storage_path: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          external_source?: string | null
          filename: string
          id?: string
          mimetype?: string | null
          organization_id: string
          project_comment_id?: string | null
          project_id: string
          size_bytes?: number | null
          source_url?: string | null
          storage_path?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          external_id?: string | null
          external_source?: string | null
          filename?: string
          id?: string
          mimetype?: string | null
          organization_id?: string
          project_comment_id?: string | null
          project_id?: string
          size_bytes?: number | null
          source_url?: string | null
          storage_path?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_attachments_project_comment_id_fkey"
            columns: ["project_comment_id"]
            isOneToOne: false
            referencedRelation: "project_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_attachments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_attachments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_comments: {
        Row: {
          author_user_id: string | null
          body: string
          created_at: string
          external_author_avatar_url: string | null
          external_author_name: string | null
          external_id: string | null
          external_source: string | null
          id: string
          is_internal: boolean
          kind: string
          organization_id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          author_user_id?: string | null
          body: string
          created_at?: string
          external_author_avatar_url?: string | null
          external_author_name?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_internal?: boolean
          kind?: string
          organization_id: string
          project_id: string
          updated_at?: string
        }
        Update: {
          author_user_id?: string | null
          body?: string
          created_at?: string
          external_author_avatar_url?: string | null
          external_author_name?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_internal?: boolean
          kind?: string
          organization_id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_followers: {
        Row: {
          added_at: string
          added_by: string | null
          employee_id: string
          external_id: string | null
          external_source: string | null
          organization_id: string
          project_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          employee_id: string
          external_id?: string | null
          external_source?: string | null
          organization_id: string
          project_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          employee_id?: string
          external_id?: string | null
          external_source?: string | null
          organization_id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_followers_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_followers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_followers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_followers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_holidays: {
        Row: {
          created_at: string
          created_by: string | null
          holiday_date: string
          id: string
          name: string
          organization_id: string
          project_id: string
          recurring: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          holiday_date: string
          id?: string
          name: string
          organization_id: string
          project_id: string
          recurring?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          holiday_date?: string
          id?: string
          name?: string
          organization_id?: string
          project_id?: string
          recurring?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "project_holidays_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_holidays_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_holidays_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_log_notes: {
        Row: {
          author_user_id: string
          body: string
          created_at: string
          id: string
          organization_id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          author_user_id: string
          body: string
          created_at?: string
          id?: string
          organization_id: string
          project_id: string
          updated_at?: string
        }
        Update: {
          author_user_id?: string
          body?: string
          created_at?: string
          id?: string
          organization_id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_log_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_log_notes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_log_notes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
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
      project_service_tag_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          project_service_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          project_service_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          project_service_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_service_tag_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_service_tag_assignments_project_service_id_fkey"
            columns: ["project_service_id"]
            isOneToOne: false
            referencedRelation: "project_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_service_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "project_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      project_service_team: {
        Row: {
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          is_extra: boolean
          organization_id: string
          position_id: string
          project_id: string
          service_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          is_extra?: boolean
          organization_id: string
          position_id: string
          project_id: string
          service_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          is_extra?: boolean
          organization_id?: string
          position_id?: string
          project_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_service_team_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_service_team_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_service_team_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_service_team_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_service_team_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_service_team_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      project_services: {
        Row: {
          category_id: string | null
          created_at: string
          id: string
          organization_id: string
          project_id: string
          service_id: string
          status: string
          week_split: boolean
          weeks: number | null
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          project_id: string
          service_id: string
          status?: string
          week_split?: boolean
          weeks?: number | null
        }
        Update: {
          category_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          project_id?: string
          service_id?: string
          status?: string
          week_split?: boolean
          weeks?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_services_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
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
      project_tag_assignments: {
        Row: {
          created_at: string
          organization_id: string
          project_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          project_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          project_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_tag_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tag_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_tag_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "project_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      project_tags: {
        Row: {
          color: number
          created_at: string
          external_id: string | null
          external_source: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          color?: number
          created_at?: string
          external_id?: string | null
          external_source?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          color?: number
          created_at?: string
          external_id?: string | null
          external_source?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          account_manager_employee_id: string | null
          client_id: string
          color: number
          created_at: string
          created_by: string | null
          cycle_length_months: number | null
          description: string | null
          document_count: number
          duration_label: string | null
          end_date: string | null
          external_id: string | null
          external_source: string | null
          financial_info: string | null
          gantt_prefs: Json
          has_active_category: boolean
          held_at: string | null
          hold_reason: string | null
          id: string
          is_favorite: boolean
          last_update_color: number | null
          last_update_status: string | null
          media_manager_id: string | null
          media_specialist_id: string | null
          name: string
          next_renewal_date: string | null
          odoo_closed_task_count: number | null
          odoo_open_task_count: number | null
          odoo_task_count: number | null
          organization_id: string
          package_name: string | null
          priority: string
          project_code: string | null
          project_manager_employee_id: string | null
          seo_manager_id: string | null
          seo_specialist_id: string | null
          sequence: number
          site_address: string | null
          site_address_display: string | null
          site_latitude: number | null
          site_longitude: number | null
          social_manager_id: string | null
          social_specialist_id: string | null
          start_date: string | null
          status: string
          store_name: string | null
          target: string | null
          task_seq: number
          total_progress: number
          updated_at: string
        }
        Insert: {
          account_manager_employee_id?: string | null
          client_id: string
          color?: number
          created_at?: string
          created_by?: string | null
          cycle_length_months?: number | null
          description?: string | null
          document_count?: number
          duration_label?: string | null
          end_date?: string | null
          external_id?: string | null
          external_source?: string | null
          financial_info?: string | null
          gantt_prefs?: Json
          has_active_category?: boolean
          held_at?: string | null
          hold_reason?: string | null
          id?: string
          is_favorite?: boolean
          last_update_color?: number | null
          last_update_status?: string | null
          media_manager_id?: string | null
          media_specialist_id?: string | null
          name: string
          next_renewal_date?: string | null
          odoo_closed_task_count?: number | null
          odoo_open_task_count?: number | null
          odoo_task_count?: number | null
          organization_id: string
          package_name?: string | null
          priority?: string
          project_code?: string | null
          project_manager_employee_id?: string | null
          seo_manager_id?: string | null
          seo_specialist_id?: string | null
          sequence?: number
          site_address?: string | null
          site_address_display?: string | null
          site_latitude?: number | null
          site_longitude?: number | null
          social_manager_id?: string | null
          social_specialist_id?: string | null
          start_date?: string | null
          status?: string
          store_name?: string | null
          target?: string | null
          task_seq?: number
          total_progress?: number
          updated_at?: string
        }
        Update: {
          account_manager_employee_id?: string | null
          client_id?: string
          color?: number
          created_at?: string
          created_by?: string | null
          cycle_length_months?: number | null
          description?: string | null
          document_count?: number
          duration_label?: string | null
          end_date?: string | null
          external_id?: string | null
          external_source?: string | null
          financial_info?: string | null
          gantt_prefs?: Json
          has_active_category?: boolean
          held_at?: string | null
          hold_reason?: string | null
          id?: string
          is_favorite?: boolean
          last_update_color?: number | null
          last_update_status?: string | null
          media_manager_id?: string | null
          media_specialist_id?: string | null
          name?: string
          next_renewal_date?: string | null
          odoo_closed_task_count?: number | null
          odoo_open_task_count?: number | null
          odoo_task_count?: number | null
          organization_id?: string
          package_name?: string | null
          priority?: string
          project_code?: string | null
          project_manager_employee_id?: string | null
          seo_manager_id?: string | null
          seo_specialist_id?: string | null
          sequence?: number
          site_address?: string | null
          site_address_display?: string | null
          site_latitude?: number | null
          site_longitude?: number | null
          social_manager_id?: string | null
          social_specialist_id?: string | null
          start_date?: string | null
          status?: string
          store_name?: string | null
          target?: string | null
          task_seq?: number
          total_progress?: number
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
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_delivery_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "projects_media_manager_id_fkey"
            columns: ["media_manager_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_media_specialist_id_fkey"
            columns: ["media_specialist_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_project_manager_employee_id_fkey"
            columns: ["project_manager_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_seo_manager_id_fkey"
            columns: ["seo_manager_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_seo_specialist_id_fkey"
            columns: ["seo_specialist_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_social_manager_id_fkey"
            columns: ["social_manager_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_social_specialist_id_fkey"
            columns: ["social_specialist_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      renewal_cycles: {
        Row: {
          created_at: string
          cycle_no: number
          ended_at: string | null
          id: string
          project_id: string
          started_at: string
          status: string
        }
        Insert: {
          created_at?: string
          cycle_no: number
          ended_at?: string | null
          id?: string
          project_id: string
          started_at: string
          status?: string
        }
        Update: {
          created_at?: string
          cycle_no?: number
          ended_at?: string | null
          id?: string
          project_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "renewal_cycles_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "renewal_cycles_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
            foreignKeyName: "sales_handover_forms_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_delivery_health"
            referencedColumns: ["client_id"]
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
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
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
      service_categories: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          external_id: string | null
          external_source: string | null
          id: string
          is_active: boolean
          key: string
          name_ar: string
          name_en: string | null
          organization_id: string
          service_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          key: string
          name_ar: string
          name_en?: string | null
          organization_id: string
          service_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          key?: string
          name_ar?: string
          name_en?: string | null
          organization_id?: string
          service_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_categories_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
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
          external_id: string | null
          external_source: string | null
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
          external_id?: string | null
          external_source?: string | null
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
          external_id?: string | null
          external_source?: string | null
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
      services_catalog: {
        Row: {
          active: boolean
          created_at: string
          extra_days: number
          id: string
          key: string
          name_ar: string
          name_en: string | null
          organization_id: string
          price: number
          price_type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          extra_days?: number
          id?: string
          key: string
          name_ar: string
          name_en?: string | null
          organization_id: string
          price?: number
          price_type?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          extra_days?: number
          id?: string
          key?: string
          name_ar?: string
          name_en?: string | null
          organization_id?: string
          price?: number
          price_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_catalog_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sla_rules: {
        Row: {
          business_hours_only: boolean
          created_at: string
          id: string
          max_minutes: number
          organization_id: string
          severity: string
          stage_key: string
        }
        Insert: {
          business_hours_only?: boolean
          created_at?: string
          id?: string
          max_minutes: number
          organization_id: string
          severity?: string
          stage_key: string
        }
        Update: {
          business_hours_only?: boolean
          created_at?: string
          id?: string
          max_minutes?: number
          organization_id?: string
          severity?: string
          stage_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "sla_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_watermarks: {
        Row: {
          entity_type: string
          last_message_id: number | null
          last_write_date: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          entity_type: string
          last_message_id?: number | null
          last_write_date?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          entity_type?: string
          last_message_id?: number | null
          last_write_date?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_watermarks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      task_activities: {
        Row: {
          activity_type: Database["public"]["Enums"]["task_activity_type"]
          assignee_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          last_due_notification: string | null
          organization_id: string
          summary: string
          task_id: string
          updated_at: string
        }
        Insert: {
          activity_type?: Database["public"]["Enums"]["task_activity_type"]
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          last_due_notification?: string | null
          organization_id: string
          summary: string
          task_id: string
          updated_at?: string
        }
        Update: {
          activity_type?: Database["public"]["Enums"]["task_activity_type"]
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          last_due_notification?: string | null
          organization_id?: string
          summary?: string
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_activities_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activities_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_activities_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activities_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activities_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_activities_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_activities_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
        ]
      }
      task_approval_history: {
        Row: {
          action: string
          actor_employee_id: string | null
          actor_user_id: string | null
          created_at: string
          id: string
          notes: string | null
          organization_id: string
          stage: Database["public"]["Enums"]["task_stage"]
          task_id: string
        }
        Insert: {
          action: string
          actor_employee_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          organization_id: string
          stage: Database["public"]["Enums"]["task_stage"]
          task_id: string
        }
        Update: {
          action?: string
          actor_employee_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          stage?: Database["public"]["Enums"]["task_stage"]
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_approval_history_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_approval_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_approval_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_approval_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_approval_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_approval_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_approval_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_approval_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
        ]
      }
      task_assignees: {
        Row: {
          assigned_by: string | null
          created_at: string
          employee_id: string
          head_of_dept_employee_id: string | null
          id: string
          organization_id: string
          role_type: Database["public"]["Enums"]["task_role_type"]
          task_id: string
          team_manager_employee_id: string | null
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          employee_id: string
          head_of_dept_employee_id?: string | null
          id?: string
          organization_id: string
          role_type: Database["public"]["Enums"]["task_role_type"]
          task_id: string
          team_manager_employee_id?: string | null
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          employee_id?: string
          head_of_dept_employee_id?: string | null
          id?: string
          organization_id?: string
          role_type?: Database["public"]["Enums"]["task_role_type"]
          task_id?: string
          team_manager_employee_id?: string | null
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
            foreignKeyName: "task_assignees_head_of_dept_employee_id_fkey"
            columns: ["head_of_dept_employee_id"]
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
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
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
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_assignees_team_manager_employee_id_fkey"
            columns: ["team_manager_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_attachments: {
        Row: {
          created_at: string
          external_id: string | null
          external_source: string | null
          filename: string
          id: string
          mimetype: string | null
          organization_id: string
          size_bytes: number | null
          source_url: string | null
          storage_path: string | null
          task_comment_id: string | null
          task_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          external_source?: string | null
          filename: string
          id?: string
          mimetype?: string | null
          organization_id: string
          size_bytes?: number | null
          source_url?: string | null
          storage_path?: string | null
          task_comment_id?: string | null
          task_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          external_id?: string | null
          external_source?: string | null
          filename?: string
          id?: string
          mimetype?: string | null
          organization_id?: string
          size_bytes?: number | null
          source_url?: string | null
          storage_path?: string | null
          task_comment_id?: string | null
          task_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_task_comment_id_fkey"
            columns: ["task_comment_id"]
            isOneToOne: false
            referencedRelation: "task_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
        ]
      }
      task_comments: {
        Row: {
          action_kind: string | null
          actor_employee_id: string | null
          author_user_id: string | null
          body: string
          created_at: string
          external_author_avatar_url: string | null
          external_author_name: string | null
          external_id: string | null
          external_source: string | null
          id: string
          is_internal: boolean
          kind: Database["public"]["Enums"]["task_comment_kind"]
          organization_id: string
          task_id: string
          updated_at: string
        }
        Insert: {
          action_kind?: string | null
          actor_employee_id?: string | null
          author_user_id?: string | null
          body: string
          created_at?: string
          external_author_avatar_url?: string | null
          external_author_name?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_internal?: boolean
          kind?: Database["public"]["Enums"]["task_comment_kind"]
          organization_id: string
          task_id: string
          updated_at?: string
        }
        Update: {
          action_kind?: string | null
          actor_employee_id?: string | null
          author_user_id?: string | null
          body?: string
          created_at?: string
          external_author_avatar_url?: string | null
          external_author_name?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_internal?: boolean
          kind?: Database["public"]["Enums"]["task_comment_kind"]
          organization_id?: string
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
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
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
        ]
      }
      task_delegations: {
        Row: {
          assigned_executor_at: string | null
          brief: string | null
          closed_at: string | null
          created_at: string
          delegated_at: string
          delegatee_employee_id: string
          delegator_employee_id: string
          executor_employee_id: string | null
          id: string
          organization_id: string
          returned_at: string | null
          status: string
          task_id: string
          updated_at: string
        }
        Insert: {
          assigned_executor_at?: string | null
          brief?: string | null
          closed_at?: string | null
          created_at?: string
          delegated_at?: string
          delegatee_employee_id: string
          delegator_employee_id: string
          executor_employee_id?: string | null
          id?: string
          organization_id: string
          returned_at?: string | null
          status?: string
          task_id: string
          updated_at?: string
        }
        Update: {
          assigned_executor_at?: string | null
          brief?: string | null
          closed_at?: string | null
          created_at?: string
          delegated_at?: string
          delegatee_employee_id?: string
          delegator_employee_id?: string
          executor_employee_id?: string | null
          id?: string
          organization_id?: string
          returned_at?: string | null
          status?: string
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_delegations_delegatee_employee_id_fkey"
            columns: ["delegatee_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_delegations_delegator_employee_id_fkey"
            columns: ["delegator_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_delegations_executor_employee_id_fkey"
            columns: ["executor_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_delegations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_delegations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_delegations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_delegations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_delegations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_delegations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_delegations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
        ]
      }
      task_followers: {
        Row: {
          added_at: string
          added_by: string | null
          employee_id: string | null
          id: string
          task_id: string
          user_id: string | null
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          employee_id?: string | null
          id?: string
          task_id: string
          user_id?: string | null
        }
        Update: {
          added_at?: string
          added_by?: string | null
          employee_id?: string | null
          id?: string
          task_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_followers_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_followers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_followers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_followers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_followers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_followers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_followers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
        ]
      }
      task_links: {
        Row: {
          created_at: string
          created_by: string | null
          dependency_type: Database["public"]["Enums"]["task_dependency_type"]
          id: string
          lag_days: number
          organization_id: string
          source_task_id: string
          target_task_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dependency_type?: Database["public"]["Enums"]["task_dependency_type"]
          id?: string
          lag_days?: number
          organization_id: string
          source_task_id: string
          target_task_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dependency_type?: Database["public"]["Enums"]["task_dependency_type"]
          id?: string
          lag_days?: number
          organization_id?: string
          source_task_id?: string
          target_task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_links_source_task_id_fkey"
            columns: ["source_task_id"]
            isOneToOne: false
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_links_source_task_id_fkey"
            columns: ["source_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_links_source_task_id_fkey"
            columns: ["source_task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_links_source_task_id_fkey"
            columns: ["source_task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_links_source_task_id_fkey"
            columns: ["source_task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_links_source_task_id_fkey"
            columns: ["source_task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_links_target_task_id_fkey"
            columns: ["target_task_id"]
            isOneToOne: false
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_links_target_task_id_fkey"
            columns: ["target_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_links_target_task_id_fkey"
            columns: ["target_task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_links_target_task_id_fkey"
            columns: ["target_task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_links_target_task_id_fkey"
            columns: ["target_task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_links_target_task_id_fkey"
            columns: ["target_task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
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
      task_stage_dwell: {
        Row: {
          dwell_business_minutes: number
          entered_at: string
          exited_at: string | null
          history_id: string
          organization_id: string
          refreshed_at: string
          stage: string
          task_id: string
        }
        Insert: {
          dwell_business_minutes: number
          entered_at: string
          exited_at?: string | null
          history_id: string
          organization_id: string
          refreshed_at?: string
          stage: string
          task_id: string
        }
        Update: {
          dwell_business_minutes?: number
          entered_at?: string
          exited_at?: string | null
          history_id?: string
          organization_id?: string
          refreshed_at?: string
          stage?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_stage_dwell_history_id_fkey"
            columns: ["history_id"]
            isOneToOne: true
            referencedRelation: "task_stage_history"
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
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
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
          {
            foreignKeyName: "task_stage_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_stage_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_stage_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
        ]
      }
      task_tag_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          tag_id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          tag_id: string
          task_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          tag_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_tag_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "project_tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_tag_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_tag_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_tag_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_tag_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_tag_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_tag_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
        ]
      }
      task_template_items: {
        Row: {
          code: string | null
          created_at: string
          default_department_id: string | null
          default_role_key: string | null
          description: string | null
          duration_days: number
          external_id: string | null
          external_source: string | null
          id: string
          offset_days_from_project_start: number
          order_index: number
          organization_id: string
          priority: string
          requires_approval: boolean
          stage_owner_positions: Json
          stage_sla_overrides: Json | null
          task_template_id: string
          title: string
          updated_at: string
          upload_offset_days_before_deadline: number | null
          week_index: number | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          default_department_id?: string | null
          default_role_key?: string | null
          description?: string | null
          duration_days?: number
          external_id?: string | null
          external_source?: string | null
          id?: string
          offset_days_from_project_start?: number
          order_index?: number
          organization_id: string
          priority?: string
          requires_approval?: boolean
          stage_owner_positions?: Json
          stage_sla_overrides?: Json | null
          task_template_id: string
          title: string
          updated_at?: string
          upload_offset_days_before_deadline?: number | null
          week_index?: number | null
        }
        Update: {
          code?: string | null
          created_at?: string
          default_department_id?: string | null
          default_role_key?: string | null
          description?: string | null
          duration_days?: number
          external_id?: string | null
          external_source?: string | null
          id?: string
          offset_days_from_project_start?: number
          order_index?: number
          organization_id?: string
          priority?: string
          requires_approval?: boolean
          stage_owner_positions?: Json
          stage_sla_overrides?: Json | null
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
      task_template_links: {
        Row: {
          created_at: string
          dependency_type: Database["public"]["Enums"]["task_dependency_type"]
          external_id: string | null
          external_source: string | null
          id: string
          lag_days: number
          organization_id: string
          source_item_id: string
          target_item_id: string
          task_template_id: string
        }
        Insert: {
          created_at?: string
          dependency_type?: Database["public"]["Enums"]["task_dependency_type"]
          external_id?: string | null
          external_source?: string | null
          id?: string
          lag_days?: number
          organization_id: string
          source_item_id: string
          target_item_id: string
          task_template_id: string
        }
        Update: {
          created_at?: string
          dependency_type?: Database["public"]["Enums"]["task_dependency_type"]
          external_id?: string | null
          external_source?: string | null
          id?: string
          lag_days?: number
          organization_id?: string
          source_item_id?: string
          target_item_id?: string
          task_template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_template_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_template_links_source_item_id_fkey"
            columns: ["source_item_id"]
            isOneToOne: false
            referencedRelation: "task_template_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_template_links_target_item_id_fkey"
            columns: ["target_item_id"]
            isOneToOne: false
            referencedRelation: "task_template_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_template_links_task_template_id_fkey"
            columns: ["task_template_id"]
            isOneToOne: false
            referencedRelation: "task_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      task_templates: {
        Row: {
          category_id: string | null
          created_at: string
          created_by: string | null
          deadline_offset_days: number | null
          default_followers_positions: string[]
          default_owner_position: string | null
          depends_on_template_id: string | null
          description: string | null
          external_id: string | null
          external_source: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          service_id: string
          sla_minutes_in_progress: number | null
          sla_minutes_new: number | null
          sort_order: number
          updated_at: string
          upload_offset_days: number | null
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          deadline_offset_days?: number | null
          default_followers_positions?: string[]
          default_owner_position?: string | null
          depends_on_template_id?: string | null
          description?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          service_id: string
          sla_minutes_in_progress?: number | null
          sla_minutes_new?: number | null
          sort_order?: number
          updated_at?: string
          upload_offset_days?: number | null
        }
        Update: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          deadline_offset_days?: number | null
          default_followers_positions?: string[]
          default_owner_position?: string | null
          depends_on_template_id?: string | null
          description?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          service_id?: string
          sla_minutes_in_progress?: number | null
          sla_minutes_new?: number | null
          sort_order?: number
          updated_at?: string
          upload_offset_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "task_templates_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_depends_on_template_id_fkey"
            columns: ["depends_on_template_id"]
            isOneToOne: false
            referencedRelation: "task_templates"
            referencedColumns: ["id"]
          },
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
      task_timesheets: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          employee_id: string
          hours: number
          id: string
          organization_id: string
          spent_on: string
          task_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          employee_id: string
          hours: number
          id?: string
          organization_id: string
          spent_on?: string
          task_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          employee_id?: string
          hours?: number
          id?: string
          organization_id?: string
          spent_on?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_timesheets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_timesheets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_timesheets_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_timesheets_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_timesheets_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_timesheets_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_timesheets_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_timesheets_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
        ]
      }
      tasks: {
        Row: {
          actual_done_date: string | null
          allocated_time_minutes: number | null
          approval_decided_at: string | null
          approval_decided_by: string | null
          approval_requested_at: string | null
          approval_required: boolean
          approval_status: Database["public"]["Enums"]["task_approval_status"]
          archived_at: string | null
          closed_subtask_count: number
          code_seq: number | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          created_from_template_item_id: string | null
          current_stage_duration: string | null
          date_assign: string | null
          date_end: string | null
          delay_days: number | null
          description: string | null
          design_count: number
          document_count: number
          due_date: string | null
          duration_days: number | null
          duration_tracking: Json | null
          email_cc: string | null
          expected_progress_percent: number
          external_id: string | null
          external_source: string | null
          first_approver_id: string | null
          hold_reason: string | null
          hold_since: string | null
          id: string
          is_important: boolean
          is_overdue: boolean
          last_no_deadline_notification: string | null
          last_overdue_notification: string | null
          organization_id: string
          parent_task_id: string | null
          planned_date: string | null
          priority: string
          progress_percent: number
          progress_slip_percent: number
          project_id: string
          revision_count: number
          search_tsv: unknown
          sequence: number
          service_id: string | null
          sla_override_minutes: number | null
          source_created_at: string | null
          stage: Database["public"]["Enums"]["task_stage"]
          stage_entered_at: string
          stage_owner_positions: Json | null
          stage_sla_overrides: Json | null
          start_date: string | null
          state: Database["public"]["Enums"]["task_state"]
          status: string
          task_code: string | null
          title: string
          updated_at: string
          upload_due_date: string | null
          upload_not_required: boolean
          working_days_close: number | null
          working_days_open: number | null
        }
        Insert: {
          actual_done_date?: string | null
          allocated_time_minutes?: number | null
          approval_decided_at?: string | null
          approval_decided_by?: string | null
          approval_requested_at?: string | null
          approval_required?: boolean
          approval_status?: Database["public"]["Enums"]["task_approval_status"]
          archived_at?: string | null
          closed_subtask_count?: number
          code_seq?: number | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_from_template_item_id?: string | null
          current_stage_duration?: string | null
          date_assign?: string | null
          date_end?: string | null
          delay_days?: number | null
          description?: string | null
          design_count?: number
          document_count?: number
          due_date?: string | null
          duration_days?: number | null
          duration_tracking?: Json | null
          email_cc?: string | null
          expected_progress_percent?: number
          external_id?: string | null
          external_source?: string | null
          first_approver_id?: string | null
          hold_reason?: string | null
          hold_since?: string | null
          id?: string
          is_important?: boolean
          is_overdue?: boolean
          last_no_deadline_notification?: string | null
          last_overdue_notification?: string | null
          organization_id: string
          parent_task_id?: string | null
          planned_date?: string | null
          priority?: string
          progress_percent?: number
          progress_slip_percent?: number
          project_id: string
          revision_count?: number
          search_tsv?: unknown
          sequence?: number
          service_id?: string | null
          sla_override_minutes?: number | null
          source_created_at?: string | null
          stage?: Database["public"]["Enums"]["task_stage"]
          stage_entered_at?: string
          stage_owner_positions?: Json | null
          stage_sla_overrides?: Json | null
          start_date?: string | null
          state?: Database["public"]["Enums"]["task_state"]
          status?: string
          task_code?: string | null
          title: string
          updated_at?: string
          upload_due_date?: string | null
          upload_not_required?: boolean
          working_days_close?: number | null
          working_days_open?: number | null
        }
        Update: {
          actual_done_date?: string | null
          allocated_time_minutes?: number | null
          approval_decided_at?: string | null
          approval_decided_by?: string | null
          approval_requested_at?: string | null
          approval_required?: boolean
          approval_status?: Database["public"]["Enums"]["task_approval_status"]
          archived_at?: string | null
          closed_subtask_count?: number
          code_seq?: number | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_from_template_item_id?: string | null
          current_stage_duration?: string | null
          date_assign?: string | null
          date_end?: string | null
          delay_days?: number | null
          description?: string | null
          design_count?: number
          document_count?: number
          due_date?: string | null
          duration_days?: number | null
          duration_tracking?: Json | null
          email_cc?: string | null
          expected_progress_percent?: number
          external_id?: string | null
          external_source?: string | null
          first_approver_id?: string | null
          hold_reason?: string | null
          hold_since?: string | null
          id?: string
          is_important?: boolean
          is_overdue?: boolean
          last_no_deadline_notification?: string | null
          last_overdue_notification?: string | null
          organization_id?: string
          parent_task_id?: string | null
          planned_date?: string | null
          priority?: string
          progress_percent?: number
          progress_slip_percent?: number
          project_id?: string
          revision_count?: number
          search_tsv?: unknown
          sequence?: number
          service_id?: string | null
          sla_override_minutes?: number | null
          source_created_at?: string | null
          stage?: Database["public"]["Enums"]["task_stage"]
          stage_entered_at?: string
          stage_owner_positions?: Json | null
          stage_sla_overrides?: Json | null
          start_date?: string | null
          state?: Database["public"]["Enums"]["task_state"]
          status?: string
          task_code?: string | null
          title?: string
          updated_at?: string
          upload_due_date?: string | null
          upload_not_required?: boolean
          working_days_close?: number | null
          working_days_open?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_approval_decided_by_fkey"
            columns: ["approval_decided_by"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_from_template_item_id_fkey"
            columns: ["created_from_template_item_id"]
            isOneToOne: false
            referencedRelation: "task_template_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_first_approver_id_fkey"
            columns: ["first_approver_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
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
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
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
      team_activity_cache: {
        Row: {
          actions_prev: number
          actions_today: number
          actions7: number
          done_today: number
          done7: number
          employee_id: string
          last_action: string | null
          last_move: string | null
          last_update: string | null
          moves_today: number
          no_update: number
          notes_today: number
          open_wip: number
          organization_id: string
          refreshed_at: string
          stalled: number
          updates7: number
        }
        Insert: {
          actions_prev?: number
          actions_today?: number
          actions7?: number
          done_today?: number
          done7?: number
          employee_id: string
          last_action?: string | null
          last_move?: string | null
          last_update?: string | null
          moves_today?: number
          no_update?: number
          notes_today?: number
          open_wip?: number
          organization_id: string
          refreshed_at?: string
          stalled?: number
          updates7?: number
        }
        Update: {
          actions_prev?: number
          actions_today?: number
          actions7?: number
          done_today?: number
          done7?: number
          employee_id?: string
          last_action?: string | null
          last_move?: string | null
          last_update?: string | null
          moves_today?: number
          no_update?: number
          notes_today?: number
          open_wip?: number
          organization_id?: string
          refreshed_at?: string
          stalled?: number
          updates7?: number
        }
        Relationships: [
          {
            foreignKeyName: "team_activity_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_project_filters: {
        Row: {
          created_at: string
          definition: Json
          id: string
          is_default: boolean
          is_shared: boolean
          name: string
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          definition?: Json
          id?: string
          is_default?: boolean
          is_shared?: boolean
          name: string
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          definition?: Json
          id?: string
          is_default?: boolean
          is_shared?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_project_filters_organization_id_fkey"
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
      user_task_filters: {
        Row: {
          created_at: string
          definition: Json
          id: string
          is_default: boolean
          is_shared: boolean
          name: string
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          definition?: Json
          id?: string
          is_default?: boolean
          is_shared?: boolean
          name: string
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          definition?: Json
          id?: string
          is_default?: boolean
          is_shared?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_task_filters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_account_backfills: {
        Row: {
          account_id: string
          chat_id: string
          id: string
          imported_at: string
          imported_count: number
          organization_id: string
        }
        Insert: {
          account_id: string
          chat_id: string
          id?: string
          imported_at?: string
          imported_count?: number
          organization_id: string
        }
        Update: {
          account_id?: string
          chat_id?: string
          id?: string
          imported_at?: string
          imported_count?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_account_backfills_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "wa_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_account_backfills_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_accounts: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string | null
          last_auto_restart_at: string | null
          last_seen_at: string | null
          organization_id: string
          phone: string | null
          session_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          last_auto_restart_at?: string | null
          last_seen_at?: string | null
          organization_id: string
          phone?: string | null
          session_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          last_auto_restart_at?: string | null
          last_seen_at?: string | null
          organization_id?: string
          phone?: string | null
          session_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_group_links: {
        Row: {
          admin_count: number | null
          chat_id: string
          chat_name: string | null
          client_id: string | null
          created_at: string
          group_kind: string | null
          history_imported_at: string | null
          id: string
          is_active: boolean
          last_message_at: string | null
          member_count: number | null
          members_synced_at: string | null
          message_count: number
          organization_id: string
          project_id: string | null
          suggested_at: string | null
          suggested_client_id: string | null
          suggested_confidence: string | null
          suggested_project_id: string | null
          suggestion_dismissed_at: string | null
          updated_at: string
        }
        Insert: {
          admin_count?: number | null
          chat_id: string
          chat_name?: string | null
          client_id?: string | null
          created_at?: string
          group_kind?: string | null
          history_imported_at?: string | null
          id?: string
          is_active?: boolean
          last_message_at?: string | null
          member_count?: number | null
          members_synced_at?: string | null
          message_count?: number
          organization_id: string
          project_id?: string | null
          suggested_at?: string | null
          suggested_client_id?: string | null
          suggested_confidence?: string | null
          suggested_project_id?: string | null
          suggestion_dismissed_at?: string | null
          updated_at?: string
        }
        Update: {
          admin_count?: number | null
          chat_id?: string
          chat_name?: string | null
          client_id?: string | null
          created_at?: string
          group_kind?: string | null
          history_imported_at?: string | null
          id?: string
          is_active?: boolean
          last_message_at?: string | null
          member_count?: number | null
          members_synced_at?: string | null
          message_count?: number
          organization_id?: string
          project_id?: string | null
          suggested_at?: string | null
          suggested_client_id?: string | null
          suggested_confidence?: string | null
          suggested_project_id?: string | null
          suggestion_dismissed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_group_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_group_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_delivery_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "wa_group_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_group_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "wa_group_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_group_links_suggested_client_id_fkey"
            columns: ["suggested_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_group_links_suggested_client_id_fkey"
            columns: ["suggested_client_id"]
            isOneToOne: false
            referencedRelation: "v_client_delivery_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "wa_group_links_suggested_project_id_fkey"
            columns: ["suggested_project_id"]
            isOneToOne: false
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "wa_group_links_suggested_project_id_fkey"
            columns: ["suggested_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_group_projects: {
        Row: {
          created_at: string
          group_link_id: string
          id: string
          organization_id: string
          project_id: string
        }
        Insert: {
          created_at?: string
          group_link_id: string
          id?: string
          organization_id: string
          project_id: string
        }
        Update: {
          created_at?: string
          group_link_id?: string
          id?: string
          organization_id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_group_projects_group_link_id_fkey"
            columns: ["group_link_id"]
            isOneToOne: false
            referencedRelation: "wa_group_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_group_projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_group_projects_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "wa_group_projects_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_message_templates: {
        Row: {
          body_template: string
          created_at: string
          id: string
          is_active: boolean
          language: string
          meta_template_name: string | null
          name: string
          organization_id: string
          service_id: string | null
          stage: Database["public"]["Enums"]["task_stage"]
          target: string
          updated_at: string
        }
        Insert: {
          body_template: string
          created_at?: string
          id?: string
          is_active?: boolean
          language?: string
          meta_template_name?: string | null
          name: string
          organization_id: string
          service_id?: string | null
          stage: Database["public"]["Enums"]["task_stage"]
          target?: string
          updated_at?: string
        }
        Update: {
          body_template?: string
          created_at?: string
          id?: string
          is_active?: boolean
          language?: string
          meta_template_name?: string | null
          name?: string
          organization_id?: string
          service_id?: string | null
          stage?: Database["public"]["Enums"]["task_stage"]
          target?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_message_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_message_templates_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_messages: {
        Row: {
          body: string
          chat_id: string
          client_id: string | null
          created_at: string
          first_seen_account_id: string | null
          group_kind: string | null
          id: string
          is_from_me: boolean
          message_type: string | null
          organization_id: string
          sender: string | null
          sender_id: string | null
          sent_at: string | null
          wa_message_id: string
          wa_raw_id: string | null
        }
        Insert: {
          body?: string
          chat_id: string
          client_id?: string | null
          created_at?: string
          first_seen_account_id?: string | null
          group_kind?: string | null
          id?: string
          is_from_me?: boolean
          message_type?: string | null
          organization_id: string
          sender?: string | null
          sender_id?: string | null
          sent_at?: string | null
          wa_message_id: string
          wa_raw_id?: string | null
        }
        Update: {
          body?: string
          chat_id?: string
          client_id?: string | null
          created_at?: string
          first_seen_account_id?: string | null
          group_kind?: string | null
          id?: string
          is_from_me?: boolean
          message_type?: string | null
          organization_id?: string
          sender?: string | null
          sender_id?: string | null
          sent_at?: string | null
          wa_message_id?: string
          wa_raw_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_delivery_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "wa_messages_first_seen_account_id_fkey"
            columns: ["first_seen_account_id"]
            isOneToOne: false
            referencedRelation: "wa_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_outbox: {
        Row: {
          attempts: number
          body: string
          created_at: string
          id: string
          last_error: string | null
          meta_template_name: string | null
          organization_id: string
          recipient_chat_id: string | null
          recipient_employee_id: string | null
          recipient_phone: string | null
          recipient_type: string
          scheduled_at: string
          sent_at: string | null
          status: string
          task_id: string | null
          template_id: string | null
        }
        Insert: {
          attempts?: number
          body: string
          created_at?: string
          id?: string
          last_error?: string | null
          meta_template_name?: string | null
          organization_id: string
          recipient_chat_id?: string | null
          recipient_employee_id?: string | null
          recipient_phone?: string | null
          recipient_type: string
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          task_id?: string | null
          template_id?: string | null
        }
        Update: {
          attempts?: number
          body?: string
          created_at?: string
          id?: string
          last_error?: string | null
          meta_template_name?: string | null
          organization_id?: string
          recipient_chat_id?: string | null
          recipient_employee_id?: string | null
          recipient_phone?: string | null
          recipient_type?: string
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          task_id?: string | null
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_outbox_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_outbox_recipient_employee_id_fkey"
            columns: ["recipient_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_outbox_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_current_stage_owner"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "wa_outbox_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_outbox_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_outbox_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_on_time_delivery"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "wa_outbox_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_review_backlog"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "wa_outbox_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_rework_per_task"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "wa_outbox_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "wa_message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_digest_runs: {
        Row: {
          generated_at: string
          id: string
          iso_week: number
          iso_year: number
          organization_id: string
          payload: Json
          recipient_count: number
        }
        Insert: {
          generated_at?: string
          id?: string
          iso_week: number
          iso_year: number
          organization_id: string
          payload?: Json
          recipient_count?: number
        }
        Update: {
          generated_at?: string
          id?: string
          iso_week?: number
          iso_year?: number
          organization_id?: string
          payload?: Json
          recipient_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "weekly_digest_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
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
      contract_renewal_chains: {
        Row: {
          chain_depth: number | null
          client_id: string | null
          id: string | null
          organization_id: string | null
          paid_value: number | null
          root_id: string | null
          start_date: string | null
          total_value: number | null
        }
        Relationships: []
      }
      project_task_counts: {
        Row: {
          closed_task_count: number | null
          open_task_count: number | null
          project_id: string | null
          task_count: number | null
        }
        Relationships: []
      }
      task_current_stage_owner: {
        Row: {
          owner_avatar_url: string | null
          owner_employee_id: string | null
          owner_full_name: string | null
          owner_job_title: string | null
          owner_position: string | null
          stage: Database["public"]["Enums"]["task_stage"] | null
          task_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_employee_id_fkey"
            columns: ["owner_employee_id"]
            isOneToOne: false
            referencedRelation: "employee_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
          external_id: string | null
          external_source: string | null
          hold_reason: string | null
          hold_since: string | null
          id: string | null
          organization_id: string | null
          planned_date: string | null
          priority: string | null
          progress_percent: number | null
          progress_slip_percent: number | null
          project_id: string | null
          running_delay_days: number | null
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
          delay_days?: number | null
          description?: string | null
          due_date?: string | null
          expected_progress_percent?: number | null
          external_id?: string | null
          external_source?: string | null
          hold_reason?: string | null
          hold_since?: string | null
          id?: string | null
          organization_id?: string | null
          planned_date?: string | null
          priority?: string | null
          progress_percent?: number | null
          progress_slip_percent?: number | null
          project_id?: string | null
          running_delay_days?: never
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
          delay_days?: number | null
          description?: string | null
          due_date?: string | null
          expected_progress_percent?: number | null
          external_id?: string | null
          external_source?: string | null
          hold_reason?: string | null
          hold_since?: string | null
          id?: string | null
          organization_id?: string | null
          planned_date?: string | null
          priority?: string | null
          progress_percent?: number | null
          progress_slip_percent?: number | null
          project_id?: string | null
          running_delay_days?: never
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
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
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
      v_agent_productivity: {
        Row: {
          closed_count: number | null
          median_minutes_per_stage_jsonb: Json | null
          organization_id: string | null
          user_id: string | null
          week_start_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_client_delivery_health: {
        Row: {
          active_project_count: number | null
          avg_revision_count: number | null
          client_id: string | null
          client_name: string | null
          delivered_count_30d: number | null
          last_activity_at: string | null
          on_time_count_30d: number | null
          on_time_pct_30d: number | null
          open_task_count: number | null
          organization_id: string | null
          overdue_task_count: number | null
          total_revision_comments: number | null
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
      v_on_time_delivery: {
        Row: {
          deadline_date: string | null
          done_at: string | null
          on_time_bool: boolean | null
          organization_id: string | null
          project_id: string | null
          service_id: string | null
          task_id: string | null
        }
        Relationships: [
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
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
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
      v_review_backlog: {
        Row: {
          business_minutes_in_stage: number | null
          organization_id: string | null
          project_id: string | null
          service_id: string | null
          stage: string | null
          stage_entered_at: string | null
          task_id: string | null
        }
        Insert: {
          business_minutes_in_stage?: never
          organization_id?: string | null
          project_id?: string | null
          service_id?: string | null
          stage?: never
          stage_entered_at?: string | null
          task_id?: string | null
        }
        Update: {
          business_minutes_in_stage?: never
          organization_id?: string | null
          project_id?: string | null
          service_id?: string | null
          stage?: never
          stage_entered_at?: string | null
          task_id?: string | null
        }
        Relationships: [
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
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
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
      v_rework_per_task: {
        Row: {
          last_client_changes_entered_at: string | null
          organization_id: string | null
          project_id: string | null
          rework_comment_count: number | null
          task_id: string | null
        }
        Relationships: [
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
            referencedRelation: "project_task_counts"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _current_employee_in_org: { Args: { p_org: string }; Returns: string }
      _default_stage_owner_positions: { Args: never; Returns: Json }
      _next_client_code: { Args: { p_org: string }; Returns: string }
      _next_contract_code: { Args: { p_client: string }; Returns: string }
      _next_project_code: { Args: { p_org: string }; Returns: string }
      _next_task_code: {
        Args: { p_project: string }
        Returns: {
          code: string
          seq: number
        }[]
      }
      accountability_role_of_position: {
        Args: { position_role: string }
        Returns: string
      }
      accountable_position_for_stage: {
        Args: { owners: Json; stage: string }
        Returns: string
      }
      accountable_role_for_stage: {
        Args: { owners: Json; stage: string }
        Returns: string
      }
      add_working_days: {
        Args: { p_anchor: string; p_days: number; p_org: string }
        Returns: string
      }
      add_working_days_for_project: {
        Args: {
          p_anchor: string
          p_days: number
          p_org: string
          p_project: string
        }
        Returns: string
      }
      agent_run_readonly_sql: { Args: { p_sql: string }; Returns: Json }
      dashboard_active_member_count: {
        Args: { p_org: string; p_from: string; p_to: string }
        Returns: number
      }
      approve_task: {
        Args: { p_notes?: string; p_task_id: string }
        Returns: {
          actual_done_date: string | null
          allocated_time_minutes: number | null
          approval_decided_at: string | null
          approval_decided_by: string | null
          approval_requested_at: string | null
          approval_required: boolean
          approval_status: Database["public"]["Enums"]["task_approval_status"]
          archived_at: string | null
          closed_subtask_count: number
          code_seq: number | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          created_from_template_item_id: string | null
          current_stage_duration: string | null
          date_assign: string | null
          date_end: string | null
          delay_days: number | null
          description: string | null
          design_count: number
          document_count: number
          due_date: string | null
          duration_days: number | null
          duration_tracking: Json | null
          email_cc: string | null
          expected_progress_percent: number
          external_id: string | null
          external_source: string | null
          first_approver_id: string | null
          hold_reason: string | null
          hold_since: string | null
          id: string
          is_important: boolean
          is_overdue: boolean
          last_no_deadline_notification: string | null
          last_overdue_notification: string | null
          organization_id: string
          parent_task_id: string | null
          planned_date: string | null
          priority: string
          progress_percent: number
          progress_slip_percent: number
          project_id: string
          revision_count: number
          search_tsv: unknown
          sequence: number
          service_id: string | null
          sla_override_minutes: number | null
          source_created_at: string | null
          stage: Database["public"]["Enums"]["task_stage"]
          stage_entered_at: string
          stage_owner_positions: Json | null
          stage_sla_overrides: Json | null
          start_date: string | null
          state: Database["public"]["Enums"]["task_state"]
          status: string
          task_code: string | null
          title: string
          updated_at: string
          upload_due_date: string | null
          upload_not_required: boolean
          working_days_close: number | null
          working_days_open: number | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      backfill_frozen_dept_split: {
        Args: { p_month: string; p_org: string }
        Returns: undefined
      }
      business_minutes_between: {
        Args: { p_end: string; p_start: string }
        Returns: number
      }
      compute_am_monthly_targets: {
        Args: { p_month: string; p_org: string }
        Returns: number
      }
      compute_employee_activity: {
        Args: { p_as_of: string; p_org: string }
        Returns: number
      }
      compute_employee_activity_all: { Args: never; Returns: number }
      effective_task_owner_position: {
        Args: { p_owners: Json; p_stage: string; p_task_id: string }
        Returns: string
      }
      compute_monthly_closing: { Args: { p_month: string }; Returns: number }
      compute_monthly_dashboard: {
        Args: { p_month: string; p_org: string }
        Returns: {
          acc_achievement_pct: number
          acc_act_inst: number
          acc_act_ontarget: number
          acc_act_overdue_clients: number
          acc_act_sd_renewed: number
          acc_actual: number
          acc_exp_inst: number
          acc_exp_ontarget: number
          acc_exp_overdue_clients: number
          acc_exp_overdue_inst: number
          acc_expected: number
          acc_gap: number
          acc_upsell: number
          acc_winback: number
          achievement_pct: number
          actual_installments: number
          actual_renewals: number
          cnt_on_target: number
          cnt_overdue: number
          cnt_roster_hold: number
          cnt_roster_new: number
          cnt_roster_renew: number
          cnt_roster_upsell: number
          cnt_roster_winback: number
          cnt_sales_deposit: number
          cnt_total_clients: number
          created_at: string
          expected_installments: number
          expected_renewals: number
          frozen_at: string | null
          id: string
          is_frozen: boolean
          month: string
          mov_closed: number
          mov_hold: number
          mov_lost: number
          mov_new: number
          mov_renewed: number
          mov_upsell: number
          mov_winback: number
          organization_id: string
          sales_achievement_pct: number
          sales_act_inst: number
          sales_exp_inst: number
          sales_exp_overdue_inst: number
          sales_expected: number
          sales_gap: number
          sales_new_income: number
          sales_total_income: number
          sales_upsell: number
          source: string
          total_actual: number
          total_expected: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "monthly_dashboard_totals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      compute_task_delay_days: {
        Args: {
          p_completed: string
          p_org: string
          p_planned: string
          p_stage: Database["public"]["Enums"]["task_stage"]
        }
        Returns: number
      }
      contract_total_days: {
        Args: { p_months: number; p_package_ids: string[]; p_type_key: string }
        Returns: number
      }
      current_user_organization_ids: { Args: never; Returns: string[] }
      derive_task_state: {
        Args: { p_stage: Database["public"]["Enums"]["task_stage"] }
        Returns: Database["public"]["Enums"]["task_state"]
      }
      enqueue_upload_deadline_reminders: {
        Args: never
        Returns: {
          out_count: number
          out_event_type: string
        }[]
      }
      freeze_month_dashboards: { Args: { p_month: string }; Returns: number }
      get_ceo_client_insights: {
        Args: { p_limit?: number; p_month: string; p_org: string }
        Returns: {
          account_manager_name: string
          active_contracts: number
          client_code: string
          client_id: string
          client_name: string
          health_label: string
          health_score: number
          month_collected: number
          month_expected: number
          next_renewal_date: string
          on_time_pct_30d: number
          open_task_count: number
          overdue_installments: number
          overdue_task_count: number
          payment_status: string
          renewal_status: string
          renewal_value_due: number
          satisfaction_score: number
          satisfaction_summary: string
          sentiment: string
          top_risk: string
          total_contract_value: number
        }[]
      }
      get_contracts_roster: {
        Args: { p_org: string }
        Returns: {
          cnt_hold: number
          cnt_new: number
          cnt_renew: number
          cnt_switch: number
          cnt_untyped: number
          cnt_upsell: number
          cnt_winback: number
          total: number
        }[]
      }
      get_month_target_buckets: {
        Args: { p_month: string; p_org: string }
        Returns: {
          account_manager_name: string
          bucket: string
          client_code: string
          client_name: string
          contract_id: string
          status: string
          value: number
        }[]
      }
      get_overdue_during_period: {
        Args: { p_from: string; p_org: string; p_to: string }
        Returns: number
      }
      get_projects_at_risk_asof: {
        Args: { p_asof: string; p_org: string; p_threshold: number }
        Returns: number
      }
      get_stage_funnel: {
        Args: { p_org_id: string }
        Returns: {
          avg_dwell_hours: number
          open_count: number
          overdue_count: number
          stage: string
        }[]
      }
      get_recent_wa_clients: {
        Args: { p_org: string; p_since: string }
        Returns: {
          client_id: string
        }[]
      }
      get_wa_group_coverage: {
        Args: { p_org: string }
        Returns: {
          account_count: number
          chat_id: string
        }[]
      }
      has_org_access: { Args: { target_org: string }; Returns: boolean }
      has_permission:
        | { Args: { perm_key: string }; Returns: boolean }
        | { Args: { perm_key: string; target_org: string }; Returns: boolean }
      is_working_day: {
        Args: { p_date: string; p_org: string }
        Returns: boolean
      }
      is_working_day_for_project: {
        Args: { p_date: string; p_org: string; p_project: string }
        Returns: boolean
      }
      list_projects_page_bundle: {
        Args: {
          p_all_categories_archived?: boolean
          p_archived?: boolean
          p_end_date_from?: string
          p_end_date_to?: string
          p_id_whitelist?: string[]
          p_only_favorites?: boolean
          p_only_mine_employee_id?: string
          p_only_unassigned?: boolean
          p_only_with_categories?: boolean
          p_only_with_manager?: boolean
          p_org_id: string
          p_over_timesheets?: boolean
          p_page?: number
          p_page_size?: number
          p_search?: string
          p_search_facets?: Json
          p_start_date_from?: string
          p_start_date_to?: string
        }
        Returns: Json
      }
      list_tasks_bundle: {
        Args: {
          p_ahead_schedule?: boolean
          p_archived?: boolean
          p_assigned_to_employee_id?: string
          p_behind_schedule?: boolean
          p_critical_delay?: boolean
          p_date_filters?: Json
          p_due_today?: boolean
          p_followed_by_user_id?: string
          p_has_end_date?: boolean
          p_has_start_date?: boolean
          p_include_archived?: boolean
          p_limit?: number
          p_near_timesheets?: boolean
          p_no_deadline?: boolean
          p_offset?: number
          p_org_id: string
          p_over_timesheets?: boolean
          p_overdue?: boolean
          p_partition_by?: string
          p_partition_limit?: number
          p_priority?: string[]
          p_progress_buckets?: string[]
          p_project_id?: string
          p_search?: string
          p_search_facets?: Json
          p_stage?: string[]
          p_starred?: boolean
          p_status?: string[]
          p_task_ids?: string[]
          p_unassigned?: boolean
        }
        Returns: Json
      }
      mark_episode_actor: {
        Args: { p_org: string; p_task: string; p_user: string }
        Returns: undefined
      }
      mark_episode_comment: {
        Args: { p_org: string; p_task: string; p_user: string }
        Returns: undefined
      }
      merge_clients: {
        Args: { p_org: string; p_source: string; p_target: string }
        Returns: Json
      }
      notify_hold_expiring_contracts: { Args: never; Returns: number }
      notify_no_deadline_tasks: { Args: never; Returns: number }
      notify_overdue_activities: { Args: never; Returns: number }
      notify_overdue_tasks: { Args: never; Returns: number }
      prune_old_direct_messages: { Args: never; Returns: undefined }
      recalculate_project_task_dates: {
        Args: { p_project: string }
        Returns: number
      }
      recompute_closed_subtask_count: {
        Args: { p_parent_id: string }
        Returns: undefined
      }
      recompute_contract_end_date: {
        Args: { p_contract: string }
        Returns: string
      }
      recompute_task_delay_days: { Args: { p_org: string }; Returns: number }
      refresh_accountability_scorecard: { Args: never; Returns: number }
      refresh_performance_snapshots: { Args: never; Returns: number }
      refresh_task_progress: { Args: never; Returns: number }
      refresh_task_stage_dwell: {
        Args: { p_window_days?: number }
        Returns: number
      }
      refresh_team_activity: { Args: never; Returns: number }
      reject_task: {
        Args: { p_notes?: string; p_task_id: string }
        Returns: {
          actual_done_date: string | null
          allocated_time_minutes: number | null
          approval_decided_at: string | null
          approval_decided_by: string | null
          approval_requested_at: string | null
          approval_required: boolean
          approval_status: Database["public"]["Enums"]["task_approval_status"]
          archived_at: string | null
          closed_subtask_count: number
          code_seq: number | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          created_from_template_item_id: string | null
          current_stage_duration: string | null
          date_assign: string | null
          date_end: string | null
          delay_days: number | null
          description: string | null
          design_count: number
          document_count: number
          due_date: string | null
          duration_days: number | null
          duration_tracking: Json | null
          email_cc: string | null
          expected_progress_percent: number
          external_id: string | null
          external_source: string | null
          first_approver_id: string | null
          hold_reason: string | null
          hold_since: string | null
          id: string
          is_important: boolean
          is_overdue: boolean
          last_no_deadline_notification: string | null
          last_overdue_notification: string | null
          organization_id: string
          parent_task_id: string | null
          planned_date: string | null
          priority: string
          progress_percent: number
          progress_slip_percent: number
          project_id: string
          revision_count: number
          search_tsv: unknown
          sequence: number
          service_id: string | null
          sla_override_minutes: number | null
          source_created_at: string | null
          stage: Database["public"]["Enums"]["task_stage"]
          stage_entered_at: string
          stage_owner_positions: Json | null
          stage_sla_overrides: Json | null
          start_date: string | null
          state: Database["public"]["Enums"]["task_state"]
          status: string
          task_code: string | null
          title: string
          updated_at: string
          upload_due_date: string | null
          upload_not_required: boolean
          working_days_close: number | null
          working_days_open: number | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_task_approval: {
        Args: { p_approver_id?: string; p_notes?: string; p_task_id: string }
        Returns: {
          actual_done_date: string | null
          allocated_time_minutes: number | null
          approval_decided_at: string | null
          approval_decided_by: string | null
          approval_requested_at: string | null
          approval_required: boolean
          approval_status: Database["public"]["Enums"]["task_approval_status"]
          archived_at: string | null
          closed_subtask_count: number
          code_seq: number | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          created_from_template_item_id: string | null
          current_stage_duration: string | null
          date_assign: string | null
          date_end: string | null
          delay_days: number | null
          description: string | null
          design_count: number
          document_count: number
          due_date: string | null
          duration_days: number | null
          duration_tracking: Json | null
          email_cc: string | null
          expected_progress_percent: number
          external_id: string | null
          external_source: string | null
          first_approver_id: string | null
          hold_reason: string | null
          hold_since: string | null
          id: string
          is_important: boolean
          is_overdue: boolean
          last_no_deadline_notification: string | null
          last_overdue_notification: string | null
          organization_id: string
          parent_task_id: string | null
          planned_date: string | null
          priority: string
          progress_percent: number
          progress_slip_percent: number
          project_id: string
          revision_count: number
          search_tsv: unknown
          sequence: number
          service_id: string | null
          sla_override_minutes: number | null
          source_created_at: string | null
          stage: Database["public"]["Enums"]["task_stage"]
          stage_entered_at: string
          stage_owner_positions: Json | null
          stage_sla_overrides: Json | null
          start_date: string | null
          state: Database["public"]["Enums"]["task_state"]
          status: string
          task_code: string | null
          title: string
          updated_at: string
          upload_due_date: string | null
          upload_not_required: boolean
          working_days_close: number | null
          working_days_open: number | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reset_task_approval: {
        Args: {
          p_clear_requirement?: boolean
          p_notes?: string
          p_task_id: string
        }
        Returns: {
          actual_done_date: string | null
          allocated_time_minutes: number | null
          approval_decided_at: string | null
          approval_decided_by: string | null
          approval_requested_at: string | null
          approval_required: boolean
          approval_status: Database["public"]["Enums"]["task_approval_status"]
          archived_at: string | null
          closed_subtask_count: number
          code_seq: number | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          created_from_template_item_id: string | null
          current_stage_duration: string | null
          date_assign: string | null
          date_end: string | null
          delay_days: number | null
          description: string | null
          design_count: number
          document_count: number
          due_date: string | null
          duration_days: number | null
          duration_tracking: Json | null
          email_cc: string | null
          expected_progress_percent: number
          external_id: string | null
          external_source: string | null
          first_approver_id: string | null
          hold_reason: string | null
          hold_since: string | null
          id: string
          is_important: boolean
          is_overdue: boolean
          last_no_deadline_notification: string | null
          last_overdue_notification: string | null
          organization_id: string
          parent_task_id: string | null
          planned_date: string | null
          priority: string
          progress_percent: number
          progress_slip_percent: number
          project_id: string
          revision_count: number
          search_tsv: unknown
          sequence: number
          service_id: string | null
          sla_override_minutes: number | null
          source_created_at: string | null
          stage: Database["public"]["Enums"]["task_stage"]
          stage_entered_at: string
          stage_owner_positions: Json | null
          stage_sla_overrides: Json | null
          start_date: string | null
          state: Database["public"]["Enums"]["task_state"]
          status: string
          task_code: string | null
          title: string
          updated_at: string
          upload_due_date: string | null
          upload_not_required: boolean
          working_days_close: number | null
          working_days_open: number | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_activity_actor: {
        Args: { p_name: string; p_org: string }
        Returns: string
      }
      search_tasks_typeahead: {
        Args: {
          p_limit?: number
          p_org_id: string
          p_project_id?: string
          p_query: string
        }
        Returns: Json
      }
      shift_tasks_for_holidays: {
        Args: { p_dates: string[]; p_org: string }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      snapshot_dashboard_daily: { Args: never; Returns: number }
      task_current_stage_seconds: {
        Args: { t: Database["public"]["Tables"]["tasks"]["Row"] }
        Returns: number
      }
      task_record_pagination: {
        Args: { p_org_id: string; p_project_id: string; p_task_id: string }
        Returns: Json
      }
      task_smart_button_counts: {
        Args: { p_org_id: string; p_task_id: string }
        Returns: Json
      }
      working_days_between: {
        Args: { p_from: string; p_org: string; p_to: string }
        Returns: number
      }
      working_days_between_for_project: {
        Args: { p_from: string; p_org: string; p_project: string; p_to: string }
        Returns: number
      }
      working_minutes_between: {
        Args: { p_end: string; p_org: string; p_start: string }
        Returns: number
      }
    }
    Enums: {
      attendance_status:
        | "present"
        | "late"
        | "absent"
        | "remote"
        | "half_day"
        | "leave"
      department_kind:
        | "group"
        | "account_management"
        | "main_section"
        | "supporting_section"
        | "quality_control"
        | "other"
      expense_category:
        | "salaries"
        | "rent"
        | "ads"
        | "software"
        | "equipment"
        | "utilities"
        | "marketing"
        | "tax"
        | "other"
      lead_status:
        | "new"
        | "contacted"
        | "qualified"
        | "proposal"
        | "won"
        | "lost"
      leave_status: "pending" | "approved" | "rejected" | "cancelled"
      leave_type:
        | "annual"
        | "sick"
        | "unpaid"
        | "maternity"
        | "paternity"
        | "compassionate"
        | "other"
      task_activity_type: "call" | "email" | "review" | "upload" | "other"
      task_approval_status: "not_required" | "pending" | "approved" | "rejected"
      task_comment_kind: "note" | "requirements" | "modification"
      task_dependency_type:
        | "finish_to_start"
        | "start_to_start"
        | "finish_to_finish"
        | "start_to_finish"
      task_role_type:
        | "specialist"
        | "manager"
        | "agent"
        | "account_manager"
        | "supporting_lead"
        | "supporting_agent"
        | "team_lead"
      task_stage:
        | "new"
        | "in_progress"
        | "manager_review"
        | "specialist_review"
        | "ready_to_send"
        | "sent_to_client"
        | "client_changes"
        | "done"
      task_state:
        | "01_in_progress"
        | "02_changes_requested"
        | "03_approved"
        | "04_waiting_normal"
      warning_severity: "verbal" | "written" | "final" | "suspension"
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
      attendance_status: [
        "present",
        "late",
        "absent",
        "remote",
        "half_day",
        "leave",
      ],
      department_kind: [
        "group",
        "account_management",
        "main_section",
        "supporting_section",
        "quality_control",
        "other",
      ],
      expense_category: [
        "salaries",
        "rent",
        "ads",
        "software",
        "equipment",
        "utilities",
        "marketing",
        "tax",
        "other",
      ],
      lead_status: ["new", "contacted", "qualified", "proposal", "won", "lost"],
      leave_status: ["pending", "approved", "rejected", "cancelled"],
      leave_type: [
        "annual",
        "sick",
        "unpaid",
        "maternity",
        "paternity",
        "compassionate",
        "other",
      ],
      task_activity_type: ["call", "email", "review", "upload", "other"],
      task_approval_status: ["not_required", "pending", "approved", "rejected"],
      task_comment_kind: ["note", "requirements", "modification"],
      task_dependency_type: [
        "finish_to_start",
        "start_to_start",
        "finish_to_finish",
        "start_to_finish",
      ],
      task_role_type: [
        "specialist",
        "manager",
        "agent",
        "account_manager",
        "supporting_lead",
        "supporting_agent",
        "team_lead",
      ],
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
      task_state: [
        "01_in_progress",
        "02_changes_requested",
        "03_approved",
        "04_waiting_normal",
      ],
      warning_severity: ["verbal", "written", "final", "suspension"],
      whatsapp_group_kind: ["client", "internal"],
    },
  },
} as const

export interface RunData {
  id: string;
  project_id?: string | null;
  mode: 'rehearsal' | 'presentation';
  duration: number;
  avg_pace_wpm?: number | null;
  avg_confidence?: number | null;
  filler_word_count?: number | null;
  eye_contact_pct?: number | null;
  posture_good_pct?: number | null;
  overall_score?: number | null;
}

export interface FeedbackData {
  id: string;
  run_id: string;
  timestamp: string;
  message: string;
  slide_number?: number | null;
  severity?: string | null;
  category?: string | null;
}

export interface ProjectData {
  id: string;
  name: string;
  description?: string | null;
  content?: string | null;
  file_path?: string | null;
  file_type?: string | null;
  slide_count?: number | null;
  created_at?: string;
  updated_at?: string;
  run_count?: number;
  latest_score?: number | null;
}

export interface ProjectSlideData {
  id: string;
  project_id: string;
  slide_number: number;
  title?: string | null;
  content?: string | null;
  speaker_notes?: string | null;
}

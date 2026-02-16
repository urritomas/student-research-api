// src/models/defenses.ts

export type DefenseTypeEnum = 'proposal' | 'midterm' | 'final';
export type DefenseStatusEnum = 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';

export interface Defense {
  id: string; // uuid
  project_id: string; // uuid
  defense_type: DefenseTypeEnum;
  scheduled_at: Date; // timestamptz
  location: string; // text
  rubric_id: string; // uuid
  status: DefenseStatusEnum;
  created_at?: Date;
  updated_at?: Date;
}

export default Defense;
// src/models/defenses.ts
 
export type DefenseTypeEnum = 'proposal' | 'midterm' | 'final';
export type DefenseStatusEnum = 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';
 
export interface Defense {
  id: string; // uuid
  project_id: string; // uuid
  defense_type: DefenseTypeEnum;
  start_time: Date; // datetime
  end_time?: Date; // datetime (nullable)
  location: string; // varchar(255)
  rubric_id?: string; // uuid (nullable)
  status: DefenseStatusEnum;
  modality?: string; // varchar(50) (nullable)
  created_by: string; // uuid
  created_at?: Date; // timestamp
}
 
export default Defense;
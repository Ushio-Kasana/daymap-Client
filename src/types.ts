export interface DaymapUser {
  username?: string | null;
  schoolCode?: string | null;
  schoolName?: string | null;
  daymapID?: number | null;
  contactID?: number | null;
  firstname?: string | null;
  surname?: string | null;
  year?: string | null;
  group?: string | null;
}

export interface AssessmentTask {
  id: number;
  name: string;
  className?: string | null;
  classCode?: string | null;
  type?: string | null;
  teacherName?: string | null;
  status?: string | null;
  overdue: boolean;
  graded: boolean;
  marked: boolean;
  maxMark?: number | null;
  dueDate?: string | null;
  setDate?: string | null;
  workReceived?: string | null;
}

export interface OverdueSettings {
  mutedClasses: string[];
  notOverdueTaskIds: number[];
}

export interface DaymapMessage {
  id: number;
  subject: string;
  text?: string | null;
  senderName?: string | null;
  sentOn?: string | null;
  threadCount: number;
  hasAttachments: boolean;
  read: boolean;
  sentTo?: string | null;
  priority: number;
}

export interface DiaryItem {
  id: number;
  title: string;
  start?: string | null;
  finish?: string | null;
  text?: string | null;
  calendar?: string | null;
  attendanceStatus?: number | null;
  attendanceReason?: string | null;
  room?: string | null;
  teacherName?: string | null;
  substituteName?: string | null;
  type?: number | null;
}

export interface Dashboard {
  user: DaymapUser;
  tasks: AssessmentTask[];
  messages: DaymapMessage[];
  notices: DaymapMessage[];
  diary: DiaryItem[];
  fetchedAt: string;
  offline?: boolean;
}

export type Section = "overview" | "tasks" | "messages" | "notices" | "timetable" | "settings";

export interface MessageFolder {
  id: string;
  title: string;
  folderType?: number | null;
  itemCount: number;
}

export interface MessagePerson {
  id: number;
  title: string;
  typeLabel: string;
}

export interface LessonLink {
  title: string;
  href: string;
}

export interface AssignmentFile {
  id: number | null;
  name: string;
  description?: string | null;
  modified?: string | null;
  externalUrl?: string | null;
}

export interface AssignmentDetail {
  id: number;
  name: string;
  description?: string | null;
  className?: string | null;
  classCode?: string | null;
  type?: string | null;
  teacherName?: string | null;
  status?: string | null;
  maxMark?: number | null;
  dueDate?: string | null;
  setDate?: string | null;
  workReceived?: string | null;
  studentCanUpload: boolean;
  studentCanDeleteWork: boolean;
  overdue: boolean;
  marked: boolean;
  graded: boolean;
}

export interface AssignmentResult {
  mark?: number | null;
  maxMark?: number | null;
  grade?: string | null;
  similarity?: number | null;
  reportUrl?: string | null;
}

export interface AssignmentBundle {
  detail: AssignmentDetail;
  resources: AssignmentFile[];
  work: AssignmentFile[];
  workReceived?: string | null;
  result?: AssignmentResult | null;
  results?: AssignmentFile[] | null;
}

export interface ClassNote {
  noteId: number;
  eventId: number;
  title: string;
  category?: string | null;
  date?: string | null;
  period?: string | null;
  published?: string | null;
  preview?: string | null;
}

export interface ClassFile {
  file: AssignmentFile;
  eventId: number;
  date?: string | null;
  period?: string | null;
}

export interface ClassAttendance {
  attended: number;
  absent: number;
  excused: number;
  marked: number;
  percentage?: number | null;
}

export interface ClassOverview {
  id: number;
  name: string;
  code?: string | null;
  subject?: string | null;
  teachers?: string | null;
  room?: string | null;
  attendance: ClassAttendance;
  notes: ClassNote[];
  files: ClassFile[];
  offline?: boolean;
  fetchedAt?: string | null;
}

export interface ClassTarget {
  eventId?: number | null;
  className?: string | null;
  classCode?: string | null;
}

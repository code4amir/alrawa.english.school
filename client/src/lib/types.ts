export interface Student {
  id: string;
  classId?: string | null;
  class: string;
  studentId: string;
  roll: string | null;
  session: string | null;
  name: string;
  fatherName: string | null;
  motherName: string | null;
  contact: string | null;
  hasPhoto: boolean;
  hasGraduated: boolean;
  photoUrl?: string | null;
  createdAt: string;
  services?: StudentService[];
}

export interface Teacher {
  id: string;
  name: string;
  contact: string | null;
  email: string | null;
  role: string | null;
  designation?: string | null;
  userId?: string | null;
  hasPhoto: boolean;
  photoUrl?: string | null;
  createdAt: string;
  classTeacherOf?: ClassTeacherAssignment[];
  subjectAssignments?: TeacherSubjectAssignment[];
}

export interface ClassTeacherAssignment {
  id: string;
  classId: string;
  className: string;
}

export interface TeacherSubjectAssignment {
  id: string;
  subjectId: string;
  subjectName: string;
  classId: string;
  className: string;
}

export interface Staff {
  id: string;
  name: string;
  contact: string | null;
  email: string | null;
  role: string | null;
  designation?: string | null;
  hasPhoto: boolean;
  photoUrl?: string | null;
  createdAt: string;
}

export interface SchoolClass {
  id: string;
  name: string;
  section?: string | null;
  order?: number;
  createdAt?: string;
  studentCount?: number;
  bookCount?: number;
  subjectCount?: number;
}

export interface Subject {
  id: string;
  name: string;
  fullMarks: number;
  classId: string;
  order: number;
}

export interface Result {
  id: string;
  studentId: string;
  session: string;
  term: string;
  marks: Record<string, number>;
  attendance: { days: number; present: number } | null;
  comment: string | null;
}

export interface FeeSchedule {
  id: string;
  academicYearId: string;
  classId: string | null;
  category: string;
  amount: number;
  frequency: string;
  applicability: string;
  classRel?: { name: string } | null;
}

export interface FeeWaiver {
  id: string;
  student: string;
  feeSchedule: string;
  type: string;
  value: number;
  reason: string | null;
  approvedBy: string | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  studentName: string;
  feeCategory: string;
  feeScheduleAmount: number;
}

export interface Transaction {
  id: string;
  transactionDate: string;
  entryDate: string;
  transactionType: 'INCOME' | 'EXPENSE' | 'INTERNAL_TRANSFER';
  description: string;
  category: string | null;
  amount: number;
  sourceAccount: string | null;
  destinationAccount: string | null;
  studentId: string | null;
  studentName: string | null;
  className: string | null;
  feeMonth: string | null;
  affectsIncomeLedger?: boolean;
  affectsExpenseLedger?: boolean;
  isCancelled?: boolean;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  reversalOfId: string | null;
  referenceId: string | null;
  tokenNumber: number | null;
  createdBy: string | null;
  createdAt: string;
  status: string;
}

export interface LedgerEntry {
  id: string;
  voucher: string;
  transactionDate: string;
  entryDate: string;
  transactionType: string;
  amount: number;
  debit: number;
  credit: number;
  runningBalance: number;
  description: string;
  category: string | null;
  sourceAccount: string | null;
  destinationAccount: string | null;
  studentId: string | null;
  studentName: string | null;
  className: string | null;
  feeMonth: string | null;
  tokenNumber: number | null;
  referenceId: string | null;
  isCancelled: boolean;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelledByName: string | null;
  cancelReason: string | null;
  reversalOfId: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
}

export interface LedgerResponse {
  data: LedgerEntry[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalRows: number;
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
}

export interface Balance {
  account: string;
  balance: number;
}

export interface AcademicYear {
  id: string;
  name: string;
  isActive: boolean;
  startDate?: string;
  endDate?: string;
}

export interface ServiceType {
  id: string;
  name: string;
  defaultAmount: number;
  frequency: string;
  active: boolean;
  createdAt: string;
}

export interface StudentService {
  id: string;
  serviceTypeId: string;
  serviceName: string;
  serviceAmount: number;
  serviceFrequency: string;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  autoAssigned: boolean;
  createdAt: string;
}

export interface OpeningBalance {
  id: string;
  fiscalYear: number;
  account: string;
  amount: number;
}

export interface OpeningBalanceHistory {
  id: string;
  fiscalYear: number;
  account: string;
  oldAmount: number;
  newAmount: number;
  changedBy: string;
  changedAt: string;
}

export interface Book {
  id: string;
  name: string;
  classId: string | null;
  className?: string | null;
  publication?: string;
  mrp?: number;
  discounted?: number;
  sell: number;
}

export interface DefaulterMonth {
  month: string;
  amount: number;
  paid: boolean;
}

export interface DefaulterFee {
  name: string;
  amount: number;
  paid: boolean;
  type: 'onetime' | 'global' | 'recurring' | 'special';
  months?: DefaulterMonth[];
}

export interface DefaulterStudent {
  studentId: string;
  name: string;
  class: string;
  totalDue: number;
  totalPaid: number;
  balance: number;
  fees: DefaulterFee[];
}

export interface SchoolSettings {
  school_name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
}

export interface DailyQuiz {
  id: string;
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  category: string;
  quizDate: string;
  explanation: string;
  hasResponded: boolean;
}

export interface DailyRiddle {
  id: string;
  question: string;
  hint: string;
  riddleDate: string;
  hasResponded: boolean;
  showAnswer: boolean;
  answer?: string;
  yourGuess?: string;
  isCorrect?: boolean;
}

export interface DailyTip {
  id: string;
  tip: string;
  category: string;
  tipDate: string;
}

export interface WeeklyChallenge {
  id: string;
  title: string;
  description: string;
  challengeType: string;
  startDate: string;
  endDate: string;
  hasResponded: boolean;
  responseCount: number;
}

export interface MoodCheckin {
  id: string;
  mood: number;
  moodDisplay: string;
  checkinDate: string;
}

export interface LessonPlan {
  id: string;
  planDate: string;
  className: string;
  subject: string;
  notes: string;
}

export interface TeacherStreak {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
  totalDaysActive: number;
}

export interface AttendanceRecord {
  id: string;
  student: string;
  studentName: string;
  studentRoll: string;
  school_class: string;
  date: string;
  term: string;
  session: string;
  status: 'present' | 'absent';
  marked_by: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceCalendarDay {
  date: string;
  weekday: number;
  type: 'weekend' | 'holiday' | 'de_facto_holiday' | 'marked' | 'unmarked';
  status?: 'present' | 'absent';
  holiday_name?: string | null;
}

export interface AttendanceMonthResponse {
  student: { id: string; name: string; roll: string };
  year: number;
  month: number;
  days: AttendanceCalendarDay[];
}

export interface AttendanceSummary {
  present: number;
  absent: number;
  total_school_days: number;
  holidays: number;
  weekends: number;
  unmarked: number;
}

export interface ClassAttendanceReport {
  class: { id: string; name: string };
  students: { id: string; name: string; roll: string }[];
  dates: string[];
  grid: Record<string, Record<string, 'present' | 'absent'>>;
  summary: Record<string, { present: number; absent: number; total: number; pct: number }>;
  date_summary: Record<string, { present: number; absent: number }>;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  type: 'public' | 'school';
  createdAt: string;
}

export interface LeaderboardEntry {
  userId: string;
  userName: string;
  correctAnswers: number;
  totalAnswers: number;
  accuracy: number;
}

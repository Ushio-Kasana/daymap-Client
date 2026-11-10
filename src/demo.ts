import type { AssessmentTask, Dashboard, DaymapMessage, DiaryItem, DaymapUser } from "./types";

// Everything in this file is invented for the signed-out preview. No real
// school, teacher, class, student or message content belongs here: preview
// data is shipped inside the desktop binaries and is visible to anyone who
// opens the app before signing in.

const FIRST_NAMES = ["Ari", "Jules", "Remy", "Noor", "Kit", "Sage", "Marlow", "Quinn"];
const LAST_NAMES = ["Hollis", "Vance", "Okafor", "Lindqvist", "Moreau", "Rivas", "Tanaka", "Bennett"];
const TEACHERS = [
  "A. Hollis",
  "J. Okafor",
  "R. Lindqvist",
  "M. Moreau",
  "S. Rivas",
  "K. Tanaka",
  "D. Ferreira",
];
const CLASSES = [
  { name: "English 2A", code: "ENG2A" },
  { name: "Mathematics 2B", code: "MAT2B" },
  { name: "Visual Arts A", code: "ART1A" },
  { name: "Health and Wellbeing", code: "HWB2A" },
  { name: "Digital Technologies", code: "DIG1B" },
  { name: "Science 1C", code: "SCI1C" },
];
const TASK_NAMES = [
  "Research task — final draft",
  "Folio and statement of intent",
  "Progress check",
  "Investigation report",
  "Reflection journal",
  "Group presentation",
];
const MESSAGE_SUBJECTS = [
  "Room change for today",
  "Assessment reminder",
  "Excursion permission note",
  "Draft feedback",
  "Library booking",
  "Uniform and equipment",
  "Re: group task",
];
const MESSAGE_BODIES = [
  "<p>This is a reminder to meet in the breakout room for today's session.</p><p>Bring your draft and any questions.</p>",
  "<p>The assessment is due at the end of next week.</p><p>Please ask if anything is unclear.</p>",
  "<p>Permission notes are due back at the front office by Friday.</p>",
  "<p>Thanks for sending that through — the feedback is attached.</p>",
  "<p>The library is booked for our lesson on Thursday.</p>",
  "<p>Make sure you bring the required equipment to the next class.</p>",
  "<p>No problem — see you then.</p>",
];
const NOTICE_SUBJECTS = [
  "Student bulletin — volunteers wanted",
  "Awareness day this Friday",
  "Excursion reminder",
  "Timetable changes next week",
];
const NOTICE_BODIES = [
  "<p>Students interested in helping at the showcase should sign up at student services.</p>",
  "<p>Join the activities at lunchtime near the courtyard.</p>",
  "<p>A reminder that the excursion is this Wednesday. Bring a packed lunch.</p>",
  "<p>Some lessons have moved rooms for next week; check the updated timetable.</p>",
];
const ATTENDANCE_NOTES = ["Arrived a few minutes late", "Medical appointment", "School event"];

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function at(days: number, hour: number, minute = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:00`;
}

function task(
  id: number,
  name: string,
  className: string,
  type: string,
  teacherName: string,
  dueDate: string,
  options: Partial<AssessmentTask> = {},
): AssessmentTask {
  return {
    id,
    name,
    className,
    classCode: className,
    type,
    teacherName,
    status: "Work has not been received",
    overdue: false,
    graded: false,
    marked: false,
    maxMark: null,
    dueDate,
    setDate: at(-7, 9),
    workReceived: null,
    ...options,
  };
}

function message(
  id: number,
  subject: string,
  senderName: string,
  sentOn: string,
  text: string,
  options: Partial<DaymapMessage> = {},
): DaymapMessage {
  return {
    id,
    subject,
    senderName,
    sentOn,
    text,
    threadCount: 1,
    hasAttachments: false,
    read: true,
    sentTo: null,
    priority: 0,
    ...options,
  };
}

export function createDemoDashboard(): Dashboard {
  const person: DaymapUser = {
    username: "preview.student@example.com",
    schoolCode: "sample",
    schoolName: "Sample High School",
    daymapID: 4000 + Math.floor(Math.random() * 900),
    contactID: 50000 + Math.floor(Math.random() * 900),
    firstname: pick(FIRST_NAMES),
    surname: pick(LAST_NAMES),
  };

  const classes = shuffle(CLASSES).slice(0, 4);
  const teachers = shuffle(TEACHERS);
  const taskNames = shuffle(TASK_NAMES);
  const subjects = shuffle(MESSAGE_SUBJECTS);
  const bodies = shuffle(MESSAGE_BODIES);
  const sender = () => {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    return `${first} ${last.toUpperCase()}`;
  };

  const diary: DiaryItem[] = classes.flatMap((schoolClass, index) => [
    {
      id: 6000 + index * 2,
      title: `Home Group ${index + 1}`,
      start: at(0, 8, 45),
      finish: at(0, 8, 55),
      calendar: "Class Lessons",
      attendanceStatus: 2,
      type: 2,
    },
    {
      id: 6001 + index * 2,
      title: schoolClass.name,
      start: at(0, 9 + index, 0),
      finish: at(0, 10 + index, 0),
      calendar: "Class Lessons",
      attendanceStatus: Math.random() < 0.2 ? 3 : 2,
      attendanceReason: Math.random() < 0.2 ? pick(ATTENDANCE_NOTES) : null,
      type: 2,
      text:
        Math.random() < 0.4
          ? "<div class='lptitle'><a href='/daymap/attachment.ashx?ID=100000'>Lesson handout</a></div>"
          : null,
    },
  ]);

  const tasks: AssessmentTask[] = classes.map((schoolClass, index) =>
    task(
      9000 + index,
      taskNames[index % taskNames.length],
      schoolClass.name,
      pick(["Formative", "Summative", "Stage 1"]),
      pick(teachers),
      at(index === 2 ? -2 : index + 1, index === 2 ? 21 : 10),
      index === 2
        ? { overdue: true, graded: true, maxMark: 20, status: "Overdue. Work has not been received" }
        : index === 3
          ? { status: "Work has been received", workReceived: at(-1, 14) }
          : {},
    ),
  );

  const messages: DaymapMessage[] = Array.from({ length: 4 }, (_, index) =>
    message(
      8000 + index,
      subjects[index % subjects.length],
      index === 1 ? "Year Level Coordinator" : sender(),
      at(-index, 9 + index),
      bodies[index % bodies.length],
      {
        read: index > 1,
        sentTo: index === 0 ? "Everyone in your class" : null,
        hasAttachments: index === 1,
        threadCount: index === 3 ? 2 : 1,
      },
    ),
  );

  const notices: DaymapMessage[] = Array.from({ length: 3 }, (_, index) =>
    message(
      7000 + index,
      NOTICE_SUBJECTS[index % NOTICE_SUBJECTS.length],
      "Student Bulletin",
      at(-index, 20, 15),
      NOTICE_BODIES[index % NOTICE_BODIES.length],
      { read: false, threadCount: 0 },
    ),
  );

  return {
    user: person,
    tasks,
    messages,
    notices,
    diary,
    fetchedAt: new Date().toISOString(),
  };
}

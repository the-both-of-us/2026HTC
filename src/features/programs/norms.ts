/*
 * Published numbers about university degrees, shown beside our computed ones on the comparison
 * panel. Each has the page it came from and the day it was read. A number marked `derived` is our
 * arithmetic on sourced numbers, and says how. Never add a number without a URL.
 */
import type { SourcedNorm, SourcedReference } from "./types";

const READ_ON = "2026-11-11";

/** True for a psychology program or course, where the psychology-specific norms apply. */
export function isPsychology(...titles: string[]): boolean {
  return titles.some((title) => /psycholog/i.test(title));
}

/** Norms for any degree: how big a degree and a course are. */
export const GENERAL_NORMS: readonly SourcedNorm[] = [
  {
    id: "calgary-ba-courses",
    label: "Half-courses in a four-year BA at the University of Calgary",
    value: 40,
    unit: "courses",
    source: "University of Calgary",
    url: "https://calendar.ucalgary.ca/programs/PSYCBA",
    retrievedOn: READ_ON,
    derived: "120 units for the BA / 3 units a half-course",
  },
  {
    id: "bishops-contact-hours",
    label: "Contact hours in a 3-credit course, at least",
    value: 36,
    unit: "hours",
    source: "Bishop's University",
    url: "https://www.ubishops.ca/wp-content/uploads/05-Programs-and-Courses-2026-2027.pdf",
    retrievedOn: READ_ON,
  },
  {
    id: "calgary-contact-hours",
    label: "Lecture hours in a Calgary half-course",
    value: 39,
    unit: "hours",
    source: "University of Calgary",
    url: "https://ucalgary.ca/pubs/calendar/archives/2016/course-how-to-use.html",
    retrievedOn: READ_ON,
    derived: "3 lecture hours a week x 13 weeks",
  },
  {
    id: "mcgill-study-ratio",
    label: "Hours of personal study expected per contact hour",
    value: 2,
    unit: "hours",
    source: "McGill University",
    url: "https://coursecatalogue.mcgill.ca/en/regulations/undergraduate/student-records/credit-system/",
    retrievedOn: READ_ON,
  },
  {
    id: "baylor-study-ratio",
    label: "Hours of out-of-class work per 50 minutes in class, approximately",
    value: 2,
    unit: "hours",
    source: "Baylor University",
    url: "https://risk.web.baylor.edu/public/documents/credit-hours-and-instructional-time/view",
    retrievedOn: READ_ON,
  },
  {
    id: "intro-course-total-hours",
    label: "Total hours of work in one half-course",
    value: 117,
    unit: "hours",
    source: "University of Calgary and McGill University",
    url: "https://ucalgary.ca/pubs/calendar/archives/2016/course-how-to-use.html",
    retrievedOn: READ_ON,
    derived: "39 lecture hours (Calgary) + 2 study hours per contact hour (McGill): 39 x 3",
  },
];

/** Norms that only apply to a psychology degree. */
export const PSYCHOLOGY_NORMS: readonly SourcedNorm[] = [
  {
    id: "calgary-psych-courses",
    label: "Psychology half-courses in a Calgary BA (Psychology)",
    value: 15,
    valueMax: 20,
    unit: "courses",
    source: "University of Calgary",
    url: "https://calendar.ucalgary.ca/programs/PSYCBA/program-details-krhha",
    retrievedOn: READ_ON,
    derived: "45 to 60 units in Psychology / 3 units a half-course",
  },
  {
    id: "openstax-psychology-chapters",
    label: "Chapters in OpenStax Psychology 2e, written for a one-term intro course",
    value: 16,
    unit: "chapters",
    source: "OpenStax",
    url: "https://openstax.org/books/psychology-2e/pages/preface",
    retrievedOn: READ_ON,
  },
];

/** The chapters of OpenStax Psychology 2e, to set our intro course's unit titles beside. */
export const OPENSTAX_PSYCHOLOGY: SourcedReference = {
  title: "OpenStax Psychology 2e",
  url: "https://openstax.org/books/psychology-2e/pages/preface",
  retrievedOn: READ_ON,
  items: [
    "Introduction to Psychology",
    "Psychological Research",
    "Biopsychology",
    "States of Consciousness",
    "Sensation and Perception",
    "Learning",
    "Thinking and Intelligence",
    "Memory",
    "Lifespan Development",
    "Motivation and Emotion",
    "Personality",
    "Social Psychology",
    "Industrial-Organizational Psychology",
    "Stress, Lifestyle, and Health",
    "Psychological Disorders",
    "Therapy and Treatment",
  ],
};

/** The norms to show for a program: the general ones, plus psychology's for a psychology program. */
export function normsFor(programTitle: string): SourcedNorm[] {
  return [...GENERAL_NORMS, ...(isPsychology(programTitle) ? PSYCHOLOGY_NORMS : [])];
}

/** A sourced outline for the same subject as this course, or null. Only an intro psychology course has one. */
export function referenceFor(programTitle: string, courseTitle: string): SourcedReference | null {
  const intro = /\b(intro|introduction|introductory|foundations?|principles|survey)\b|\b1\d\d\b/i.test(courseTitle);
  return intro && isPsychology(programTitle, courseTitle) && isPsychology(courseTitle) ? OPENSTAX_PSYCHOLOGY : null;
}

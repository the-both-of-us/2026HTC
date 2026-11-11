import {
  catalogKeys,
  claimCourse,
  findCourseByName,
  getCatalogCourse,
  getFinalSyllabus,
  getProgramSeed,
  readCatalogProgram,
  resolveCourses,
  titleKey,
  type CatalogCourse,
  type CatalogProgram,
  type CatalogProgramCourse,
  type ProgramPart,
  type SyllabusPart,
} from "@/features/catalog";
import { discardUnitNodes, ensureUnitNodes, type UnitNodesResult } from "@/features/skill-map";
import { streamSyllabus, type SyllabusContext, type SyllabusCourseInfo } from "@/features/syllabus";
import { startOnce, type OnceContext } from "@/shared/store/once";
import { SYLLABUS_SHAPE, type CourseSyllabus } from "@/shared/types";
import { streamFrame } from "./plan";

/*
 * Canonical generation, shared by everyone: a program's frame and a course's syllabus (plus its
 * unit 1). Plain async functions, each guarded by `startOnce`, so a route's `after()`, a second
 * viewer and the offline script all call the same thing and nothing is generated twice.
 */

/** Course lines wait for one batch resolve call until this many are pending... */
export const REGISTER_BATCH = 10;
/** ...or this long after the first pending one. */
export const REGISTER_WAIT_MS = 3_000;

export type EnsureResult = "ready" | "running" | "built";

/**
 * Registers streamed course lines in the catalog. Each line first tries an exact name lookup
 * (no call); unmatched lines wait for one `resolveCourses` call (10 pending, 3 s after the first,
 * or the end). A match keeps its own home and syllabus; no match makes a new CatalogCourse whose
 * home is this program. Every result is emitted as a "registered" part, which turns Start on.
 */
class Registrar {
  private pending: CatalogProgramCourse[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly work: Promise<void>[] = [];
  private readonly used = new Set<string>();
  readonly courseIds = new Map<string, string>();

  constructor(
    private readonly programId: string,
    private readonly audience: string,
    private readonly deadline: number,
    private readonly emit: (part: ProgramPart) => Promise<void>,
  ) {}

  add(course: CatalogProgramCourse): void {
    this.work.push(
      (async () => {
        const found = await findCourseByName(course.title, this.audience).catch(() => null);
        if (found && !this.used.has(found)) await this.register(course.slug, found);
        else this.queue(course);
      })(),
    );
  }

  private queue(course: CatalogProgramCourse): void {
    this.pending.push(course);
    if (this.pending.length >= REGISTER_BATCH) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), REGISTER_WAIT_MS);
  }

  private flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.pending;
    this.pending = [];
    if (batch.length > 0) this.work.push(this.resolveBatch(batch));
  }

  private async resolveBatch(batch: CatalogProgramCourse[]): Promise<void> {
    const results = await resolveCourses(batch, { audience: this.audience, deadline: this.deadline });
    for (const [index, course] of batch.entries()) {
      const result = results[index];
      if (result?.status === "found" && !this.used.has(result.courseId)) {
        await this.register(course.slug, result.courseId);
        continue;
      }
      const claim = await claimCourse({
        text: course.title,
        audience: this.audience,
        title: course.title,
        summary: course.summary,
        level: course.level,
        area: course.area,
        home: { programId: this.programId, slug: course.slug },
      });
      await this.register(course.slug, claim.id);
    }
  }

  private async register(slug: string, courseId: string): Promise<void> {
    this.used.add(courseId);
    this.courseIds.set(slug, courseId);
    await this.emit({ kind: "registered", slug, courseId });
  }

  /** Resolves what is still pending and waits for every registration. */
  async finish(): Promise<void> {
    // New work can be queued while earlier work runs, so loop until nothing is left.
    for (let seen = 0; seen < this.work.length || this.pending.length > 0; ) {
      this.flush();
      const batch = this.work.slice(seen);
      seen = this.work.length;
      await Promise.all(batch);
    }
  }
}

async function planFrame(programId: string, once: OnceContext<ProgramPart>, deadline: number): Promise<CatalogProgram> {
  const seed = await getProgramSeed(programId);
  if (!seed) throw new Error(`program ${programId} has no seed`);
  const registrar = new Registrar(programId, seed.audience, deadline, (part) => once.emit(part));
  let head = { title: seed.title, summary: seed.summary };
  try {
    const builder = await streamFrame(seed, {
      deadline,
      onHead: async (h) => {
        head = { title: h.title || seed.title, summary: h.summary || seed.summary };
        await once.emit({ kind: "head", ...head });
      },
      onCourse: async (course) => {
        await once.emit({ kind: "course", course });
        registrar.add(course);
      },
    });
    await registrar.finish();
    return {
      id: programId,
      title: head.title,
      summary: head.summary,
      audience: seed.audience,
      depth: seed.depth,
      status: "ready",
      courses: builder.ordered().map((course) => {
        const courseId = registrar.courseIds.get(course.slug);
        return courseId ? { ...course, courseId } : course;
      }),
      createdAt: seed.createdAt,
    };
  } finally {
    // Never leave registrations running after a failure.
    await registrar.finish().catch(() => {});
  }
}

/**
 * Plans the catalog program's frame once. "ready": it already was; "running": someone else is
 * planning it; "built": this call planned it. Throws the planner's error when this call failed
 * (the claim is cleaned up, so the next call starts over).
 */
export async function ensureProgramPlanned(programId: string, options: { deadline: number }): Promise<EnsureResult> {
  const started = await startOnce<CatalogProgram, ProgramPart>(catalogKeys.program(programId), (once) =>
    planFrame(programId, once, options.deadline),
  );
  if (started === "ready" || started === "running") return started;
  await started.work;
  return "built";
}

const courseInfo = (course: CatalogProgramCourse): SyllabusCourseInfo => ({
  slug: course.slug,
  title: course.title,
  summary: course.summary,
  requires: [...course.requires],
  ...(course.year !== undefined && { year: course.year }),
  ...(course.term !== undefined && { term: course.term }),
  ...(course.level !== undefined && { level: course.level }),
  ...(course.area !== undefined && { area: course.area }),
});

/** A slug for a course first asked for alone. */
const standaloneSlug = (title: string) => titleKey(title).slice(0, 40).replace(/-+$/, "") || "course";

/**
 * What the syllabus call needs, from the course's home program: the frame, the final syllabi of
 * the courses it requires (for `buildsOn`), and the topic titles of every sibling course that has
 * one (for the overlap drop). A course with no home is planned on its own.
 */
export async function syllabusContextFor(course: CatalogCourse): Promise<SyllabusContext> {
  const home = course.homeProgramId ? await readCatalogProgram(course.homeProgramId) : null;
  const own = home?.program.courses.find((line) => line.slug === course.homeSlug);
  if (!home || !own) {
    const info: SyllabusCourseInfo = {
      slug: standaloneSlug(course.title),
      title: course.title,
      summary: course.summary,
      requires: [],
      ...(course.level !== undefined && { level: course.level }),
      ...(course.area !== undefined && { area: course.area }),
    };
    return { courseId: course.id, programTitle: course.title, ...(course.audience && { audience: course.audience }), course: info, frame: [info], required: [], siblings: [] };
  }

  const others = home.program.courses.filter((line) => line.slug !== own.slug && line.courseId && line.courseId !== course.id);
  const syllabi = await Promise.all(others.map((line) => getFinalSyllabus(line.courseId!).catch(() => null)));
  const required: CourseSyllabus[] = [];
  const siblings: SyllabusContext["siblings"] = [];
  others.forEach((line, index) => {
    const syllabus = syllabi[index];
    if (!syllabus) return;
    // Seen from this program, the course's slug is its slug here, whatever its own home called it.
    if (own.requires.includes(line.slug)) required.push({ ...syllabus, courseSlug: line.slug });
    siblings.push({ slug: line.slug, topics: syllabus.units.flatMap((unit) => unit.topics.map((topic) => topic.title)) });
  });
  return {
    courseId: course.id,
    programTitle: home.program.title,
    ...(course.audience && { audience: course.audience }),
    course: courseInfo(own),
    frame: home.program.courses.map(courseInfo),
    required,
    siblings,
  };
}

/** Unit 1 needs this much time left to start (the unit call's own budget). */
export const UNIT_BUILD_MS = 60_000;

function buildUnit1(course: CatalogCourse, programTitle: string, syllabus: CourseSyllabus, deadline: number): Promise<UnitNodesResult | null> {
  if (deadline - Date.now() < UNIT_BUILD_MS) return Promise.resolve({ status: "no-time" });
  return ensureUnitNodes({
    contentId: course.id,
    unitId: "u1",
    syllabus,
    course: { title: course.title, audience: course.audience, ...(programTitle !== course.title && { programTitle }) },
    deadline,
  }).catch((error) => {
    console.warn(`[programs] unit 1 of ${course.id} failed: ${error instanceof Error ? error.name : "unknown"}`);
    return null;
  });
}

export type CourseBuildResult = { syllabus: EnsureResult; unit1: UnitNodesResult | null };

/**
 * Builds a catalog course once: its syllabus as JSON Lines (each unit saved and shown as it
 * arrives), and unit 1's nodes, started the moment unit 1 commits so it is ready about 30 s
 * sooner. When the syllabus already exists, only unit 1 is ensured. Throws the syllabus error
 * when this call failed to write it.
 */
export async function ensureCourseBuilt(courseId: string, options: { deadline: number }): Promise<CourseBuildResult> {
  const course = await getCatalogCourse(courseId);
  if (!course) throw new Error(`catalog course ${courseId} not found`);
  let programTitle = course.title;
  let unit1: Promise<UnitNodesResult | null> | null = null;

  const started = await startOnce<CourseSyllabus, SyllabusPart>(catalogKeys.syllabus(courseId), async (once) => {
    const ctx = await syllabusContextFor(course);
    programTitle = ctx.programTitle;
    const assessment = { unitTests: SYLLABUS_SHAPE.degree.unitTests, finalQuestions: SYLLABUS_SHAPE.degree.finalQuestions };
    return streamSyllabus(ctx, {
      deadline: options.deadline,
      onHead: (outcomes) =>
        once.emit({ kind: "head", outcomes, courseSlug: ctx.course.slug, ...(ctx.course.level && { level: ctx.course.level }), assessment }),
      onUnit: async (unit, soFar) => {
        await once.emit({ kind: "unit", unit });
        if (unit.id === "u1" && !unit1) {
          // The first unit is in: write it out now so viewers see it, then build its nodes in parallel.
          await once.flush();
          unit1 = buildUnit1(course, programTitle, soFar, options.deadline);
        }
      },
      onRestart: () => once.restart(),
    });
  });

  if (started === "running") return { syllabus: "running", unit1: null };
  if (started === "ready") {
    const syllabus = await getFinalSyllabus(courseId);
    if (!syllabus) return { syllabus: "ready", unit1: null };
    const home = course.homeProgramId ? await readCatalogProgram(course.homeProgramId) : null;
    return { syllabus: "ready", unit1: await buildUnit1(course, home?.program.title ?? course.title, syllabus, options.deadline) };
  }
  try {
    await started.work;
  } catch (error) {
    const pipelined = unit1 as Promise<UnitNodesResult | null> | null;
    if (pipelined) {
      // Unit 1 was built from a syllabus that then failed; the next syllabus may plan other topics.
      const built = await pipelined;
      if (built?.status === "ready") await discardUnitNodes(courseId, "u1").catch(() => {});
    }
    throw error;
  }
  return { syllabus: "built", unit1: unit1 ? await unit1 : null };
}

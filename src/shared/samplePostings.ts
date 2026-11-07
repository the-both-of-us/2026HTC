/**
 * Sample job postings for the landing page and the demo. Written for OryxLearn in
 * our own words; they are not real listings and name no employer. The UI must
 * always mark them as sample text.
 */
export type SamplePosting = {
  id: string;
  /** Short name for the sample's button. */
  label: string;
  text: string;
};

export const SAMPLE_POSTINGS: SamplePosting[] = [
  {
    id: "data-analyst-grid",
    label: "Data Analyst, grid operations",
    text: `Data Analyst, Grid Operations
Calgary, AB (hybrid, three days a week in the downtown office)

Our grid operations group keeps electricity moving across Alberta, and it runs on data. We need an analyst who can turn hourly load, generation and outage records into reports that control room staff trust at 6 a.m.

What you will do
- Write SQL queries against our historian and outage databases, including joins across hourly and five-minute tables.
- Clean time-series data: find gaps, handle meter errors, and deal with daylight saving changes.
- Build and maintain Power BI dashboards for operators and planners.
- Compare forecast load with actual load and explain the largest misses in plain language.
- Document every metric so another analyst can reproduce it.

What you bring
- Strong SQL, and working knowledge of Python with pandas.
- An understanding of basic statistics, including mean absolute error and seasonality.
- Familiarity with how supply and demand are balanced on a power grid. We will teach you the Alberta market rules.
- Clear writing for people who are not analysts.

Nice to have: experience with SCADA data or weather data.`,
  },
  {
    id: "junior-backend",
    label: "Junior Backend Developer",
    text: `Junior Backend Developer
Calgary, AB (hybrid)

We build scheduling and invoicing software for trades businesses across Western Canada. Our small product team is hiring its first junior developer, and you will have a senior developer reviewing your work every day.

What you will do
- Build and test REST API endpoints in TypeScript on Node.js.
- Design PostgreSQL tables, write migrations, and add indexes when queries slow down.
- Write automated tests with every change, and fix the bugs that your tests find.
- Use transactions so that an invoice and its payment records are never left half saved.
- Review logs to trace production errors back to their cause.
- Handle authentication and input validation carefully, because we store customer data.

What you bring
- One year of building software, through work, school, a bootcamp or your own projects.
- Comfort with Git, including branches and pull requests.
- A working understanding of HTTP: methods, status codes and how caching headers behave.
- Basic SQL, including joins and aggregates.
- Willingness to ask questions early and to explain your reasoning in code review.

Nice to have: experience with Docker or a queue for background jobs.`,
  },
  {
    id: "instrumentation-renewables",
    label: "Instrumentation Technician, renewables",
    text: `Instrumentation Technician, Renewable Energy
Based in Calgary, AB, with regular travel to wind and solar sites in southern Alberta

Our operations team looks after wind and solar sites across southern Alberta. We are looking for an instrumentation technician from oil and gas or industrial plants who wants to move into renewables. You already know field instruments; we will teach you how turbines and inverters work.

What you will do
- Calibrate, troubleshoot and replace pressure, temperature and vibration sensors on turbines and at substations.
- Trace 4-20 mA loops and Modbus signals from the field device to the SCADA system.
- Read and mark up P&IDs, loop diagrams and electrical schematics.
- Follow lockout and tagout procedures, and work safely at height.
- Use SCADA trends to find failing equipment before it causes downtime.
- Write clear work orders and calibration records in our maintenance system.

What you bring
- An Instrumentation and Control Technician journeyperson certificate, or Red Seal.
- Experience with PLC basics, including reading ladder logic.
- A valid Class 5 driver's licence.
- Current safety training, or a willingness to complete fall protection and arc flash training.

Nice to have: experience with solar inverters or wind turbine controllers.`,
  },
];

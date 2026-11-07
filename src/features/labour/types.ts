export type LabourPoint = {
  label: string;
  /** Value as StatCan published it. */
  value: number;
  /** Month the number describes, e.g. "2026-10". */
  period: string;
  /** Vector id, so anyone can look the series up on statcan.gc.ca. */
  vectorId: number;
};

export type WagePoint = LabourPoint & {
  occupation: string;
  /** StatCan data-quality code, passed through unchanged. */
  qualityCode: number;
};

export type LabourSnapshot = {
  /** Seasonally adjusted unemployment rate, percent. */
  unemployment: { canada: LabourPoint; alberta: LabourPoint; calgary: LabourPoint | null };
  /** Calgary average offered hourly wage in dollars; empty if that call failed. */
  wages: WagePoint[];
  /** Latest reference period of the headline series, e.g. "October 2026". */
  referencePeriod: string;
  wagePeriod: string | null;
  source: { name: string; url: string };
  retrievedAt: string;
  /** True when this is the last good copy because StatCan did not answer. */
  stale: boolean;
};

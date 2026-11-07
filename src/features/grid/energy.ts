const ENERGY_WORDS =
  /\b(energy sector|energy|electricity|power grid|electrical grid|grid operations?|aeso|renewables?|wind farms?|wind turbines?|solar|substations?|scada|power plants?|power generation|power systems?|transmission lines?)\b/i;

/** Does this posting look energy related? Decides whether a skill map shows the live grid card. */
export function isEnergyRelated(text: string): boolean {
  return ENERGY_WORDS.test(text);
}

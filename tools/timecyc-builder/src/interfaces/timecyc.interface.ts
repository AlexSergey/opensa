/** A merge source file + its selective filters. Any omitted dimension means "all" on that axis. */
export interface TimecycItem {
  path: string;
  /** Property labels to overlay (e.g. `'Sky top'`); omitted ⇒ all properties. */
  props?: readonly string[];
  /** Hours to overlay (`'0h'..'23h'`); omitted ⇒ all hours. */
  times?: readonly string[];
  /** Weather names to overlay (e.g. `'CLOUDY_VEGAS'`); omitted ⇒ all weathers. */
  zones?: readonly string[];
}

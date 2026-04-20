/**
 * Conditional Call Detector
 *
 * Given file content and a line number where an outbound call was found,
 * scans the surrounding lines (up to LOOK_BACK lines above) to detect whether
 * the call is inside a conditional block.
 *
 * Detects:
 *   if / else if / elif / else
 *   switch / case
 *   ternary (? ... :)
 *   try / catch / except
 *   guard clauses (Go: if err != nil)
 *   logical short-circuit (&&, ||) used as conditional execution
 */

export interface ConditionalResult {
  conditional: boolean;
  /** Raw condition text (best-effort, single line) */
  conditionHint?: string;
}

/** Number of lines above the call to inspect */
const LOOK_BACK = 6;

/**
 * Patterns that indicate a call is inside a conditional branch.
 * Each entry: [regex to match the line, label for conditionHint prefix]
 */
const CONDITIONAL_PATTERNS: Array<[RegExp, string]> = [
  // if (...) / if condition: / if err != nil
  [/^\s*(?:if|} else if|else if|elif)\s+(.+?)(?:\s*\{|:|\s*$)/, "if"],
  // else { / else: (bare else branch)
  [/^\s*\}\s*else\s*(?:\{|$)|^\s*else\s*:/, "else"],
  // switch (...) {
  [/^\s*switch\s*\((.+?)\)\s*\{/, "switch"],
  // case 'value': / case x =>
  [/^\s*case\s+(.+?)(?:\s*:|=>|\s*$)/, "case"],
  // ternary: condition ? ... — only flag if call is on same line or next
  [/(.+?)\s*\?\s*.+/, "ternary"],
  // try { / try:
  [/^\s*try\s*(?:\{|:)/, "try"],
  // catch / except
  [/^\s*(?:catch|except)\s*(?:\(.*\))?\s*(?:\{|:)?/, "catch"],
  // Go guard: if err != nil / if ok {
  [/^\s*if\s+(err\s*!=\s*nil|ok\b|!ok\b|found\b|exists\b)/, "if"],
  // Logical AND short-circuit: condition && doCall()
  [/(.+?)\s*&&\s*$/, "&&"],
];

/**
 * Convenience: annotate an array of OutboundCall objects in-place.
 * Each call must have a `line` number. Pass the full file content.
 */
export function annotateConditionals(
  calls: Array<{ line?: number; conditional?: boolean; conditionHint?: string }>,
  fileContent: string,
): void {
  for (const call of calls) {
    if (!call.line) continue;
    const result = detectConditional(fileContent, call.line);
    if (result.conditional) {
      call.conditional = true;
      call.conditionHint = result.conditionHint;
    }
  }
}

export function detectConditional(fileContent: string, callLine: number): ConditionalResult {
  if (!callLine || callLine <= 0) return { conditional: false };

  const lines = fileContent.split("\n");
  // callLine is 1-based
  const callIdx = callLine - 1;

  // Collect the window: from (callIdx - LOOK_BACK) up to and including callIdx
  const start = Math.max(0, callIdx - LOOK_BACK);
  const window = lines.slice(start, callIdx + 1);

  // Walk backwards from the call line
  for (let i = window.length - 1; i >= 0; i--) {
    const line = window[i];

    for (const [pattern, label] of CONDITIONAL_PATTERNS) {
      const m = line.match(pattern);
      if (m) {
        // Build a readable hint
        const rawCondition = (m[1] ?? "").trim();
        const hint = rawCondition ? `${label} ${rawCondition}`.slice(0, 120) : label;
        return { conditional: true, conditionHint: hint };
      }
    }

    // If we hit a function/method definition boundary stop looking up
    if (isScopeBoundary(line)) break;
  }

  return { conditional: false };
}

/**
 * Returns true if a line looks like a function/method definition,
 * meaning we've crossed a scope boundary and should stop searching.
 */
function isScopeBoundary(line: string): boolean {
  return /^\s*(?:def |async def |func |fun |function |public |private |protected |internal |static |async function |export function |export async function |export default function )/.test(
    line,
  );
}

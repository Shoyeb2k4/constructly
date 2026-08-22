/**
 * This module used to hold a second `Field`.
 *
 * It rendered a `<Label>` with no `htmlFor` next to a control with no id — the
 * exact shape `components/patterns/field` was written to end, reintroduced
 * locally. Every field in the project create sheet and the per-section edit
 * sheets was therefore unlabelled, which no test caught: the label was on
 * screen, just not attached to anything.
 *
 * Keeping the module (rather than rewriting five files' imports) means the
 * fix lands everywhere at once and there is one Field again.
 */
export { Field } from "@/components/patterns/field";

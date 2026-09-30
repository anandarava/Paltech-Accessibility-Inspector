import type { JSX } from "react";
import type { Category } from "@shared/types";
import { Section, Fieldset, Checkbox, Button } from "./ui";

/** Every Category from shared/types.ts, in display order. */
export const CATEGORIES: Category[] = [
  "Images and Media",
  "Color and Contrast",
  "Forms",
  "Keyboard and Focus",
  "Page Structure and Semantics",
  "ARIA",
  "Links, Buttons, and Targets",
  "Responsiveness and Zoom",
  "Best Practice",
  "Other",
];

function slug(c: string): string {
  return c.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function CategoriesSection(props: { enabled: Category[]; onChange: (next: Category[]) => void }): JSX.Element {
  const { enabled, onChange } = props;
  const allSelected = enabled.length === 0;

  const toggle = (c: Category, checked: boolean): void => {
    if (allSelected) {
      // Moving from "all" to an explicit list: everything but the unticked one.
      onChange(checked ? [] : CATEGORIES.filter((x) => x !== c));
      return;
    }
    const next = checked ? [...enabled, c] : enabled.filter((x) => x !== c);
    // Back to the canonical "all" representation when every category is ticked.
    onChange(next.length === CATEGORIES.length ? [] : CATEGORIES.filter((x) => next.includes(x)));
  };

  return (
    <Section
      id="categories"
      title="Categories"
      description="Limit scans to specific categories. Leaving every category ticked scans everything."
    >
      <Fieldset legend="Categories to scan">
        <div className="grid gap-2 sm:grid-cols-2">
          {CATEGORIES.map((c) => (
            <Checkbox
              key={c}
              id={`category-${slug(c)}`}
              label={c}
              checked={allSelected || enabled.includes(c)}
              onChange={(v) => toggle(c, v)}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={() => onChange([])} disabled={allSelected}>
            Select all
          </Button>
        </div>
        <p className="text-xs text-slate-500" aria-live="polite">
          {allSelected ? "All categories are scanned." : `${enabled.length} of ${CATEGORIES.length} categories selected.`}
        </p>
      </Fieldset>
    </Section>
  );
}

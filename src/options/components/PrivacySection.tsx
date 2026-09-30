import type { JSX } from "react";
import type { Settings } from "@shared/types";
import { Section, Fieldset, Checkbox, TextArea } from "./ui";

/** Parse a "one selector per line" textarea into a clean list. */
export function parseSelectorLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export function PrivacySection(props: {
  settings: Settings;
  redactText: string;
  onRedactTextChange: (text: string) => void;
  onChange: (patch: Partial<Settings>) => void;
}): JSX.Element {
  const { settings, redactText, onRedactTextChange, onChange } = props;
  return (
    <Section
      id="privacy"
      title="Screenshots and privacy"
      description="Evidence screenshots are captured locally and only leave the browser inside reports you export."
    >
      <Fieldset legend="Redaction">
        <Checkbox
          id="mask-input-values"
          label="Mask input values in screenshots"
          hint="Text typed into form fields is blanked before the screenshot is cropped."
          checked={settings.maskInputValues}
          onChange={(v) => onChange({ maskInputValues: v })}
        />
        <TextArea
          id="redact-selectors"
          label="Selectors to blur (one per line)"
          value={redactText}
          onChange={onRedactTextChange}
          rows={5}
          placeholder={"[type=password]\n.pii"}
          hint="Elements matching these CSS selectors are covered in every screenshot. Invalid selectors are ignored at capture time."
        />
      </Fieldset>
    </Section>
  );
}

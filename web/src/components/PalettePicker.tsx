// The palette picker: one entry per palette in themes/palettes.json. A plain
// select, because the list keeps growing.

import { PALETTES } from "../theme";

export function PalettePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <select className="input" aria-label="Palette" value={value} onChange={(e) => onChange(e.target.value)}>
      {Object.entries(PALETTES).map(([id, palette]) => (
        <option key={id} value={id}>
          {palette.name}
        </option>
      ))}
    </select>
  );
}

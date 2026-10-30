// The palette picker. One entry per palette in themes/palettes.json, which is
// also where each palette's light and dark colours live.

import { PALETTES } from "../theme";
import { Segmented } from "./ui";

export function PalettePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const options = Object.entries(PALETTES).map(([id, palette]) => ({ value: id, label: palette.name }));
  return <Segmented size="sm" value={value} onChange={onChange} options={options} />;
}

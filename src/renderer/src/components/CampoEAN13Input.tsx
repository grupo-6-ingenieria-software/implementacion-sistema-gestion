import type { ReactElement } from 'react';

type CampoEAN13InputProps = {
  value: string;
  onChange: (value: string) => void;
};

export function CampoEAN13Input({
  value,
  onChange,
}: CampoEAN13InputProps): ReactElement {
  return (
    <input
      className="w-full rounded-md border border-[#9ba9b5] px-3 py-2"
      inputMode="numeric"
      maxLength={13}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

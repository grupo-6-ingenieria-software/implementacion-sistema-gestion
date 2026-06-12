import type { ReactElement } from 'react';

type CampoEAN13InputProps = {
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
};

export function CampoEAN13Input({
  disabled = false,
  value,
  onChange,
}: CampoEAN13InputProps): ReactElement {
  return (
    <input
      className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 disabled:bg-[#edf1f5] disabled:text-[#61717f]"
      disabled={disabled}
      inputMode="numeric"
      maxLength={13}
      value={value}
      onChange={(event) =>
        onChange(event.target.value.replace(/\D/g, '').slice(0, 13))
      }
    />
  );
}

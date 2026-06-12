import type { ReactElement } from 'react';
import { isValidEan13, normalizeEan13 } from '../../../shared/ean13';

type CampoEAN13InputProps = {
  value: string;
  onChange: (value: string) => void;
  onValidSubmit?: (value: string) => void;
};

export function CampoEAN13Input({
  value,
  onChange,
  onValidSubmit,
}: CampoEAN13InputProps): ReactElement {
  const normalized = normalizeEan13(value);
  const isComplete = normalized.length === 13;
  const hasError = isComplete && !isValidEan13(normalized);

  return (
    <div>
      <input
        aria-invalid={hasError}
        className={`w-full rounded-md border px-3 py-2 ${
          hasError ? 'border-[#b42318]' : 'border-[#9ba9b5]'
        }`}
        inputMode="numeric"
        maxLength={13}
        placeholder="EAN-13"
        value={value}
        onChange={(event) => onChange(normalizeEan13(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && isValidEan13(normalized)) {
            onValidSubmit?.(normalized);
          }
        }}
      />
      {hasError ? (
        <p className="mt-1 text-xs font-medium text-[#b42318]">
          El EAN-13 ingresado no es válido.
        </p>
      ) : null}
    </div>
  );
}

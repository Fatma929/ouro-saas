import React from 'react';

export const OURO_LOGO_SRC = '/assets/aistudio/6-lNdqMIRhG7Ko1BNWf5mA_2k__1__c39476bb.webp';

interface OuroLogoProps {
  variant?: 'light' | 'dark';
  size?: 'sm' | 'md' | 'lg';
  layout?: 'horizontal' | 'stacked';
  showTagline?: boolean;
  tagline?: string;
  className?: string;
}

export const OuroLogo: React.FC<OuroLogoProps> = ({
  variant = 'dark',
  size = 'md',
  layout = 'horizontal',
  showTagline = false,
  tagline = 'Closing the Loop, Digitizing the Value',
  className = '',
}) => {
  if (layout === 'stacked') {
    const boxSize = size === 'lg' ? 'w-56 h-56' : size === 'sm' ? 'w-28 h-28' : 'w-40 h-40';
    return (
      <div
        className={`relative overflow-hidden rounded-2xl bg-[#272F31] shrink-0 ${boxSize} ${className}`}
      >
        <img
          src={OURO_LOGO_SRC}
          alt="OURO — Closing the Loop, Digitizing the Value"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover select-none"
          style={{
            transform: 'scale(1.62)',
            transformOrigin: '50% 50%',
          }}
        />
      </div>
    );
  }

  const iconBox =
    size === 'lg'
      ? 'w-12 h-12 rounded-xl'
      : size === 'sm'
      ? 'w-9 h-9 rounded-lg'
      : 'w-10 h-10 rounded-xl';

  const titleClass =
    size === 'lg'
      ? 'text-2xl font-extrabold tracking-[0.14em]'
      : size === 'sm'
      ? 'text-base font-extrabold tracking-[0.14em]'
      : 'text-xl font-extrabold tracking-[0.14em]';

  return (
    <div className={`inline-flex items-center gap-3 shrink-0 ${className}`}>
      <div
        className={`relative overflow-hidden bg-[#272F31] shrink-0 ring-1 ${
          variant === 'light' ? 'ring-[#A88B64]/35' : 'ring-[#272F31]/15 shadow-xs'
        } ${iconBox}`}
      >
        <img
          src={OURO_LOGO_SRC}
          alt="OURO Logo Emblem"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover select-none"
          style={{
            transform: 'scale(3.05) translateY(10.1%)',
            transformOrigin: '50% 50%',
          }}
        />
      </div>
      <div className="leading-tight">
        <span
          className={`block whitespace-nowrap ${titleClass} ${
            variant === 'dark' ? 'text-[#272F31]' : 'text-[#FBFCFD]'
          }`}
        >
          OURO
        </span>
        {showTagline && (
          <span
            className={`block text-[11px] font-medium tracking-wide mt-0.5 ${
              variant === 'dark' ? 'text-[#546164]' : 'text-[#C4A87E]'
            }`}
          >
            {tagline}
          </span>
        )}
      </div>
    </div>
  );
};

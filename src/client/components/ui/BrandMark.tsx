import React, { useState } from 'react';

/** The office's logo, or the "H" mark (in the office colour) when there is none. */
export const BrandMark: React.FC<{ brand: { name: string; logoUrl?: string } | null; size?: 'sm' | 'lg'; className?: string }> = ({ brand, size = 'lg', className = '' }) => {
  const [broken, setBroken] = useState(false);
  const box = size === 'lg' ? 'h-10 max-w-[180px]' : 'h-6 pointer-fine:h-5 max-w-[96px]';
  if (brand?.logoUrl && !broken) {
    return <img src={brand.logoUrl} alt={`${brand.name} logo`} onError={() => setBroken(true)} className={`${box} w-auto object-contain object-left ${className}`} />;
  }
  const square = size === 'lg' ? 'w-8 h-8 text-sm rounded-md' : 'w-6 h-6 pointer-fine:w-5 pointer-fine:h-5 text-tiny rounded';
  const initial = brand?.name?.trim()?.[0]?.toUpperCase() ?? 'H';
  return (
    <span className={`${square} ${brand ? 'bg-accent text-on-accent' : 'bg-fg text-canvas'} font-bold flex items-center justify-center shrink-0 ${className}`} aria-hidden="true">
      {initial}
    </span>
  );
};

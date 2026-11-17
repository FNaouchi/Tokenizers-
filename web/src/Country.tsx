import { createContext, useContext } from 'react';
import type { ConfigInfo } from './api';

export type HighRiskCountries = ConfigInfo['high_risk_countries'];

export const HighRiskCountriesContext = createContext<HighRiskCountries>([]);

const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }) : null;

function nameFor(code: string): string | undefined {
  try {
    return regionNames?.of(code) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Country code with its name, for example "XB Belvaria". High-risk countries are marked; their names come from the config API. */
export function Country({ code }: { code: string | null }) {
  const highRisk = useContext(HighRiskCountriesContext);
  if (code === null) return <>—</>;
  const match = highRisk.find((c) => c.country_code === code);
  if (match) {
    return (
      <span className="country high-risk" title={`High-risk country: ${match.reason}`}>
        {match.country_code} {match.country_name} <span className="risk-mark">High risk</span>
      </span>
    );
  }
  const name = nameFor(code);
  return <span className="country">{name ? `${code} ${name}` : code}</span>;
}

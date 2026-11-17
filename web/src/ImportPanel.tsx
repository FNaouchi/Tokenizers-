import { api } from './api';
import { useApi } from './useApi';

const LABELS: [keyof import('./api').ImportReport, string][] = [
  ['rows_read', 'Rows read'],
  ['rows_loaded', 'Loaded'],
  ['duplicates_dropped', 'Duplicates dropped'],
  ['rows_rejected', 'Rejected'],
  ['missing_amount', 'Missing amount'],
  ['missing_country', 'Missing country'],
  ['country_normalised', 'Country code cleaned'],
  ['utc_timestamps', 'UTC timestamps converted'],
];

export function ImportPanel() {
  const report = useApi((signal) => api.importReport(signal), []);
  return (
    <details className="import-panel">
      <summary>Data quality: what the import did</summary>
      {report.error && <p className="error" role="alert">{report.error}</p>}
      {report.data && (
        <dl>
          {LABELS.map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{report.data![key]}</dd>
            </div>
          ))}
        </dl>
      )}
    </details>
  );
}

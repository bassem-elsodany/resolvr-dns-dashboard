// Query log entries only carry responseRtt for answered queries — a
// blocked query never reaches upstream, so there's no round-trip to
// measure and the field is absent.
export function formatRtt(rtt?: number): string {
  return rtt !== undefined ? `${rtt.toFixed(1)} ms` : "–"
}

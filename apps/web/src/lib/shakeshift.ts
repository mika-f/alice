const BASE_URL = "https://shakeshift.com";

export function shakeshiftTransactionUrl(txid: string): string {
  return `${BASE_URL}/transaction/${txid}`;
}

export function shakeshiftBlockUrl(height: number): string {
  return `${BASE_URL}/block/${height}`;
}

export function shakeshiftNameUrl(name: string): string {
  return `${BASE_URL}/name/${encodeURIComponent(name)}`;
}

/** Handshake targets a 10 minute block interval. */
export const AVERAGE_BLOCK_TIME_SECONDS = 10 * 60;

export function blocksRemaining(currentHeight: number, targetHeight: number): number {
  return Math.max(0, targetHeight - currentHeight);
}

export function estimateSecondsRemaining(blocks: number): number {
  return Math.max(0, blocks) * AVERAGE_BLOCK_TIME_SECONDS;
}

export function estimateDaysRemaining(blocks: number): number {
  return estimateSecondsRemaining(blocks) / (60 * 60 * 24);
}

export function expirationRatio(
  currentHeight: number,
  renewalHeight: number,
  expirationHeight: number,
): number {
  const total = expirationHeight - renewalHeight;
  if (total <= 0) return 1;
  const elapsed = currentHeight - renewalHeight;
  return Math.min(1, Math.max(0, elapsed / total));
}

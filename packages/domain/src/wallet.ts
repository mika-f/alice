export interface WalletBalance {
  confirmed: bigint;
  unconfirmed: bigint;
  locked: bigint;
  spendable: bigint;
}

export interface ReceiveAddress {
  address: string;
  index: number;
  used: boolean;
  label?: string;
}

export interface SendRequest {
  address: string;
  amount: bigint;
  feeRate?: number;
  label?: string;
  memo?: string;
  idempotencyKey: string;
}

export interface BroadcastResult {
  txid: string;
  fee: bigint;
}

export interface MnemonicImportInput {
  walletId: string;
  mnemonic: string;
  passphrase?: string;
}

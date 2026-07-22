import type {
  BroadcastResult,
  MnemonicImportInput,
  NameActionResult,
  NameDetails,
  OwnedName,
  ReceiveAddress,
  SendRequest,
  TransferNameRequest,
  TransactionPage,
  TransactionQuery,
  UpdateNameRequest,
  WalletBalance,
  WalletStatus,
} from "@alice-hns-wallet/domain";

export interface HandshakeWalletClient {
  getWalletStatus(): Promise<WalletStatus>;
  getBalance(): Promise<WalletBalance>;
  getTransactions(query: TransactionQuery): Promise<TransactionPage>;
  getReceiveAddress(): Promise<ReceiveAddress>;
  send(request: SendRequest): Promise<BroadcastResult>;
  /** Builds and estimates fee for the same request without broadcasting. */
  previewSend(request: SendRequest): Promise<BroadcastResult>;
  lock(): Promise<void>;
  unlock(passphrase: string, timeoutSeconds: number): Promise<void>;
  rescan(height: number): Promise<void>;
  createWalletFromMnemonic(input: MnemonicImportInput): Promise<void>;
  getNames(): Promise<OwnedName[]>;
  getName(name: string): Promise<NameDetails>;
  updateName(request: UpdateNameRequest): Promise<BroadcastResult>;
  renewName(name: string): Promise<BroadcastResult>;
  renewNames(names: string[]): Promise<NameActionResult[]>;
  transferName(request: TransferNameRequest): Promise<BroadcastResult>;
  finalizeName(name: string): Promise<BroadcastResult>;
  revokeName(name: string): Promise<BroadcastResult>;
}

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
  UpdatePreviewResult,
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
  /** Validates + builds the UPDATE tx without broadcasting; returns the real raw resource bytes hsd would commit. */
  previewUpdateName(request: UpdateNameRequest): Promise<UpdatePreviewResult>;
  updateName(request: UpdateNameRequest): Promise<BroadcastResult>;
  previewRenewName(name: string): Promise<BroadcastResult>;
  renewName(name: string): Promise<BroadcastResult>;
  /** Spec §17.3: sequential, per-name success/failure/skip — never an all-or-nothing batch. */
  renewNames(names: string[]): Promise<NameActionResult[]>;
  previewTransferName(request: TransferNameRequest): Promise<BroadcastResult>;
  transferName(request: TransferNameRequest): Promise<BroadcastResult>;
  previewFinalizeName(name: string): Promise<BroadcastResult>;
  finalizeName(name: string): Promise<BroadcastResult>;
  revokeName(name: string): Promise<BroadcastResult>;
}

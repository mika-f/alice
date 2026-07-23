import type {
  BidNameRequest,
  BroadcastResult,
  MnemonicImportInput,
  NameActionResult,
  NameAvailability,
  NameDetails,
  OwnedName,
  ReceiveAddress,
  SendRequest,
  TransferNameRequest,
  TransactionPage,
  TransactionQuery,
  TransactionRecord,
  UpdateNameRequest,
  UpdatePreviewResult,
  WalletBalance,
  WalletStatus,
} from "@alice-hns-wallet/domain";

export interface HandshakeWalletClient {
  getWalletStatus(): Promise<WalletStatus>;
  getBalance(): Promise<WalletBalance>;
  getTransactions(query: TransactionQuery): Promise<TransactionPage>;
  /** Single-tx lookup for watched-broadcast confirmation tracking; null when hsd no longer knows the txid (dropped/replaced). */
  getTransaction(txid: string): Promise<TransactionRecord | null>;
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
  /** Node-side lookup (spec §27.1) for a name this wallet may never have opened — not a wallet call. */
  getNameAvailability(name: string): Promise<NameAvailability>;
  previewOpenName(name: string): Promise<BroadcastResult>;
  openName(name: string): Promise<BroadcastResult>;
  previewBidName(request: BidNameRequest): Promise<BroadcastResult>;
  bidName(request: BidNameRequest): Promise<BroadcastResult>;
  previewRevealName(name: string): Promise<BroadcastResult>;
  revealName(name: string): Promise<BroadcastResult>;
  previewRedeemName(name: string): Promise<BroadcastResult>;
  redeemName(name: string): Promise<BroadcastResult>;
}

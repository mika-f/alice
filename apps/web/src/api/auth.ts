import type {
  LoginRequest,
  LoginResponse,
  LoginTotpRequest,
  ReauthRequest,
  RecoveryCodesResponse,
  SessionResponse,
  SetupRequest,
  TotpEnrollmentResponse,
} from "@alice-hns-wallet/schemas";
import { apiFetch } from "./client.js";

export function getSession(): Promise<SessionResponse> {
  return apiFetch<SessionResponse>("/api/auth/session");
}

export function setup(input: SetupRequest): Promise<{ username: string }> {
  return apiFetch("/api/auth/setup", { method: "POST", body: JSON.stringify(input) });
}

export function login(input: LoginRequest): Promise<LoginResponse> {
  return apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify(input) });
}

export function loginTotp(input: LoginTotpRequest): Promise<{ authenticated: boolean }> {
  return apiFetch("/api/auth/login/totp", { method: "POST", body: JSON.stringify(input) });
}

export function logout(): Promise<void> {
  return apiFetch("/api/auth/logout", { method: "POST" });
}

export function logoutAll(): Promise<void> {
  return apiFetch("/api/auth/logout-all", { method: "POST" });
}

export function reauth(input: ReauthRequest): Promise<{ reauthenticated: boolean }> {
  return apiFetch("/api/auth/reauth", { method: "POST", body: JSON.stringify(input) });
}

export function totpEnroll(): Promise<TotpEnrollmentResponse> {
  return apiFetch("/api/auth/totp/enroll", { method: "POST" });
}

export function totpVerify(code: string): Promise<RecoveryCodesResponse> {
  return apiFetch("/api/auth/totp/verify", { method: "POST", body: JSON.stringify({ code }) });
}

export function totpDisable(): Promise<void> {
  return apiFetch("/api/auth/totp/disable", { method: "POST" });
}

export function recoveryRegen(): Promise<RecoveryCodesResponse> {
  return apiFetch("/api/auth/recovery/regen", { method: "POST" });
}

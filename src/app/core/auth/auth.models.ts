// Shapes mirror commons-iam-service DTOs (Swagger: dev.platformcommons.org/gateway, commons-iam-service).
import { Affiliation } from '../config';

/** LoginRequestDTO — POST /api/v1/security/login */
export interface LoginRequest {
  userLogin: string;
  tenantLogin: string;
  password: string;
}

/** WrapperLoginRequestDTO — PATCH /api/v1/security/forget */
export interface ForgotPasswordRequest {
  userLogin: string;
  tenantLogin: string;
}

/** OTPRequestDTO — PATCH /api/v1/security/reset */
export interface ResetPasswordRequest {
  userLogin: string;
  tenantLogin: string;
  otpKey: string;
  otp: string;
  password: string;
}

/** LeadDTOReq — POST /signup/register (new org) and /signup/register/user (joiner). appContext + type required. */
export interface LeadRequest {
  id: 0;
  appContext: string;
  type: string;
  firstName: string;
  lastName?: string;
  leadContactPersonName: string;
  email: string;
  mobile?: string;
  organizationName: string;
  useMobileAsUserLogin: boolean;
}

/** OTPResponse */
export interface OtpResponse {
  key: string;
  messageId?: string;
  messageIdForEmail?: string;
  messageIdForMobile?: string;
}

/** SignUpRequestDTO — POST /signup/tenant and /signup/user/{tenant-login}/activate, password via X-PASS */
export interface SignUpRequest {
  key: string;
  otp: string;
  otpForEmail: string;
  messageId?: string;
  messageIdForEmail?: string;
  email: string;
  mobile?: string;
  preferredDomainName?: string;
  useMobileAsUserLogin: boolean;
}

/** TenantDTO (subset) */
export interface Tenant {
  id: number;
  tenantLogin: string;
  tenantName: string;
  tenantType?: string;
}

/** TenantVO — an organisation a login belongs to (GET /signup/exists) */
export interface TenantRef {
  id: number;
  login: string;
  name: string;
}

/** IAMUserDTO (subset) */
export interface IamUser {
  id: number;
  login: string;
}

/** UserVerificationDTO (subset) */
export interface UserVerification {
  id: number;
  userId: number;
  verificationStatus?: string;
}

/** PlatformToken (subset) — GET /api/v1/session/context */
export interface PlatformToken {
  tenantContext?: { tenantId: number; tenantLogin: string; tenantName: string };
  userContext?: { userId: number; username: string; name?: string; authorities?: string[] };
}

/** What the UI needs about the signed-in user. */
export interface CurrentUser {
  userId: number;
  name: string;
  userLogin: string;
  tenantLogin: string;
  tenantName: string;
  /** Derived from Tenant.tenantType; null when the tenant has neither granter nor grantee type. */
  affiliation: Affiliation | null;
  isOrgAdmin: boolean;
  /** False while a joiner is waiting for their org admin's approval. */
  approved: boolean;
}

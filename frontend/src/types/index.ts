import { z } from 'zod'


/** Auth */
type Auth = {
    name: string
    email: string
    current_password: string
    password: string
    password_confirmation: string
    token: string
    code: string
    mfa_token: string
}

export type UserLoginForm = Pick<Auth, 'email' | 'password'>
export type UserRegistrationForm = Pick<Auth, 'name' | 'email' | 'password' | 'password_confirmation'>
export type UserProfileForm = Pick<Auth, 'name' | 'email'>
export type RequestConfirmationCodeForm = Pick<Auth, 'email'>
export type ForgotPasswordForm = Pick<Auth, 'email'>
export type NewPasswordForm = Pick<Auth, 'password' | 'password_confirmation'>
export type UpdateCurrentUserPasswordForm = Pick<Auth, 'current_password' | 'password' | 'password_confirmation'>
export type ConfirmToken = Pick<Auth, 'token'>
export type CheckPasswordForm = Pick<Auth, 'password'>
export type MfaLoginForm = Pick<Auth, 'mfa_token' | 'code'>
export type MfaToggleForm = Pick<Auth, 'current_password'>

export type AuthenticatedUser = {
    _id: string
    name: string
    email: string
    role: 'agent' | 'supervisor' | 'admin' | 'super_admin'
    mfa_enabled: boolean
}

export type AdminUserSummary = {
    _id: string
    name: string
    email: string
    role: 'agent' | 'supervisor' | 'admin' | 'super_admin'
    confirmed: boolean
    mfa_enabled: boolean
    created_at_unix_secs: number
    voice_agents_count: number
    text_agents_count: number
    phone_numbers_count: number
}


/** MFA */
export const mfaChallengeSchema = z.object({
    requires_mfa: z.literal(true),
    mfa_token: z.string(),
    message: z.string()
})

export type MfaChallenge = z.infer<typeof mfaChallengeSchema>
